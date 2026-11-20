"""Liens à usage unique : première connexion et réinitialisation.

Le jeton (32 octets tirés au hasard) part par e-mail et n'est JAMAIS stocké :
seule son empreinte sha256 l'est. Émettre un nouveau lien rend inutilisables
tous les liens encore ouverts du même compte : un ancien courriel ne doit pas
rester une porte d'entrée.
"""
import secrets
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .. import auth_security as sec
from ..auth_models import Jeton, TypeJeton, Utilisateur, maintenant
from ..config import settings

DUREES = {
    TypeJeton.premiere_connexion: timedelta(hours=24),
    TypeJeton.reinitialisation: timedelta(hours=1),
}

PAGES = {
    TypeJeton.premiere_connexion: "premiere-connexion",
    TypeJeton.reinitialisation: "nouveau-mot-de-passe",
}


def emettre(db: Session, utilisateur: Utilisateur, type_: TypeJeton) -> str:
    """Crée un lien pour `utilisateur` et renvoie le jeton en clair (à
    envoyer, jamais à conserver). Ne valide pas la transaction."""
    db.execute(
        delete(Jeton).where(Jeton.utilisateur_id == utilisateur.id, Jeton.utilise_le.is_(None))
    )
    jeton = secrets.token_urlsafe(32)
    db.add(Jeton(
        utilisateur_id=utilisateur.id,
        type=type_,
        empreinte=sec.empreinte(jeton),
        expiration=maintenant() + DUREES[type_],
    ))
    db.flush()
    return jeton


def lien(type_: TypeJeton, jeton: str) -> str:
    return f"{settings.app_url.rstrip('/')}/{PAGES[type_]}?jeton={jeton}"
