"""Découpage des blocs en passages (sprint 9).

Environ 800 caractères par passage, 120 de recouvrement avec le précédent : une
définition coupée en deux reste retrouvable dans l'un des deux passages. La
coupe se fait de préférence en fin de phrase, sinon sur une espace, jamais au
milieu d'un mot. Un passage ne déborde jamais de son bloc : il garde ainsi
une seule section et une seule page, celles que la citation affichera.
"""
import re
from dataclasses import dataclass

from .extraction_texte import Bloc

TAILLE = 800
RECOUVREMENT = 120

_FIN_DE_PHRASE = re.compile(r"[.!?…:;](?=\s)|\n\n")


@dataclass(frozen=True)
class Morceau:
    texte: str
    section: str | None
    page: int | None

    def a_vectoriser(self) -> str:
        """Le titre de section aide la recherche : il précède le texte vectorisé."""
        return f"{self.section}\n{self.texte}" if self.section else self.texte


def _coupe(texte: str, debut: int, taille: int) -> int:
    """Indice de fin du passage commencé à `debut`."""
    fin = debut + taille
    if fin >= len(texte):
        return len(texte)
    plancher = debut + int(taille * 0.6)  # pas de passage trop court pour une fin de phrase
    phrases = [m.end() for m in _FIN_DE_PHRASE.finditer(texte, plancher, fin)]
    if phrases:
        return phrases[-1]
    espace = texte.rfind(" ", debut + 1, fin)
    return espace if espace > debut else fin


def _reprise(texte: str, coupe: int, recouvrement: int, debut: int) -> int:
    """Début du passage suivant : `recouvrement` caractères avant la coupe,
    calé sur le début d'un mot, et toujours après le début précédent."""
    reprise = max(coupe - recouvrement, debut + 1)
    if reprise < coupe and not texte[reprise - 1].isspace():
        espace = texte.find(" ", reprise, coupe)
        reprise = espace + 1 if espace != -1 else coupe
    return reprise


def decouper_texte(texte: str, taille: int = TAILLE, recouvrement: int = RECOUVREMENT) -> list[str]:
    texte = texte.strip()
    if len(texte) <= taille:
        return [texte] if texte else []
    morceaux, debut = [], 0
    while debut < len(texte):
        fin = _coupe(texte, debut, taille)
        morceau = texte[debut:fin].strip()
        if morceau:
            morceaux.append(morceau)
        if fin >= len(texte):
            break
        debut = _reprise(texte, fin, recouvrement, debut)
    return morceaux


def decouper(blocs: list[Bloc], taille: int = TAILLE, recouvrement: int = RECOUVREMENT) -> list[Morceau]:
    return [Morceau(t, b.section, b.page)
            for b in blocs for t in decouper_texte(b.texte, taille, recouvrement)]
