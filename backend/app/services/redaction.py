"""Rédaction de la réponse de l'assistant à partir des passages retrouvés (sprint 9).

La règle qui gouverne tout : la réponse ne contient que ce que les passages
contiennent. Le gabarit l'impose au modèle, et `verifier` le contrôle après
coup : chaque paragraphe doit citer au moins un passage, chaque citation doit
renvoyer à un passage fourni. Une réponse sans source est un échec, jamais un
résultat dégradé : elle n'est pas montrée.

Deux rédacteurs, choisis par ASSISTANT_FOURNISSEUR : `ollama` (modèle local
MODELE_LANGAGE) et `factice` (reprend le passage le plus proche, pour les tests).
"""
import asyncio
import json
import re
from dataclasses import dataclass
from typing import Protocol

import httpx

from ..config import settings

NE_SAIT_PAS = "JE NE SAIS PAS"
CITATION = re.compile(r"\[(\d+)\]")

CONSIGNES = f"""Tu es l'assistant documentaire de PanoraDent AI, un outil qui aide un chirurgien-dentiste \
à lire une radiographie panoramique. Règles absolues :
1. Réponds en français, uniquement à partir des passages numérotés fournis. N'ajoute aucune \
connaissance extérieure, même si tu crois la connaître.
2. Termine chaque phrase par le numéro du ou des passages qui la fondent, entre crochets : [1] ou [2][3].
3. Si les passages ne permettent pas de répondre, réponds exactement : {NE_SAIT_PAS}
4. Tu expliques ; tu ne poses jamais de diagnostic et ne proposes aucun traitement : ils relèvent du praticien.
5. Sois bref : quatre phrases au plus, sans titre ni liste."""


class RedactionImpossible(Exception):
    """Le modèle de langage ne répond pas ou répond mal ; le message dit pourquoi."""


@dataclass(frozen=True)
class Extrait:
    """Passage remis au modèle : son numéro de citation, sa provenance, son texte."""
    numero: int
    titre: str
    section: str | None
    page: int | None
    texte: str

    def provenance(self) -> str:
        return " — ".join(x for x in (self.titre, self.section, f"page {self.page}" if self.page else None) if x)


def message(question: str, extraits: list[Extrait], contexte: dict | None) -> str:
    """Le message envoyé au modèle : passages, contexte anonyme, question."""
    lignes = ["Passages :"]
    for e in extraits:
        lignes += [f"[{e.numero}] ({e.provenance()})", e.texte, ""]
    if contexte:
        lignes.append("Contexte de l'analyse (anonyme) :")
        lignes.append(f"- version du modèle de détection : {contexte.get('modele') or 'inconnue'}")
        anomalies = contexte.get("anomalies") or []
        if anomalies:
            for a in anomalies:
                dent = f"dent {a['dent']}" if a.get("dent") else "dent non attribuée"
                confiance = f", confiance {a['confiance']} %" if a.get("confiance") is not None else ""
                lignes.append(f"- {a['type']} ({dent}{confiance}, {a['origine']})")
        else:
            lignes.append("- aucune anomalie retenue")
        lignes.append("")
    lignes.append(f"Question : {question}")
    return "\n".join(lignes)


@dataclass(frozen=True)
class Verification:
    statut: str          # « reponse », « refus » ou « echec »
    citees: tuple[int, ...] = ()
    motif: str | None = None


def verifier(texte: str, nombre_extraits: int) -> Verification:
    """Contrôle d'une réponse : refus explicite, ou citations valides partout."""
    t = (texte or "").strip()
    if not t or NE_SAIT_PAS in t.upper():
        return Verification("refus")
    citees = sorted({int(n) for n in CITATION.findall(t)})
    if not citees:
        return Verification("echec", motif="réponse sans source")
    if any(n < 1 or n > nombre_extraits for n in citees):
        return Verification("echec", motif="citation d'un passage inexistant")
    paragraphes = [p.strip() for p in t.splitlines() if p.strip() and not p.strip().endswith(":")]
    if any(not CITATION.search(p) for p in paragraphes):
        return Verification("echec", motif="affirmation sans source")
    return Verification("reponse", tuple(citees))


class Redacteur(Protocol):
    nom: str

    def rediger(self, question: str, extraits: list[Extrait], contexte: dict | None) -> str: ...

    def flux(self, question: str, extraits: list[Extrait], contexte: dict | None):
        """Générateur asynchrone des fragments de la réponse, à mesure."""


