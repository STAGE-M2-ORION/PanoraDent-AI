"""Amorçage idempotent de l'authentification : `python -m app.seed_auth`.

- insère les permissions manquantes (et met à jour leur description) ;
- crée les rôles système manquants ; le rôle `admin` est toujours resynchronisé
  sur TOUTES les permissions (une nouvelle permission lui arrive d'elle-même),
  mais `practitioner` et `viewer` ne sont jamais modifiés une fois créés, pour
  ne pas écraser les réglages d'un administrateur à chaque redémarrage ;
- crée un administrateur initial SEULEMENT s'il n'existe aucun admin actif.

Variables : ADMIN_EMAIL, ADMIN_PASSWORD. Sans mot de passe, un mot de passe
aléatoire est généré et affiché UNE seule fois.
"""
import os
import secrets
import sys

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth_models import Permission, Role, User
from .auth_schemas import PASSWORD_MIN_LENGTH
from .auth_security import hash_password
from .database import SessionLocal
from .permissions import ADMIN_CAPABILITIES, ADMIN_ROLE, PERMISSIONS, SYSTEM_ROLES

# Domaine d'exemple : à remplacer par ADMIN_EMAIL. (Les domaines réservés
# comme « .local » sont rejetés par email-validator.)
DEFAULT_ADMIN_EMAIL = "admin@example.com"


def seed_permissions(db: Session) -> dict[str, Permission]:
    existing = {p.code: p for p in db.scalars(select(Permission))}
    for code, description in PERMISSIONS.items():
        if code in existing:
            existing[code].description = description
        else:
            existing[code] = Permission(code=code, description=description)
            db.add(existing[code])
    db.flush()
    return existing


def seed_roles(db: Session, perms: dict[str, Permission]) -> dict[str, Role]:
    roles = {r.name: r for r in db.scalars(select(Role))}
    for name, (description, codes) in SYSTEM_ROLES.items():
        role = roles.get(name)
        if role is None:
            role = Role(
                name=name,
                description=description,
                is_system=True,
                permissions=[perms[c] for c in sorted(codes)],
            )
            db.add(role)
            roles[name] = role
        else:
            role.is_system = True
            if name == ADMIN_ROLE:
                role.permissions = [perms[c] for c in sorted(codes)]
    db.flush()
    return roles


def has_active_admin(db: Session) -> bool:
    return any(
        ADMIN_CAPABILITIES <= set(u.role.permission_codes)
        for u in db.scalars(select(User).where(User.is_active.is_(True)))
    )


def seed_admin(db: Session, admin_role: Role) -> None:
    if has_active_admin(db):
        print("[seed_auth] un administrateur actif existe déjà : rien à créer.")
        return

    raw_email = (os.environ.get("ADMIN_EMAIL") or DEFAULT_ADMIN_EMAIL).strip()
    try:
        email = validate_email(raw_email, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        sys.exit(f"[seed_auth] ADMIN_EMAIL invalide ({raw_email!r}) : {exc}")

    password = os.environ.get("ADMIN_PASSWORD") or ""
    generated = not password
    if generated:
        password = secrets.token_urlsafe(16)
    elif len(password) < PASSWORD_MIN_LENGTH:
        sys.exit(f"[seed_auth] ADMIN_PASSWORD trop court ({PASSWORD_MIN_LENGTH} caractères minimum).")

    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        # Le compte existe mais n'est pas (ou plus) administrateur actif.
        existing.role_id = admin_role.id
        existing.is_active = True
        existing.hashed_password = hash_password(password)
        existing.failed_attempts = 0
        existing.locked_until = None
        print(f"[seed_auth] compte {email} restauré comme administrateur.")
    else:
        db.add(User(
            email=email,
            full_name="Administrateur",
            hashed_password=hash_password(password),
            role_id=admin_role.id,
        ))
        print(f"[seed_auth] administrateur créé : {email}")

    if generated:
        print("[seed_auth] ADMIN_PASSWORD absent : mot de passe généré, affiché UNE seule fois :")
        print(f"[seed_auth]   {password}")
        print("[seed_auth] Changez-le dès la première connexion.")


def main() -> None:
    with SessionLocal() as db:
        perms = seed_permissions(db)
        roles = seed_roles(db, perms)
        seed_admin(db, roles[ADMIN_ROLE])
        db.commit()
    print("[seed_auth] terminé.")


if __name__ == "__main__":
    main()
