from fastapi import APIRouter, Depends, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..auth_deps import get_current_user
from ..auth_models import User
from ..auth_schemas import PasswordChange, RefreshRequest, TokenPair, UserOut
from ..database import get_db
from ..services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenPair)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Le champ `username` du formulaire OAuth2 porte l'email.
    user = auth_service.authenticate(db, form.username, form.password)
    return auth_service.issue_tokens(db, user)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    return auth_service.rotate_refresh(db, body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Révoque tous les refresh tokens de l'utilisateur (toutes ses sessions)."""
    auth_service.revoke_all_refresh(db, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.from_user(user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    body: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    auth_service.change_password(db, user, body.current_password, body.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
