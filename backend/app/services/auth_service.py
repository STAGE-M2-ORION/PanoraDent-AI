"""Logique métier : rattachement d'une identité Google à un compte, sessions,
administration des comptes et des rôles.

Les erreurs destinées à l'API sont levées en `ApiError` (forme unique
`{code, message}`) ; les refus de connexion en `RefusConnexion`, que la route
de retour traduit en redirection `/connexion?erreur=<code>`.
"""
import uuid
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth_security as sec
from ..auth_models import (
    Permission, Role, SessionUtilisateur, StatutUtilisateur, Utilisateur, maintenant,
)
from ..auth_schemas import (
    RoleCreation, RoleModification, UtilisateurCreation, UtilisateurModification,
)
from ..config import settings
from ..errors import ApiError
from ..permissions import ADMIN_CAPABILITIES, ADMIN_ROLE


def normaliser_email(email: str) -> str:
    return email.strip().lower()


def par_email(db: Session, email: str) -> Utilisateur | None:
    return db.scalar(select(Utilisateur).where(func.lower(Utilisateur.email) == normaliser_email(email)))


# --- Connexion Google ------------------------------------------------------

class RefusConnexion(Exception):
    """`code` part dans l'URL (et devient un message à l'écran) ; `motif`, plus
    précis, ne va qu'au journal."""

    def __init__(self, code: str, motif: str, utilisateur_id: uuid.UUID | None = None):
        super().__init__(motif)
        self.code = code
        self.motif = motif
        self.utilisateur_id = utilisateur_id


def rattacher_identite(db: Session, claims: dict) -> tuple[Utilisateur, str]:
    """Trouve le compte correspondant à un jeton d'identité DÉJÀ VÉRIFIÉ.

    Règle : le `sub` Google identifie l'utilisateur dès qu'il est connu (une
    adresse peut changer, le `sub` jamais). Sinon l'adresse sert, une seule
    fois, à rattacher le `sub`. Aucun compte n'est jamais créé ici.

    Renvoie `(utilisateur, détail pour le journal)` ; ne valide pas la
    transaction (l'appelant ouvre la session puis valide).
    """
    sub = str(claims["sub"])
    email = normaliser_email(str(claims["email"]))
    detail = f"adresse={email}"

    domaine = settings.google_allowed_domain.strip().lower()
    if domaine and str(claims.get("hd", "")).lower() != domaine:
        raise RefusConnexion("compte_inconnu", f"domaine_refuse {detail}")

    utilisateur = db.scalar(select(Utilisateur).where(Utilisateur.google_sub == sub))
    nouvelle_adresse = None
    if utilisateur is not None:
        if utilisateur.email != email:
            autre = par_email(db, email)
            if autre is not None and autre.id != utilisateur.id:
                raise RefusConnexion(
                    "compte_inconnu", f"adresse_deja_associee_a_un_autre_compte {detail}", utilisateur.id
                )
            nouvelle_adresse = email
    else:
        utilisateur = par_email(db, email)
        if utilisateur is None:
            raise RefusConnexion("compte_inconnu", f"adresse_inconnue {detail}")
        if utilisateur.google_sub is not None and utilisateur.google_sub != sub:
            # Même adresse, autre compte Google : on ne remplace pas une
            # identité établie sans l'administrateur.
            raise RefusConnexion("compte_inconnu", f"sub_different {detail}", utilisateur.id)

    if not utilisateur.actif:
        raise RefusConnexion("compte_desactive", f"compte_desactive {detail}", utilisateur.id)

    if nouvelle_adresse is not None:
        detail += f" ancienne_adresse={utilisateur.email}"
        utilisateur.email = nouvelle_adresse
    if utilisateur.google_sub is None:
        utilisateur.google_sub = sub
        detail += " premiere_connexion"
    if not utilisateur.prenom.strip():
        utilisateur.prenom = str(claims.get("given_name") or "")[:120]
    if not utilisateur.nom.strip():
        utilisateur.nom = str(claims.get("family_name") or "")[:120]
    utilisateur.photo_google = photo_google(claims)
    utilisateur.derniere_connexion = maintenant()
    return utilisateur, detail


