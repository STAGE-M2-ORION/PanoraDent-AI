"""Liens à usage unique : première connexion et réinitialisation.

Le jeton (32 octets tirés au hasard) part par e-mail et n'est JAMAIS stocké :
seule son empreinte sha256 l'est. Émettre un nouveau lien rend inutilisables
tous les liens encore ouverts du même compte : un ancien courriel ne doit pas
rester une porte d'entrée.
"""
import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import auth_security as sec
from ..auth_models import Jeton, TypeJeton, Utilisateur, maintenant
from ..config import settings
from ..errors import ApiError

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


def lien_invalide() -> ApiError:
    # Même réponse pour un lien inexistant, expiré, déjà utilisé, d'un autre
    # type ou d'un compte qui ne peut plus s'en servir.
    return ApiError(
        400, "lien_invalide",
        "Ce lien n'est plus valable : il a expiré, a déjà servi ou n'existe pas. "
        "Demandez-en un nouveau.",
    )


def trouver(db: Session, jeton: str, type_: TypeJeton) -> tuple[Jeton | None, str]:
    """Ligne du lien (verrouillée jusqu'à la fin de la transaction) et motif
    de refus pour le journal, ou `(ligne, "")` si le lien est utilisable."""
    ligne = db.scalar(
        select(Jeton).where(Jeton.empreinte == sec.empreinte(jeton or "")).with_for_update()
    )
    if ligne is None:
        return None, "lien_inexistant"
    if ligne.type != type_:
        return ligne, "type_different"
    if ligne.utilise_le is not None:
        return ligne, "lien_deja_utilise"
    if not ligne.utilisable():
        return ligne, "lien_expire"
    return ligne, ""


def consommer(db: Session, ligne: Jeton) -> None:
    """Marque le lien utilisé et supprime les autres liens ouverts du compte.
    Ne valide pas la transaction."""
    ligne.utilise_le = maintenant()
    db.execute(delete(Jeton).where(
        Jeton.utilisateur_id == ligne.utilisateur_id, Jeton.utilise_le.is_(None), Jeton.id != ligne.id,
    ))
