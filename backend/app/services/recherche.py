"""Recherche par similarité dans la base documentaire (sprint 9).

Seuls les passages vectorisés par le modèle COURANT sont comparés à la
question : un vecteur d'un autre modèle vit dans un autre espace, et sa
similarité ne voudrait rien dire.

- PostgreSQL : l'opérateur `<=>` de pgvector (distance cosinus), servi par
  l'index HNSW ; la similarité vaut 1 − distance.
- SQLite (tests) : produit scalaire en Python, les vecteurs étant normés.

Les passages sous le seuil sont écartés : mieux vaut ne rien renvoyer qu'un
passage hors sujet, que le modèle de langage s'empresserait d'utiliser.
"""
from dataclasses import dataclass

from sqlalchemy import Float, func, literal, select
from sqlalchemy.orm import Session, joinedload

from ..models import Passage
from ..vecteurs import Vecteur

PASSAGES_MAX = 20


@dataclass(frozen=True)
class Trouve:
    passage: Passage
    score: float  # similarité cosinus, de −1 à 1


def rechercher(db: Session, vecteur: list[float], *, modele: str, nombre: int, seuil: float) -> list[Trouve]:
    """Les `nombre` passages les plus proches dont la similarité atteint `seuil`,
    du plus proche au moins proche."""
    nombre = max(1, min(int(nombre), PASSAGES_MAX))
    if db.get_bind().dialect.name == "postgresql":
        distance = Passage.vecteur.op("<=>", return_type=Float)(literal(vecteur, Vecteur()))
        lignes = db.execute(
            select(Passage, distance.label("distance"))
            .options(joinedload(Passage.document))
            .where(Passage.modele == modele, Passage.vecteur.is_not(None))
            .order_by(distance)
            .limit(nombre)
        ).all()
        trouves = [Trouve(p, 1.0 - float(d)) for p, d in lignes]
    else:
        candidats = (db.query(Passage).options(joinedload(Passage.document))
                     .filter(Passage.modele == modele, Passage.vecteur.is_not(None)).all())
        trouves = sorted((Trouve(p, sum(a * b for a, b in zip(vecteur, p.vecteur))) for p in candidats),
                         key=lambda t: t.score, reverse=True)[:nombre]
    return [t for t in trouves if t.score >= seuil - 1e-9]


def passages_utilisables(db: Session, modele: str) -> int:
    """Passages comparables à une question : vectorisés par le modèle courant."""
    return db.scalar(select(func.count(Passage.id))
                     .where(Passage.modele == modele, Passage.vecteur.is_not(None))) or 0