def photo_google(claims: dict) -> str | None:
    """URL de la photo du compte Google, seulement si elle est servie en HTTPS
    par Google : l'interface l'affiche telle quelle dans une balise <img>."""
    url = str(claims.get("picture") or "")
    hote = urlparse(url).hostname or ""
    if url.startswith("https://") and len(url) <= 1024 and (
        hote == "googleusercontent.com" or hote.endswith(".googleusercontent.com")
    ):
        return url
    return None


# --- Sessions --------------------------------------------------------------

def ouvrir_session(db: Session, utilisateur: Utilisateur) -> tuple[str, str, datetime]:
    """Crée la ligne de session et renvoie `(accès, rafraîchissement, expiration)`.
    Ne valide pas la transaction."""
    expiration = maintenant() + sec.refresh_ttl()
    session = SessionUtilisateur(utilisateur_id=utilisateur.id, date_expiration=expiration)
    db.add(session)
    db.flush()
    acces = sec.create_access_token(
        utilisateur.id, session.id, utilisateur.role.libelle, utilisateur.permission_codes
    )
    return acces, sec.create_refresh_token(session.id, expiration), expiration


def session_depuis_rafraichissement(db: Session, jeton: str | None) -> SessionUtilisateur | None:
    """Session désignée par un jeton de rafraîchissement, valide ou non."""
    if not jeton:
        return None
    try:
        payload = sec.decode_token(jeton, sec.REFRESH)
        return db.get(SessionUtilisateur, uuid.UUID(payload["sub"]))
    except (sec.TokenError, ValueError):
        return None


def session_depuis_id(db: Session, session_id) -> SessionUtilisateur | None:
    try:
        return db.get(SessionUtilisateur, uuid.UUID(str(session_id)))
    except (ValueError, TypeError):
        return None


def rafraichir(db: Session, jeton: str | None) -> tuple[str, Utilisateur]:
    """Nouveau jeton d'accès pour une session valide ; 401 sinon."""
    session = session_depuis_rafraichissement(db, jeton)
    if session is None or not session.valide():
        raise ApiError(401, "session_expiree", "Votre session a expiré. Reconnectez-vous.")
    utilisateur = session.utilisateur
    if not utilisateur.actif:
        raise ApiError(401, "session_expiree", "Votre session a expiré. Reconnectez-vous.")
    acces = sec.create_access_token(
        utilisateur.id, session.id, utilisateur.role.libelle, utilisateur.permission_codes
    )
    return acces, utilisateur


def revoquer_session(session: SessionUtilisateur) -> None:
    if session.date_revocation is None:
        session.date_revocation = maintenant()


def revoquer_sessions(db: Session, utilisateur_id: uuid.UUID) -> None:
    for session in db.scalars(
        select(SessionUtilisateur).where(
            SessionUtilisateur.utilisateur_id == utilisateur_id,
            SessionUtilisateur.date_revocation.is_(None),
        )
    ):
        revoquer_session(session)


# --- Garde-fous « dernier administrateur » ---------------------------------

def _est_role_admin(role: Role, permissions: set[str] | None = None) -> bool:
    codes = permissions if permissions is not None else set(role.permission_codes)
    return ADMIN_CAPABILITIES <= codes


def _admins_actifs(db: Session) -> list[Utilisateur]:
    return [
        u for u in db.scalars(select(Utilisateur).where(Utilisateur.statut == StatutUtilisateur.actif))
        if _est_role_admin(u.role)
    ]


def _dernier_admin() -> ApiError:
    return ApiError(
        400, "dernier_administrateur",
        "Opération refusée : c'est le dernier administrateur actif.",
    )


def verifier_pas_dernier_admin(db: Session, utilisateur: Utilisateur) -> None:
    if not utilisateur.actif or not _est_role_admin(utilisateur.role):
        return
    if not [u for u in _admins_actifs(db) if u.id != utilisateur.id]:
        raise _dernier_admin()


# --- Comptes ---------------------------------------------------------------

def _role(db: Session, role_id: uuid.UUID) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise ApiError(422, "champ_invalide", "Champ invalide : role_id (rôle inconnu).")
    return role


