"""Dépendances FastAPI : session courante et contrôle de permission.

Toute route déclare soit `exiger("<permission>")` (ou `session_ouverte`), soit
explicitement `publique`. Un test parcourt la liste des routes et échoue si
l'une d'elles ne porte ni l'un ni l'autre : c'est lui qui empêchera d'oublier
un garde sur une nouvelle route.

Les routes déclarent la PERMISSION exigée, jamais le rôle.
"""
import uuid

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from . import auth_security as sec
from .auth_models import SessionUtilisateur, Utilisateur
from .database import get_db
from .errors import ApiError

# Cookies de session (httpOnly, Secure, SameSite=Lax).
COOKIE_ACCES = "pd_acces"
COOKIE_RAFRAICHISSEMENT = "pd_rafraichissement"
COOKIE_OAUTH = "pd_oauth"
# Chemins : le jeton d'accès accompagne tout appel à l'API ; celui de
# rafraîchissement ne part que vers les routes d'authentification.
CHEMIN_ACCES = "/api"
CHEMIN_RAFRAICHISSEMENT = "/api/v1/auth"
CHEMIN_OAUTH = "/api/v1/auth/google"


def publique() -> None:
    """Marque explicite d'une route accessible sans session."""
    return None


def _non_authentifie() -> ApiError:
    return ApiError(401, "non_authentifie", "Authentification requise. Reconnectez-vous.")


def _uuid(valeur) -> uuid.UUID:
    try:
        return uuid.UUID(str(valeur))
    except (ValueError, TypeError) as exc:
        raise _non_authentifie() from exc


def utilisateur_du_jeton(db: Session, jeton: str | None) -> tuple[Utilisateur, uuid.UUID]:
    """(utilisateur, session) d'un jeton d'accès : jeton valide, session non
    révoquée, utilisateur actif ; sinon 401. Partagé par les requêtes HTTP et
    le flux des notifications (WebSocket, sprint 13)."""
    if not jeton:
        raise _non_authentifie()
    try:
        payload = sec.decode_token(jeton, sec.ACCESS)
    except sec.TokenError:
        raise _non_authentifie()

    session = db.get(SessionUtilisateur, _uuid(payload.get("sid")))
    if session is None or not session.valide():
        raise _non_authentifie()
    utilisateur = db.get(Utilisateur, _uuid(payload["sub"]))
    if utilisateur is None or utilisateur.id != session.utilisateur_id or not utilisateur.actif:
        raise _non_authentifie()
    return utilisateur, session.id


def session_encore_valide(db: Session, session_id: uuid.UUID, utilisateur_id: uuid.UUID) -> bool:
    """Revérifiée pendant une connexion longue : déconnexion, session fermée
    par l'administrateur ou compte désactivé y mettent fin."""
    session = db.get(SessionUtilisateur, session_id)
    utilisateur = db.get(Utilisateur, utilisateur_id)
    return bool(session and session.valide() and utilisateur and utilisateur.actif)


def session_ouverte(request: Request, db: Session = Depends(get_db)) -> Utilisateur:
    """Décode le jeton d'accès, vérifie que sa session n'est pas révoquée et
    charge l'utilisateur, qui doit être actif. Les permissions sont relues en
    base : un changement de rôle s'applique sans attendre l'expiration."""
    utilisateur, session_id = utilisateur_du_jeton(db, request.cookies.get(COOKIE_ACCES))
    request.state.session_id = session_id
    return utilisateur


def exiger(code: str):
    """Fabrique une dépendance qui renvoie 403 si le rôle n'a pas `code`.

        utilisateur: Utilisateur = Depends(exiger("analysis:read"))
    """
    def dependance(utilisateur: Utilisateur = Depends(session_ouverte)) -> Utilisateur:
        if not utilisateur.a_permission(code):
            raise ApiError(403, "acces_refuse", f"Votre rôle ne permet pas cette action ({code}).")
        return utilisateur

    dependance.permission = code
    return dependance


def exiger_une_de(*codes: str):
    """Comme `exiger`, mais une seule des permissions suffit."""
    def dependance(utilisateur: Utilisateur = Depends(session_ouverte)) -> Utilisateur:
        if not any(utilisateur.a_permission(c) for c in codes):
            raise ApiError(
                403, "acces_refuse", f"Votre rôle ne permet pas cette action ({' ou '.join(codes)})."
            )
        return utilisateur

    dependance.permission = codes
    return dependance
