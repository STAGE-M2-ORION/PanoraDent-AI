"""Jetons de la plateforme et primitives du parcours OAuth.

Google authentifie ; la plateforme gère la session avec ses propres jetons,
signés HS256 avec JWT_SECRET et transportés uniquement en cookies httpOnly :

- jeton d'accès (15 min) : identifiant utilisateur, session, rôle, permissions ;
- jeton de rafraîchissement (7 j) : identifiant de session seulement ;
- jeton de transaction OAuth (10 min) : state, nonce et code_verifier PKCE,
  le temps de l'aller-retour chez Google.
"""
import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from .config import settings

ACCESS = "access"
REFRESH = "refresh"
OAUTH = "oauth"

OAUTH_TTL = timedelta(minutes=10)


class TokenError(Exception):
    """Jeton illisible, expiré, de mauvais type ou falsifié."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(payload: dict, expires_at: datetime) -> str:
    now = _now()
    payload = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: str) -> dict:
    try:
        # L'algorithme est imposé côté serveur (jamais lu dans l'en-tête du jeton).
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError("Jeton invalide ou expiré") from exc
    if payload.get("type") != expected_type or not payload.get("sub"):
        raise TokenError("Type de jeton incorrect")
    return payload


# --- Session ---------------------------------------------------------------

def access_ttl() -> timedelta:
    return timedelta(minutes=settings.access_token_expire_minutes)


def refresh_ttl() -> timedelta:
    return timedelta(days=settings.refresh_token_expire_days)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, role: str, permissions: list[str]) -> str:
    return _encode(
        {
            "type": ACCESS,
            "sub": str(user_id),
            "sid": str(session_id),
            "role": role,
            "permissions": permissions,
        },
        _now() + access_ttl(),
    )


def create_refresh_token(session_id: uuid.UUID, expires_at: datetime) -> str:
    # `jti` aléatoire : deux jetons émis pour la même session dans la même
    # seconde restent distincts (leurs empreintes aussi).
    return _encode(
        {"type": REFRESH, "sub": str(session_id), "jti": secrets.token_urlsafe(16)}, expires_at
    )


def empreinte(valeur: str) -> str:
    """Empreinte sha256 (hexadécimale) d'un jeton : c'est elle, jamais le
    jeton, qui est conservée en base."""
    return hashlib.sha256(valeur.encode("utf-8")).hexdigest()


# --- Parcours OAuth --------------------------------------------------------

def random_token() -> str:
    return secrets.token_urlsafe(32)


def pkce_pair() -> tuple[str, str]:
    """Renvoie `(code_verifier, code_challenge)` selon RFC 7636 (méthode S256)."""
    verifier = secrets.token_urlsafe(64)  # 86 caractères, dans [43, 128]
    return verifier, pkce_challenge(verifier)


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def create_oauth_token(state: str, nonce: str, code_verifier: str) -> str:
    return _encode(
        {"type": OAUTH, "sub": "oauth", "state": state, "nonce": nonce, "cv": code_verifier},
        _now() + OAUTH_TTL,
    )
