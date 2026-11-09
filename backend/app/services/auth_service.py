"""Logique métier d'authentification et d'administration des comptes/rôles.

Les erreurs sont levées en `HTTPException` : ce module n'est appelé que par des
routeurs, il n'y a pas de couche intermédiaire à protéger.
"""
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth_security as sec
from ..auth_models import Permission, RefreshToken, Role, User, utcnow
from ..auth_schemas import RoleCreate, RoleUpdate, UserCreate, UserUpdate
from ..config import settings
from ..permissions import ADMIN_CAPABILITIES, ADMIN_ROLE

# Message volontairement identique pour « email inconnu », « mauvais mot de
# passe » et « compte désactivé » : ne pas révéler quels comptes existent.
INVALID_CREDENTIALS = "Identifiants invalides"
_DUMMY_HASH = sec.hash_password("dummy-password-for-timing")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"}
    )


# --- Authentification ------------------------------------------------------

def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        # Même coût de calcul qu'un vrai échec, pour ne pas trahir l'inexistence.
        sec.verify_password(password, _DUMMY_HASH)
        raise _unauthorized(INVALID_CREDENTIALS)

    now = utcnow()
    if user.locked_until is not None:
        if user.locked_until > now:
            minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Compte verrouillé après trop d'échecs. Réessayez dans {minutes} min.",
            )
        # Verrou expiré : on repart de zéro.
        user.locked_until = None
        user.failed_attempts = 0

    if not sec.verify_password(password, user.hashed_password):
        user.failed_attempts += 1
        if user.failed_attempts >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_attempts = 0
        db.commit()
        raise _unauthorized(INVALID_CREDENTIALS)

    if not user.is_active:
        raise _unauthorized(INVALID_CREDENTIALS)

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    db.commit()
    return user


def issue_tokens(db: Session, user: User) -> dict:
    access = sec.create_access_token(user.id)
    refresh, jti, exp = sec.create_refresh_token(user.id)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=exp.replace(tzinfo=None)))
    db.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


def revoke_all_refresh(db: Session, user_id: str) -> None:
    for token in db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)
        )
    ):
        token.revoked = True
    db.commit()


def rotate_refresh(db: Session, refresh_token: str) -> dict:
    """Valide le refresh en base (via son jti), le révoque et en émet un neuf."""
    try:
        payload = sec.decode_token(refresh_token, sec.REFRESH)
    except sec.TokenError:
        raise _unauthorized("Session expirée")

    stored = db.scalar(select(RefreshToken).where(RefreshToken.jti == payload["jti"]))
    if stored is None or stored.user_id != payload["sub"]:
        raise _unauthorized("Session expirée")
    if stored.revoked:
        # Réutilisation d'un jeton déjà tourné : il a probablement fuité.
        # On coupe toutes les sessions de ce compte.
        revoke_all_refresh(db, stored.user_id)
        raise _unauthorized("Session expirée")
    if stored.expires_at <= utcnow():
        raise _unauthorized("Session expirée")

    user = db.get(User, stored.user_id)
    if user is None or not user.is_active:
        raise _unauthorized("Session expirée")

    stored.revoked = True
    db.flush()
    return issue_tokens(db, user)


# --- Garde-fous « dernier administrateur » ---------------------------------

def _is_admin_role(role: Role, permissions: set[str] | None = None) -> bool:
    codes = permissions if permissions is not None else set(role.permission_codes)
    return ADMIN_CAPABILITIES <= codes


def _active_admins(db: Session) -> list[User]:
    return [
        u for u in db.scalars(select(User).where(User.is_active.is_(True)))
        if _is_admin_role(u.role)
    ]


def ensure_not_last_admin(db: Session, user: User) -> None:
    """Refuse l'opération si `user` est le dernier administrateur actif."""
    if not user.is_active or not _is_admin_role(user.role):
        return
    others = [u for u in _active_admins(db) if u.id != user.id]
    if not others:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Opération refusée : c'est le dernier administrateur actif.",
        )


