"""Inscription au journal : connexions, refus, créations de compte, déconnexions."""
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


def inscrire(
    db: Session,
    action: str,
    resultat: str,
    *,
    request: Request | None = None,
    auteur_id: uuid.UUID | None = None,
    detail: str = "",
    commit: bool = True,
) -> None:
    db.add(Journal(
        action=action,
        resultat=resultat,
        auteur_id=auteur_id,
        adresse_ip=adresse_ip(request),
        detail=detail,
    ))
    if commit:
        db.commit()
