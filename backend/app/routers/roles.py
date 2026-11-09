from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth_deps import require_any_permission, require_permission
from ..auth_models import Permission, Role, User
from ..auth_schemas import PermissionOut, RoleCreate, RoleOut, RoleUpdate
from ..database import get_db
from ..permissions import ROLE_MANAGE, USER_MANAGE
from ..services import auth_service

router = APIRouter(tags=["roles"])


def _get_or_404(db: Session, role_id: str) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rôle introuvable")
    return role


@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(
    _: User = Depends(require_permission(ROLE_MANAGE)), db: Session = Depends(get_db)
):
    """Catalogue des permissions assignables à un rôle."""
    return db.scalars(select(Permission).order_by(Permission.code)).all()


@router.get("/roles", response_model=list[RoleOut])
def list_roles(
    _: User = Depends(require_any_permission(ROLE_MANAGE, USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Lecture ouverte aussi à `user:manage` : nécessaire pour attribuer un rôle."""
    roles = db.scalars(select(Role).order_by(Role.is_system.desc(), Role.name)).all()
    return [RoleOut.from_role(r) for r in roles]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(
    body: RoleCreate,
    _: User = Depends(require_permission(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    return RoleOut.from_role(auth_service.create_role(db, body))


@router.get("/roles/{role_id}", response_model=RoleOut)
def get_role(
    role_id: str,
    _: User = Depends(require_permission(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    return RoleOut.from_role(_get_or_404(db, role_id))


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: str,
    body: RoleUpdate,
    _: User = Depends(require_permission(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    return RoleOut.from_role(auth_service.update_role(db, _get_or_404(db, role_id), body))


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_id: str,
    _: User = Depends(require_permission(ROLE_MANAGE)),
    db: Session = Depends(get_db),
):
    auth_service.delete_role(db, _get_or_404(db, role_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
