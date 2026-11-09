"""Hachage des mots de passe et jetons JWT.

Mots de passe : bcrypt appelé DIRECTEMENT (passlib est incompatible avec
bcrypt 4.x). bcrypt ne lit que les 72 premiers octets : le mot de passe est
donc pré-haché en SHA-256 puis encodé en base64 (44 caractères) avant bcrypt.
"""
import base64
import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from .config import settings

ACCESS = "access"
REFRESH = "refresh"


class TokenError(Exception):
    """Jeton illisible, expiré, de mauvais type ou falsifié."""


# --- Mots de passe ---------------------------------------------------------

def _prehash(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.bcrypt_rounds)
    return bcrypt.hashpw(_prehash(password), salt).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


# --- JWT -------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(sub: str, token_type: str, expires: timedelta) -> tuple[str, str, datetime]:
    now = _now()
    exp = now + expires
    jti = str(uuid.uuid4())
    payload = {
        "sub": sub,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": jti,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, jti, exp


def create_access_token(user_id: str) -> str:
    token, _, _ = _encode(
        user_id, ACCESS, timedelta(minutes=settings.access_token_expire_minutes)
    )
    return token


def create_refresh_token(user_id: str) -> tuple[str, str, datetime]:
    """Renvoie `(token, jti, expiration UTC)` ; le jti est à persister."""
    return _encode(user_id, REFRESH, timedelta(days=settings.refresh_token_expire_days))


def decode_token(token: str, expected_type: str) -> dict:
    try:
        # L'algorithme est imposé côté serveur (jamais lu dans l'en-tête du jeton).
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError("Jeton invalide ou expiré") from exc
    if payload.get("type") != expected_type or not payload.get("sub") or not payload.get("jti"):
        raise TokenError("Type de jeton incorrect")
    return payload
