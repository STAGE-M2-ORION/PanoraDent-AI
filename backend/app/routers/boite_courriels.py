"""Boîte de réception des tests (COURRIEL_MODE=memoire, APP_ENV=test uniquement).

Montée seulement dans ce cas (voir `main.py`) : le parcours navigateur
(Playwright) y lit le lien de première connexion ou de réinitialisation que
l'application vient d'« envoyer ». Elle n'existe dans aucun autre environnement.
"""
from fastapi import APIRouter, Depends, Query, status

from ..auth_deps import publique
from ..services import courriel

router = APIRouter(prefix="/test/courriels", tags=["test"], include_in_schema=False)


@router.get("", dependencies=[Depends(publique)])
def lister(destinataire: str | None = Query(default=None)):
    """Messages reçus, du plus ancien au plus récent (filtrés par destinataire)."""
    return [
        {"destinataire": c.destinataire, "sujet": c.sujet, "texte": c.texte}
        for c in courriel.BOITE
        if destinataire is None or c.destinataire.lower() == destinataire.lower()
    ]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(publique)])
def vider():
    courriel.BOITE.clear()
