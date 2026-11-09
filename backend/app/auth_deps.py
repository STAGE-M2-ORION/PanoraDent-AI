"""Dépendances FastAPI : utilisateur courant et contrôle de permission."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from . import auth_security as sec
from .auth_models import User
from .database import get_db

# Les routeurs sont montés sous /api (voir main.py) : l'URL de login est donc
# /api/auth/login. Sert uniquement à la documentation Swagger ("Authorize").
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Authentification requise",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = sec.decode_token(token, sec.ACCESS)
    except sec.TokenError:
        raise unauthorized
    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_permission(code: str):
    """Fabrique une dépendance qui renvoie 403 si le rôle n'a pas `code`.

    Renvoie l'utilisateur, utilisable directement par la route :
        user: User = Depends(require_permission("analysis:read"))
    """
    def dependency(user: User = Depends(get_current_user)) -> User:
        if not user.has_permission(code):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Permission requise : {code}"
            )
        return user

    return dependency


def require_any_permission(*codes: str):
    """Comme `require_permission`, mais une seule des permissions suffit."""
    def dependency(user: User = Depends(get_current_user)) -> User:
        if not any(user.has_permission(c) for c in codes):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Permission requise : {' ou '.join(codes)}"
            )
        return user

    return dependency