def creer_utilisateur(db: Session, data: UtilisateurCreation) -> Utilisateur:
    email = normaliser_email(data.email)
    if par_email(db, email) is not None:
        raise ApiError(409, "adresse_deja_prise", "Un compte existe déjà pour cette adresse.")
    role = _role(db, data.role_id)
    utilisateur = Utilisateur(
        email=email, nom=data.nom.strip(), prenom=data.prenom.strip(), role_id=role.id
    )
    db.add(utilisateur)
    db.flush()
    db.refresh(utilisateur)
    return utilisateur


def modifier_utilisateur(db: Session, utilisateur: Utilisateur, data: UtilisateurModification) -> Utilisateur:
    nouveau_role = _role(db, data.role_id) if data.role_id is not None else None
    retire_admin = (
        data.statut == StatutUtilisateur.desactive
        or (nouveau_role is not None and not _est_role_admin(nouveau_role))
    )
    if retire_admin:
        verifier_pas_dernier_admin(db, utilisateur)

    if data.nom is not None:
        utilisateur.nom = data.nom.strip()
    if data.prenom is not None:
        utilisateur.prenom = data.prenom.strip()
    if nouveau_role is not None:
        utilisateur.role_id = nouveau_role.id
    if data.statut is not None:
        utilisateur.statut = data.statut
        if data.statut == StatutUtilisateur.desactive:
            revoquer_sessions(db, utilisateur.id)
    db.flush()
    db.refresh(utilisateur)
    return utilisateur


# --- Rôles -----------------------------------------------------------------

def _permissions(db: Session, codes: list[str]) -> list[Permission]:
    voulues = set(codes)
    trouvees = {p.code: p for p in db.scalars(select(Permission).where(Permission.code.in_(voulues)))}
    inconnues = sorted(voulues - trouvees.keys())
    if inconnues:
        raise ApiError(422, "champ_invalide", f"Permissions inconnues : {', '.join(inconnues)}.")
    return list(trouvees.values())


def _libelle_libre(db: Session, libelle: str, sauf: uuid.UUID | None = None) -> None:
    autre = db.scalar(select(Role).where(func.lower(Role.libelle) == libelle.lower()))
    if autre is not None and autre.id != sauf:
        raise ApiError(409, "libelle_deja_pris", "Un rôle porte déjà ce libellé.")


def creer_role(db: Session, data: RoleCreation) -> Role:
    libelle = data.libelle.strip()
    _libelle_libre(db, libelle)
    role = Role(libelle=libelle, systeme=False, permissions=_permissions(db, data.permissions))
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def modifier_role(db: Session, role: Role, data: RoleModification) -> Role:
    if role.systeme:
        if data.libelle is not None and data.libelle.strip() != role.libelle:
            raise ApiError(400, "role_systeme", "Un rôle système ne peut pas être renommé.")
        if role.libelle == ADMIN_ROLE and data.permissions is not None:
            raise ApiError(400, "role_systeme", "Les permissions du rôle Administrateur sont fixes.")

    if data.libelle is not None:
        _libelle_libre(db, data.libelle.strip(), sauf=role.id)

    if data.permissions is not None:
        nouvelles = _permissions(db, data.permissions)
        codes = {p.code for p in nouvelles}
        # Retirer une capacité d'administration au rôle qui porte le dernier
        # administrateur actif verrouillerait la plateforme.
        if _est_role_admin(role) and not _est_role_admin(role, codes):
            if [u for u in role.utilisateurs if u.actif]:
                if not [u for u in _admins_actifs(db) if u.role_id != role.id]:
                    raise _dernier_admin()
        role.permissions = nouvelles

    if data.libelle is not None:
        role.libelle = data.libelle.strip()
    db.commit()
    db.refresh(role)
    return role


def supprimer_role(db: Session, role: Role) -> None:
    if role.systeme:
        raise ApiError(400, "role_systeme", "Un rôle système ne peut pas être supprimé.")
    if role.utilisateurs:
        raise ApiError(
            400, "role_utilise", f"Rôle encore attribué à {len(role.utilisateurs)} utilisateur(s)."
        )
    db.delete(role)
    db.commit()
