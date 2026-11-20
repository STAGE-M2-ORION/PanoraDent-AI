"""Inscription au journal : connexions, refus, verrouillages, liens, comptes, sessions."""
import uuid

from fastapi import Request
from sqlalchemy.orm import Session

from .auth_models import Journal

SUCCES = "succes"
REFUS = "refus"


def adresse_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    # Posé par le proxy nginx du frontend (qui écrase toute valeur du client).
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip[:45]
    return request.client.host if request.client else None


def agent(request: Request | None) -> str | None:
    if request is None:
        return None
    return (request.headers.get("user-agent") or "")[:255] or None


def inscrire(
    db: Session,
    action: str,
    resultat: str,
    *,
    request: Request | None = None,
    utilisateur_id: uuid.UUID | None = None,
    cible: str | None = None,
    details: dict | None = None,
    commit: bool = True,
) -> None:
    db.add(Journal(
        action=action,
        resultat=resultat,
        utilisateur_id=utilisateur_id,
        cible=cible,
        details=details or {},
        ip=adresse_ip(request),
    ))
    if commit:
        db.commit()
