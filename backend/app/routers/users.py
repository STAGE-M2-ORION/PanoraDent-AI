from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth_deps import require_permission
from ..auth_models import User
from ..auth_schemas import UserCreate, UserOut, UserUpdate
from ..database import get_db
from ..permissions import USER_MANAGE
from ..services import auth_service

router = APIRouter(prefix="/users", tags=["users"])


def _get_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utilisateur introuvable")
    return user


@router.get("", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_permission(USER_MANAGE)), db: Session = Depends(get_db)
):
    users = db.scalars(select(User).order_by(User.created_at)).all()
    return [UserOut.from_user(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    _: User = Depends(require_permission(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    return UserOut.from_user(auth_service.create_user(db, body))


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    _: User = Depends(require_permission(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    return UserOut.from_user(_get_or_404(db, user_id))


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    body: UserUpdate,
    _: User = Depends(require_permission(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    user = _get_or_404(db, user_id)
    return UserOut.from_user(auth_service.update_user(db, user, body))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    actor: User = Depends(require_permission(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    auth_service.delete_user(db, _get_or_404(db, user_id), actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
