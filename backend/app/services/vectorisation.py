"""Vectorisation des passages et des questions (sprint 9).

Deux vectoriseurs, choisis par ASSISTANT_FOURNISSEUR :

- `ollama` : le modèle `MODELE_VECTEURS` (bge-m3, multilingue, 1024
  dimensions) servi par le conteneur Ollama du cabinet ; rien ne sort ;
- `factice` : un hachage des mots et des paires de mots, déterministe et sans
  modèle. Il donne une vraie similarité lexicale — deux textes qui partagent
  des mots sont proches —, assez pour éprouver toute la chaîne dans les tests
  et les parcours e2e. Refusé en production (voir `config.py`).

Chaque vectoriseur a un `nom`, gardé sur chaque passage : un passage vectorisé
par un autre modèle que le modèle courant est périmé, jamais comparé à tort.
Les vecteurs sont normés (longueur 1) : la similarité cosinus devient un
simple produit scalaire.
"""
import hashlib
import math
import re
import unicodedata
from typing import Protocol

import httpx

from ..config import settings
from ..vecteurs import DIMENSION

LOT = 16  # textes envoyés par appel : borne la durée d'une requête sur processeur


class VectorisationImpossible(Exception):
    """Le service de vectorisation ne répond pas ou répond mal ; le message dit pourquoi."""


class Vectoriseur(Protocol):
    nom: str

    def vectoriser(self, textes: list[str]) -> list[list[float]]: ...


def normer(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n else v


def _verifier(vecteurs: list[list[float]], attendus: int, nom: str) -> list[list[float]]:
    if len(vecteurs) != attendus:
        raise VectorisationImpossible(f"{nom} a renvoyé {len(vecteurs)} vecteurs pour {attendus} textes.")
    for v in vecteurs:
        if len(v) != DIMENSION:
            raise VectorisationImpossible(
                f"{nom} produit des vecteurs de dimension {len(v)} ; la base attend {DIMENSION}.")
    return [normer([float(x) for x in v]) for v in vecteurs]


class VectoriseurOllama:
    def __init__(self, url: str, modele: str, delai: float = 300.0):
        self.url, self.modele, self.delai = url.rstrip("/"), modele, delai
        self.nom = modele

    def vectoriser(self, textes: list[str]) -> list[list[float]]:
        vecteurs: list[list[float]] = []
        for i in range(0, len(textes), LOT):
            lot = textes[i:i + LOT]
            try:
                resp = httpx.post(f"{self.url}/api/embed", json={"model": self.modele, "input": lot},
                                  timeout=self.delai)
            except httpx.HTTPError as exc:
                raise VectorisationImpossible(
                    "Le service de vectorisation (Ollama) ne répond pas.") from exc
            if resp.status_code == 404:
                raise VectorisationImpossible(
                    f"Le modèle « {self.modele} » n'est pas installé dans Ollama "
                    f"(docker compose exec ollama ollama pull {self.modele}).")
            if resp.status_code >= 400:
                raise VectorisationImpossible(f"Ollama refuse la vectorisation (HTTP {resp.status_code}).")
            try:
                vecteurs += resp.json()["embeddings"]
            except (ValueError, KeyError, TypeError) as exc:
                raise VectorisationImpossible("Réponse d'Ollama illisible.") from exc
        return _verifier(vecteurs, len(textes), f"Le modèle « {self.modele} »")


def _mots(texte: str) -> list[str]:
    sans_accents = unicodedata.normalize("NFKD", texte.lower())
    sans_accents = "".join(c for c in sans_accents if not unicodedata.combining(c))
    return [m for m in re.findall(r"[a-z0-9]+", sans_accents) if len(m) > 2]


def _case(terme: str) -> tuple[int, float]:
    h = hashlib.sha256(terme.encode()).digest()
    return int.from_bytes(h[:4], "big") % DIMENSION, (1.0 if h[4] & 1 else -1.0)


class VectoriseurFactice:
    nom = "factice-hachage-v1"

    def vectoriser(self, textes: list[str]) -> list[list[float]]:
        vecteurs = []
        for texte in textes:
            v = [0.0] * DIMENSION
            mots = _mots(texte)
            for terme in mots + [f"{a} {b}" for a, b in zip(mots, mots[1:])]:
                i, signe = _case(terme)
                v[i] += signe
            vecteurs.append(v if any(v) else [1.0] + [0.0] * (DIMENSION - 1))
        return _verifier(vecteurs, len(textes), "Le vectoriseur factice")


def vectoriseur_courant() -> Vectoriseur:
    if settings.assistant_fournisseur.lower() == "factice":
        return VectoriseurFactice()
    return VectoriseurOllama(settings.ollama_url, settings.modele_vecteurs)
