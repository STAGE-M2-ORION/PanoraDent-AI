"""Jeu de départ, rejouable sans erreur : `python -m app.seed_auth`.

Chaque insertion vérifie d'abord l'existence de la ligne :

- les permissions du catalogue (`permissions.py` ; le libellé est resynchronisé) ;
- les trois rôles système, toujours resynchronisés (permissions et
  description) : ils ne sont pas modifiables depuis l'application, c'est donc
  ce fichier qui fait foi ;
- le compte administrateur dont l'adresse vient de ADMIN_EMAIL, avec les
  deux modes de connexion autorisés. S'il existe déjà, seuls ses modes sont
  complétés ; il est rétabli s'il n'y a plus aucun administrateur actif.

Tant que l'administrateur n'a pas choisi de mot de passe, un lien de première
connexion (valable 24 h) est émis à chaque passage — ce qui invalide le
précédent. Hors production il est affiché dans la console ; en production il
n'est jamais écrit dans les journaux du conteneur. Le mode Google reste
utilisable entre-temps.
"""
import os

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth_models import MODES_CONNEXION, Permission, Role, TypeJeton, Utilisateur
from .config import settings
from .database import SessionLocal
from .permissions import ADMIN_CAPABILITIES, ADMIN_ROLE, PERMISSIONS, SYSTEM_ROLE_DESCRIPTIONS, SYSTEM_ROLES
from .services import jetons
from .services.auth_service import par_email


def seed_permissions(db: Session) -> dict[str, Permission]:
    existantes = {p.code: p for p in db.scalars(select(Permission))}
    for code, libelle in PERMISSIONS.items():
        if code in existantes:
            existantes[code].libelle = libelle
        else:
            existantes[code] = Permission(code=code, libelle=libelle)
            db.add(existantes[code])
    db.flush()
    return existantes


def seed_roles(db: Session, perms: dict[str, Permission]) -> dict[str, Role]:
    roles = {r.libelle: r for r in db.scalars(select(Role))}
    for libelle, codes in SYSTEM_ROLES.items():
        role = roles.get(libelle)
        if role is None:
            role = Role(libelle=libelle, systeme=True)
            db.add(role)
            roles[libelle] = role
        role.systeme = True
        role.description = SYSTEM_ROLE_DESCRIPTIONS[libelle]
        role.permissions = [perms[c] for c in sorted(codes)]
    db.flush()
    return roles


def admin_actif_existe(db: Session) -> bool:
    return any(
        ADMIN_CAPABILITIES <= set(u.permission_codes)
        for u in db.scalars(select(Utilisateur).where(Utilisateur.actif.is_(True)))
    )


def seed_admin(db: Session, role_admin: Role, adresse: str | None) -> str | None:
    """Renvoie le lien de première connexion émis, s'il y en a un."""
    adresse = (adresse or "").strip()
    if not adresse:
        if not admin_actif_existe(db):
            print("[seed_auth] ATTENTION : ADMIN_EMAIL est vide et aucun administrateur actif "
                  "n'existe. Personne ne pourra ouvrir la première session.")
        return None
    try:
        email = validate_email(adresse, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise SystemExit(f"[seed_auth] ADMIN_EMAIL invalide ({adresse!r}) : {exc}")

    admin = par_email(db, email)
    if admin is None:
        admin = Utilisateur(email=email, role_id=role_admin.id, modes_connexion=list(MODES_CONNEXION))
        db.add(admin)
        db.flush()
        print(f"[seed_auth] compte administrateur créé : {email}")
    else:
        if not admin_actif_existe(db):
            admin.role_id = role_admin.id
            admin.actif = True
            print(f"[seed_auth] aucun administrateur actif : {email} rétabli.")
        modes = list(MODES_CONNEXION)
        if admin.modes_connexion != modes:
            admin.modes_connexion = modes
            print(f"[seed_auth] {email} : modes de connexion {', '.join(modes)}.")

    if admin.mot_de_passe is not None:
        return None
    if settings.app_env.lower() == "production":
        # Un lien d'accès administrateur n'a rien à faire dans les journaux.
        print(f"[seed_auth] {email} n'a pas encore de mot de passe : connectez-vous avec Google.")
        return None
    lien = jetons.lien(
        TypeJeton.premiere_connexion, jetons.emettre(db, admin, TypeJeton.premiere_connexion)
    )
    print(f"[seed_auth] lien de première connexion pour {email} (24 h) :\n  {lien}")
    return lien


def main() -> None:
    with SessionLocal() as db:
        perms = seed_permissions(db)
        roles = seed_roles(db, perms)
        seed_admin(db, roles[ADMIN_ROLE], os.environ.get("ADMIN_EMAIL"))
        db.commit()
    print("[seed_auth] terminé.")


if __name__ == "__main__":
    main()
