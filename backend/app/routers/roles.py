import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth_deps import exiger, exiger_une_de
from ..auth_models import Permission, Role, Utilisateur
from ..auth_schemas import PermissionOut, RoleCreation, RoleModification, RoleOut
from ..database import get_db
from ..errors import ApiError
from ..permissions import ROLE_MANAGE, USER_MANAGE
from ..services import auth_service

router = APIRouter(tags=["roles"])


def _ou_404(db: Session, role_id: uuid.UUID) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise ApiError(404, "introuvable", "Rôle introuvable.")
    return role


@router.get("/permissions", response_model=list[PermissionOut])
def lister_permissions(_: Utilisateur = Depends(exiger(ROLE_MANAGE)), db: Session = Depends(get_db)):
    """Catalogue des permissions assignables à un rôle."""
    return db.scalars(select(Permission).order_by(Permission.code)).all()


@router.get("/roles", response_model=list[RoleOut])
def lister_roles(
    _: Utilisateur = Depends(exiger_une_de(ROLE_MANAGE, USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Lecture ouverte aussi à `user:manage` : nécessaire pour attribuer un rôle."""
    roles = db.scalars(select(Role).order_by(Role.systeme.desc(), Role.libelle)).all()
    return [RoleOut.depuis(r) for r in roles]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def creer_role(
    body: RoleCreation, _: Utilisateur = Depends(exiger(ROLE_MANAGE)), db: Session = Depends(get_db)
):
    return RoleOut.depuis(auth_service.creer_role(db, body))


@router.get("/roles/{role_id}", response_model=RoleOut)
def lire_role(
    role_id: uuid.UUID, _: Utilisateur = Depends(exiger(ROLE_MANAGE)), db: Session = Depends(get_db)
):
    return RoleOut.depuis(_ou_404(db, role_id))


@router.patch("/roles/{role_id}", response_model=RoleOut)
def modifier_role(
    role_id: uuid.UUID,
    body: RoleModification,
    _: Utilisateur = Depends(exiger(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    return RoleOut.depuis(auth_service.modifier_role(db, _ou_404(db, role_id), body))


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_role(
    role_id: uuid.UUID, _: Utilisateur = Depends(exiger(ROLE_MANAGE)), db: Session = Depends(get_db)
):
    auth_service.supprimer_role(db, _ou_404(db, role_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
