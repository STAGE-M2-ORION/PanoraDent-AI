"""Comptes utilisateurs, gérés par l'administrateur (`user:manage`).

Pas d'inscription publique et pas de suppression : un compte se désactive, ce
qui garde ses lignes de journal rattachées.
"""
import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..auth_schemas import UtilisateurCreation, UtilisateurModification, UtilisateurOut
from ..database import get_db
from ..errors import ApiError
from ..permissions import USER_MANAGE
from ..services import auth_service

router = APIRouter(prefix="/utilisateurs", tags=["utilisateurs"])


def _ou_404(db: Session, utilisateur_id: uuid.UUID) -> Utilisateur:
    utilisateur = db.get(Utilisateur, utilisateur_id)
    if utilisateur is None:
        raise ApiError(404, "introuvable", "Utilisateur introuvable.")
    return utilisateur


@router.get("", response_model=list[UtilisateurOut])
def lister(_: Utilisateur = Depends(exiger(USER_MANAGE)), db: Session = Depends(get_db)):
    utilisateurs = db.scalars(select(Utilisateur).order_by(Utilisateur.date_creation)).all()
    return [UtilisateurOut.depuis(u) for u in utilisateurs]


@router.post("", response_model=UtilisateurOut, status_code=status.HTTP_201_CREATED)
def creer(
    body: UtilisateurCreation,
    request: Request,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    utilisateur = auth_service.creer_utilisateur(db, body)
    journal.inscrire(
        db, "creation_compte", journal.SUCCES, request=request, auteur_id=auteur.id,
        detail=f"compte={utilisateur.id} adresse={utilisateur.email} role={utilisateur.role.libelle}",
        commit=False,
    )
    db.commit()
    return UtilisateurOut.depuis(utilisateur)


@router.get("/{utilisateur_id}", response_model=UtilisateurOut)
def lire(
    utilisateur_id: uuid.UUID,
    _: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    return UtilisateurOut.depuis(_ou_404(db, utilisateur_id))


@router.patch("/{utilisateur_id}", response_model=UtilisateurOut)
def modifier(
    utilisateur_id: uuid.UUID,
    body: UtilisateurModification,
    request: Request,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    utilisateur = auth_service.modifier_utilisateur(db, _ou_404(db, utilisateur_id), body)
    champs = ", ".join(sorted(body.model_dump(exclude_none=True)))
    journal.inscrire(
        db, "modification_compte", journal.SUCCES, request=request, auteur_id=auteur.id,
        detail=f"compte={utilisateur.id} champs={champs}", commit=False,
    )
    db.commit()
    return UtilisateurOut.depuis(utilisateur)