# --- Utilisateurs ----------------------------------------------------------

def _get_role(db: Session, role_id: str) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rôle inconnu")
    return role


def create_user(db: Session, data: UserCreate) -> User:
    email = normalize_email(data.email)
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Un compte existe déjà pour cet email")
    role = _get_role(db, data.role_id)
    user = User(
        email=email,
        full_name=data.full_name.strip(),
        hashed_password=sec.hash_password(data.password),
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, data: UserUpdate) -> User:
    new_role = _get_role(db, data.role_id) if data.role_id is not None else None

    removes_admin = (
        (data.is_active is False)
        or (new_role is not None and not _is_admin_role(new_role))
    )
    if removes_admin:
        ensure_not_last_admin(db, user)

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if new_role is not None:
        user.role_id = new_role.id
    if data.is_active is not None:
        user.is_active = data.is_active
        if not data.is_active:
            revoke_all_refresh(db, user.id)
    if data.password is not None:
        user.hashed_password = sec.hash_password(data.password)
        user.failed_attempts = 0
        user.locked_until = None
        revoke_all_refresh(db, user.id)
    db.commit()
    db.refresh(user)
    return user


def change_password(db: Session, user: User, current: str, new: str) -> None:
    if not sec.verify_password(current, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mot de passe actuel incorrect")
    user.hashed_password = sec.hash_password(new)
    db.commit()
    revoke_all_refresh(db, user.id)  # toutes les sessions doivent se reconnecter


def delete_user(db: Session, user: User, actor: User) -> None:
    if user.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vous ne pouvez pas supprimer votre propre compte")
    ensure_not_last_admin(db, user)
    db.delete(user)
    db.commit()


# --- Rôles -----------------------------------------------------------------

def _resolve_permissions(db: Session, codes: list[str]) -> list[Permission]:
    wanted = set(codes)
    found = {p.code: p for p in db.scalars(select(Permission).where(Permission.code.in_(wanted)))}
    unknown = sorted(wanted - found.keys())
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Permissions inconnues : {', '.join(unknown)}"
        )
    return list(found.values())


def _ensure_name_free(db: Session, name: str, except_id: str | None = None) -> None:
    other = db.scalar(select(Role).where(Role.name == name))
    if other is not None and other.id != except_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Un rôle porte déjà ce nom")


def create_role(db: Session, data: RoleCreate) -> Role:
    name = data.name.strip()
    _ensure_name_free(db, name)
    role = Role(
        name=name,
        description=data.description.strip(),
        is_system=False,
        permissions=_resolve_permissions(db, data.permissions),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def update_role(db: Session, role: Role, data: RoleUpdate) -> Role:
    if role.is_system:
        if data.name is not None and data.name.strip() != role.name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un rôle système ne peut pas être renommé")
        if role.name == ADMIN_ROLE and data.permissions is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Les permissions du rôle admin sont fixes (toutes les permissions)",
            )

    if data.name is not None:
        _ensure_name_free(db, data.name.strip(), except_id=role.id)

    if data.permissions is not None:
        new_perms = _resolve_permissions(db, data.permissions)
        new_codes = {p.code for p in new_perms}
        # Retirer une capacité d'administration à un rôle qui porte le dernier
        # administrateur actif verrouillerait la plateforme.
        if _is_admin_role(role) and not _is_admin_role(role, new_codes):
            holders = [u for u in role.users if u.is_active]
            if holders:
                others = [u for u in _active_admins(db) if u.role_id != role.id]
                if not others:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "Opération refusée : ce rôle porte le dernier administrateur actif.",
                    )
        role.permissions = new_perms

    if data.name is not None:
        role.name = data.name.strip()
    if data.description is not None:
        role.description = data.description.strip()
    db.commit()
    db.refresh(role)
    return role


def delete_role(db: Session, role: Role) -> None:
    if role.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un rôle système ne peut pas être supprimé")
    if role.users:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Rôle encore attribué à {len(role.users)} utilisateur(s)",
        )
    db.delete(role)
    db.commit()