class RedacteurOllama:
    def __init__(self, url: str, modele: str, delai: float = 180.0, transport=None):
        self.url, self.modele, self.delai = url.rstrip("/"), modele, delai
        self.nom = modele
        self.transport = transport   # tests : transport httpx simulé

    def charge(self, question: str, extraits: list[Extrait], contexte: dict | None, flux: bool = False) -> dict:
        """Corps exact de la requête envoyée à Ollama (vérifié par les tests)."""
        return {
            "model": self.modele,
            "messages": [{"role": "system", "content": CONSIGNES},
                         {"role": "user", "content": message(question, extraits, contexte)}],
            "stream": flux,
            # Température basse : la réponse colle aux passages ; bornes de longueur.
            "options": {"temperature": 0.1, "num_predict": 400, "num_ctx": 4096},
        }

    def rediger(self, question: str, extraits: list[Extrait], contexte: dict | None) -> str:
        try:
            resp = httpx.post(f"{self.url}/api/chat", json=self.charge(question, extraits, contexte),
                              timeout=self.delai)
        except httpx.HTTPError as exc:
            raise RedactionImpossible("le modèle de langage (Ollama) ne répond pas") from exc
        if resp.status_code == 404:
            raise RedactionImpossible(f"le modèle « {self.modele} » n'est pas installé dans Ollama")
        if resp.status_code >= 400:
            raise RedactionImpossible(f"Ollama refuse la requête (HTTP {resp.status_code})")
        try:
            return str(resp.json()["message"]["content"])
        except (ValueError, KeyError, TypeError) as exc:
            raise RedactionImpossible("réponse d'Ollama illisible") from exc

    async def flux(self, question: str, extraits: list[Extrait], contexte: dict | None):
        """Réponse d'Ollama au fil de l'eau (une ligne JSON par fragment).

        Fermer ce générateur sort des deux `async with` : la connexion HTTP est
        fermée, et Ollama, qui voit le client partir, arrête la génération.
        Un arrêt libère donc le modèle au lieu de le laisser écrire pour rien.
        """
        # Pas de délai global : seule l'attente entre deux fragments est bornée.
        delais = httpx.Timeout(10.0, read=self.delai)
        try:
            async with httpx.AsyncClient(timeout=delais, transport=self.transport) as client:
                async with client.stream("POST", f"{self.url}/api/chat",
                                         json=self.charge(question, extraits, contexte, flux=True)) as resp:
                    if resp.status_code == 404:
                        raise RedactionImpossible(f"le modèle « {self.modele} » n'est pas installé dans Ollama")
                    if resp.status_code >= 400:
                        raise RedactionImpossible(f"Ollama refuse la requête (HTTP {resp.status_code})")
                    async for ligne in resp.aiter_lines():
                        if not ligne.strip():
                            continue
                        try:
                            morceau = json.loads(ligne)
                        except ValueError as exc:
                            raise RedactionImpossible("réponse d'Ollama illisible") from exc
                        texte = (morceau.get("message") or {}).get("content") or ""
                        if texte:
                            yield texte
                        if morceau.get("done"):
                            return
        except httpx.HTTPError as exc:
            raise RedactionImpossible("le modèle de langage (Ollama) ne répond pas") from exc


class RedacteurFactice:
    """Reprend les deux premières phrases du passage le plus proche, citées [1].
    En flux, il livre ses mots un à un, avec `delai` secondes entre deux."""
    nom = "factice"

    def __init__(self, delai: float | None = None):
        self.delai = settings.assistant_delai_factice if delai is None else delai

    def rediger(self, question: str, extraits: list[Extrait], contexte: dict | None) -> str:
        phrases = re.split(r"(?<=[.!?])\s+", extraits[0].texte.strip())
        return " ".join(phrases[:2]).rstrip() + " [1]"

    async def flux(self, question: str, extraits: list[Extrait], contexte: dict | None):
        for morceau in re.findall(r"\S+\s*", self.rediger(question, extraits, contexte)):
            await asyncio.sleep(self.delai)
            yield morceau


def redacteur_courant() -> Redacteur:
    if settings.assistant_fournisseur.lower() == "factice":
        return RedacteurFactice()
    return RedacteurOllama(settings.ollama_url, settings.modele_langage)
