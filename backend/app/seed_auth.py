"""Jeu de départ, rejouable sans erreur : `python -m app.seed_auth`.

Chaque insertion vérifie d'abord l'existence de la ligne :

- les huit permissions (le libellé est resynchronisé) ;
- les trois rôles système ; le rôle Administrateur est toujours resynchronisé
  sur TOUTES les permissions, Praticien et Lecteur ne sont plus modifiés une
  fois créés (pour ne pas écraser les réglages d'un administrateur) ;
- le compte administrateur dont l'adresse vient de ADMIN_EMAIL — l'adresse
  Google de l'administrateur, sans quoi personne ne peut ouvrir la première
  session. S'il existe déjà, il n'est pas modifié, sauf s'il n'y a plus aucun
  administrateur actif : il est alors rétabli.

Aucun mot de passe : la connexion passe uniquement par Google.
"""
import os

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth_models import Permission, Role, Utilisateur
from .database import SessionLocal
from .permissions import ADMIN_CAPABILITIES, ADMIN_ROLE, PERMISSIONS, SYSTEM_ROLES
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
            role = Role(libelle=libelle, systeme=True, permissions=[perms[c] for c in sorted(codes)])
            db.add(role)
            roles[libelle] = role
        else:
            role.systeme = True
            if libelle == ADMIN_ROLE:
                role.permissions = [perms[c] for c in sorted(codes)]
    db.flush()
    return roles


def admin_actif_existe(db: Session) -> bool:
    return any(
        ADMIN_CAPABILITIES <= set(u.permission_codes)
        for u in db.scalars(select(Utilisateur).where(Utilisateur.actif.is_(True)))
    )


def seed_admin(db: Session, role_admin: Role, adresse: str | None) -> None:
    adresse = (adresse or "").strip()
    if not adresse:
        if not admin_actif_existe(db):
            print("[seed_auth] ATTENTION : ADMIN_EMAIL est vide et aucun administrateur actif "
                  "n'existe. Personne ne pourra ouvrir la première session.")
        return
    try:
        email = validate_email(adresse, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise SystemExit(f"[seed_auth] ADMIN_EMAIL invalide ({adresse!r}) : {exc}")

    existant = par_email(db, email)
    if existant is None:
        db.add(Utilisateur(email=email, role_id=role_admin.id))
        print(f"[seed_auth] compte administrateur créé : {email}")
    elif not admin_actif_existe(db):
        existant.role_id = role_admin.id
        existant.actif = True
        print(f"[seed_auth] aucun administrateur actif : {email} rétabli.")


def main() -> None:
    with SessionLocal() as db:
        perms = seed_permissions(db)
        roles = seed_roles(db, perms)
        seed_admin(db, roles[ADMIN_ROLE], os.environ.get("ADMIN_EMAIL"))
        db.commit()
    print("[seed_auth] terminé.")


if __name__ == "__main__":
    main()
