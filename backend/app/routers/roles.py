"""Rôles et permissions (`role:manage`).

Les trois rôles système sont figés : ni renommés, ni modifiés, ni supprimés,
quel que soit l'appelant (indicateur `systeme` en base). On les duplique pour
créer un rôle personnalisé. Toute écriture est inscrite au journal.
"""
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger, exiger_une_de
from ..auth_models import Permission, Role, Utilisateur
from ..auth_schemas import PermissionOut, RoleCreation, RoleDuplication, RoleModification, RoleOut
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


def _journaliser(db: Session, request: Request, auteur: Utilisateur, action: str, role: Role, **details) -> None:
    journal.inscrire(
        db, action, journal.SUCCES, request=request, utilisateur_id=auteur.id,
        cible=f"role:{role.id}", details={"libelle": role.libelle, **details}, commit=False,
    )


@router.get("/permissions", response_model=list[PermissionOut])
def lister_permissions(
    _: Utilisateur = Depends(exiger_une_de(ROLE_MANAGE, USER_MANAGE)), db: Session = Depends(get_db)
):
    """Catalogue des permissions (lecture ouverte aussi à `user:manage`, pour
    afficher ce qu'un rôle autorise au moment de l'attribuer)."""
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
    body: RoleCreation,
    request: Request,
    auteur: Utilisateur = Depends(exiger(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    role = auth_service.creer_role(db, body)
    _journaliser(db, request, auteur, "creation_role", role, permissions=role.permission_codes)
    db.commit()
    return RoleOut.depuis(role)


@router.post("/roles/{role_id}/dupliquer", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def dupliquer_role(
    role_id: uuid.UUID,
    request: Request,
    body: RoleDuplication | None = None,
    auteur: Utilisateur = Depends(exiger(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    """Copie personnalisée d'un rôle (système compris) : point de départ d'un
    rôle proche d'un rôle existant."""
    source = _ou_404(db, role_id)
    role = auth_service.dupliquer_role(db, source, body or RoleDuplication())
    _journaliser(db, request, auteur, "duplication_role", role, source=source.libelle)
    db.commit()
    return RoleOut.depuis(role)


@router.get("/roles/{role_id}", response_model=RoleOut)
def lire_role(
    role_id: uuid.UUID, _: Utilisateur = Depends(exiger(ROLE_MANAGE)), db: Session = Depends(get_db)
):
    return RoleOut.depuis(_ou_404(db, role_id))


@router.patch("/roles/{role_id}", response_model=RoleOut)
def modifier_role(
    role_id: uuid.UUID,
    body: RoleModification,
    request: Request,
    auteur: Utilisateur = Depends(exiger(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    role = _ou_404(db, role_id)
    avant = {"libelle": role.libelle, "permissions": role.permission_codes}
    role = auth_service.modifier_role(db, role, body)
    _journaliser(
        db, request, auteur, "modification_role", role,
        avant=avant, apres={"libelle": role.libelle, "permissions": role.permission_codes},
    )
    db.commit()
    return RoleOut.depuis(role)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_role(
    role_id: uuid.UUID,
    request: Request,
    auteur: Utilisateur = Depends(exiger(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    role = _ou_404(db, role_id)
    _journaliser(db, request, auteur, "suppression_role", role, permissions=role.permission_codes)
    auth_service.supprimer_role(db, role)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
