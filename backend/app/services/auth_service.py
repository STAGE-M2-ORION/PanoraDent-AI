"""Logique métier : connexion par mot de passe, rattachement d'une identité
Google à un compte, sessions, administration des comptes et des rôles.

Les erreurs destinées à l'API sont levées en `ApiError` (forme unique
`{code, message}`) ; les refus de connexion en `RefusConnexion`, que la route
de retour traduit en redirection `/connexion?erreur=<code>`.
"""
import hmac
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth_security as sec
from .. import journal
from ..auth_models import (
    MODE_MOT_DE_PASSE, Permission, Role, SessionUtilisateur, TypeJeton, Utilisateur, en_utc,
    maintenant,
)
from ..auth_schemas import (
    RoleCreation, RoleModification, UtilisateurCreation, UtilisateurModification,
)
from ..config import settings
from ..errors import ApiError
from ..permissions import ADMIN_CAPABILITIES, ADMIN_ROLE
from . import courriel, jetons


def normaliser_email(email: str) -> str:
    return email.strip().lower()


def par_email(db: Session, email: str) -> Utilisateur | None:
    return db.scalar(select(Utilisateur).where(func.lower(Utilisateur.email) == normaliser_email(email)))


# --- Connexion par mot de passe ------------------------------------------------

MESSAGE_IDENTIFIANTS = "Adresse e-mail ou mot de passe incorrect."


def _identifiants_invalides() -> ApiError:
    # Même code, même message que l'adresse soit inconnue, le mot de passe
    # faux, absent ou non autorisé : le formulaire ne doit pas servir
    # d'annuaire des comptes.
    return ApiError(401, "identifiants_invalides", MESSAGE_IDENTIFIANTS)


def connexion_mot_de_passe(
    db: Session, email: str, mot_de_passe: str, request: Request | None = None
) -> Utilisateur:
    """Vérifie les identifiants et renvoie le compte. Les refus sont inscrits
    au journal et VALIDÉS (compteur d'échecs, verrouillage) avant d'être levés.

    Ordre des contrôles :
    1. compte désactivé → 403, quels que soient les identifiants ;
    2. compte verrouillé → 423, AVANT toute comparaison du mot de passe
       (sinon un compte verrouillé répondrait 401 au mauvais mot de passe et
       423 au bon, ce qui confirmerait le mot de passe) ;
    3. comparaison bcrypt, qui tourne même sans compte (empreinte factice).
    """
    instant = maintenant()
    adresse = normaliser_email(email)
    utilisateur = db.scalar(
        select(Utilisateur).where(func.lower(Utilisateur.email) == adresse)
        .with_for_update(of=Utilisateur)  # pas la jointure sur role (refusé par PostgreSQL)
    )

    def refus(erreur: ApiError, motif: str, **details) -> ApiError:
        journal.inscrire(
            db, "connexion", journal.REFUS, request=request,
            utilisateur_id=utilisateur.id if utilisateur else None,
            details={"mode": MODE_MOT_DE_PASSE, "code": erreur.code, "motif": motif,
                     "adresse": adresse, **details},
            commit=False,
        )
        db.commit()
        return erreur

    if utilisateur is not None and not utilisateur.actif:
        raise refus(ApiError(
            403, "compte_desactive",
            "Ce compte est désactivé. Contactez l'administrateur du cabinet.",
        ), "compte_desactive")

    verrou = en_utc(utilisateur.verrouille_jusqu_a) if utilisateur is not None else None
    if verrou is not None and verrou > instant:
        secondes = max(1, int((verrou - instant).total_seconds()))
        minutes = -(-secondes // 60)
        raise refus(ApiError(
            423, "compte_verrouille",
            f"Trop de tentatives échouées. Réessayez dans {minutes} minute{'s' if minutes > 1 else ''}.",
            details={"secondes_restantes": secondes},
            headers={"Retry-After": str(secondes)},
        ), "compte_verrouille")

    empreinte = None
    if utilisateur is not None and utilisateur.autorise(MODE_MOT_DE_PASSE):
        empreinte = utilisateur.mot_de_passe
    if not sec.verifier_mot_de_passe(mot_de_passe, empreinte):
        if utilisateur is None:
            raise refus(_identifiants_invalides(), "adresse_inconnue")
        motif = (
            "mode_non_autorise" if not utilisateur.autorise(MODE_MOT_DE_PASSE)
            else "mot_de_passe_non_defini" if utilisateur.mot_de_passe is None
            else "mot_de_passe_faux"
        )
        utilisateur.echecs_connexion = (utilisateur.echecs_connexion or 0) + 1
        if utilisateur.echecs_connexion >= settings.echecs_avant_verrouillage:
            utilisateur.verrouille_jusqu_a = instant + timedelta(minutes=settings.duree_verrouillage_minutes)
            utilisateur.echecs_connexion = 0
            journal.inscrire(
                db, "verrouillage", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                details={"jusqu_a": utilisateur.verrouille_jusqu_a.isoformat(),
                         "echecs": settings.echecs_avant_verrouillage},
                commit=False,
            )
        raise refus(_identifiants_invalides(), motif)

    utilisateur.echecs_connexion = 0
    utilisateur.verrouille_jusqu_a = None
    utilisateur.derniere_connexion = instant
    return utilisateur


# --- Liens : mot de passe oublié, réinitialisation, première connexion -----------

def traiter_demande_reinitialisation(fabrique, email: str, ip: str | None) -> None:
    """Tâche de fond de POST /auth/mot-de-passe/oubli.

    La route répond 204 AVANT d'exécuter ceci : qu'il y ait un compte ou non,
    la réponse ne varie ni dans son contenu ni dans son temps."""
    adresse = normaliser_email(email)
    with fabrique() as db:
        utilisateur = par_email(db, adresse)
        motif = (
            "adresse_inconnue" if utilisateur is None
            else "compte_desactive" if not utilisateur.actif
            else "mode_non_autorise" if not utilisateur.autorise(MODE_MOT_DE_PASSE)
            else ""
        )
        if motif:
            journal.inscrire(
                db, "demande_reinitialisation", journal.REFUS, ip=ip,
                utilisateur_id=utilisateur.id if utilisateur else None,
                details={"motif": motif, "adresse": adresse},
            )
            return
        jeton = jetons.emettre(db, utilisateur, TypeJeton.reinitialisation)
        journal.inscrire(
            db, "demande_reinitialisation", journal.SUCCES, ip=ip,
            utilisateur_id=utilisateur.id, details={"adresse": adresse}, commit=False,
        )
        db.commit()
        message = courriel.reinitialisation(
            utilisateur.email, utilisateur.prenom, jetons.lien(TypeJeton.reinitialisation, jeton)
        )
    courriel.envoyer(message)


def definir_mot_de_passe_par_lien(
    db: Session, jeton: str, type_: TypeJeton, nouveau: str, request: Request | None = None
) -> Utilisateur:
    """Première connexion ou réinitialisation : vérifie le lien, applique le
    nouveau mot de passe, consomme le lien et révoque TOUTES les sessions du
    compte (si quelqu'un d'autre était entré, il en sort). Ne valide pas la
    transaction ; l'appelant ouvre ensuite la nouvelle session."""
    ligne, motif = jetons.trouver(db, jeton, type_)
    utilisateur = db.get(Utilisateur, ligne.utilisateur_id) if ligne is not None else None
    if not motif and (utilisateur is None or not utilisateur.actif):
        motif = "compte_desactive"
    if not motif and not utilisateur.autorise(MODE_MOT_DE_PASSE):
        motif = "mode_non_autorise"
    if motif:
        db.rollback()
        journal.inscrire(
            db, "changement_mot_de_passe", journal.REFUS, request=request,
            utilisateur_id=utilisateur.id if utilisateur else None,
            details={"via": type_.value, "motif": motif},
        )
        raise jetons.lien_invalide()

    try:
        sec.verifier_politique(nouveau, utilisateur.email)
    except sec.MotDePasseTropFaible as exc:
        # Le lien n'est pas consommé : l'utilisateur corrige et réessaie.
        db.rollback()
        raise ApiError(422, "mot_de_passe_trop_faible", str(exc)) from exc

    jetons.consommer(db, ligne)
    utilisateur.mot_de_passe = sec.hacher_mot_de_passe(nouveau)
    utilisateur.doit_changer_mdp = False
    utilisateur.echecs_connexion = 0
    utilisateur.verrouille_jusqu_a = None
    utilisateur.derniere_connexion = maintenant()
    revoquer_sessions(db, utilisateur.id)
    journal.inscrire(
        db, "changement_mot_de_passe", journal.SUCCES, request=request,
        utilisateur_id=utilisateur.id, details={"via": type_.value}, commit=False,
    )
    return utilisateur


# --- Connexion Google ------------------------------------------------------

class RefusConnexion(Exception):
    """`code` part dans l'URL (et devient un message à l'écran) ; `motif`, plus
    précis, ne va qu'au journal."""

    def __init__(self, code: str, motif: str, utilisateur_id: uuid.UUID | None = None):
        super().__init__(motif)
        self.code = code
        self.motif = motif
        self.utilisateur_id = utilisateur_id


def rattacher_identite(db: Session, claims: dict) -> tuple[Utilisateur, dict]:
    """Trouve le compte correspondant à un jeton d'identité DÉJÀ VÉRIFIÉ.

    Règle : le `sub` Google identifie l'utilisateur dès qu'il est connu (une
    adresse peut changer, le `sub` jamais). Sinon l'adresse sert, une seule
    fois, à rattacher le `sub`. Aucun compte n'est jamais créé ici.

    Renvoie `(utilisateur, détails pour le journal)` ; ne valide pas la
    transaction (l'appelant ouvre la session puis valide).
    """
    sub = str(claims["sub"])
    email = normaliser_email(str(claims["email"]))
    detail = f"adresse={email}"  # contexte des motifs de refus
    details: dict = {"mode": "google", "adresse": email}

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
        details["ancienne_adresse"] = utilisateur.email
        utilisateur.email = nouvelle_adresse
    if utilisateur.google_sub is None:
        utilisateur.google_sub = sub
        details["premiere_connexion"] = True
    if not utilisateur.prenom.strip():
        utilisateur.prenom = str(claims.get("given_name") or "")[:120]
    if not utilisateur.nom.strip():
        utilisateur.nom = str(claims.get("family_name") or "")[:120]
    utilisateur.photo_google = photo_google(claims)
    utilisateur.derniere_connexion = maintenant()
    return utilisateur, details


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

def ouvrir_session(
    db: Session, utilisateur: Utilisateur, request: Request | None = None
) -> tuple[str, str, datetime]:
    """Crée la ligne de session et renvoie `(accès, rafraîchissement, expiration)`.
    Seule l'empreinte du jeton de rafraîchissement est conservée. Ne valide
    pas la transaction."""
    expiration = maintenant() + sec.refresh_ttl()
    session = SessionUtilisateur(
        utilisateur_id=utilisateur.id, expire_le=expiration,
        agent=journal.agent(request), ip=journal.adresse_ip(request),
    )
    db.add(session)
    db.flush()
    acces = sec.create_access_token(
        utilisateur.id, session.id, utilisateur.role.libelle, utilisateur.permission_codes
    )
    rafraichissement = sec.create_refresh_token(session.id, expiration)
    session.empreinte_refresh = sec.empreinte(rafraichissement)
    return acces, rafraichissement, expiration


def session_depuis_rafraichissement(db: Session, jeton: str | None) -> SessionUtilisateur | None:
    """Session désignée par un jeton de rafraîchissement, valide ou non."""
    if not jeton:
        return None
    try:
        payload = sec.decode_token(jeton, sec.REFRESH)
        session = db.get(SessionUtilisateur, uuid.UUID(payload["sub"]))
    except (sec.TokenError, ValueError):
        return None
    if session is None or not hmac.compare_digest(session.empreinte_refresh or "", sec.empreinte(jeton)):
        return None
    return session


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
    if session.revoquee_le is None:
        session.revoquee_le = maintenant()


def revoquer_sessions(db: Session, utilisateur_id: uuid.UUID) -> None:
    for session in db.scalars(
        select(SessionUtilisateur).where(
            SessionUtilisateur.utilisateur_id == utilisateur_id,
            SessionUtilisateur.revoquee_le.is_(None),
        )
    ):
        revoquer_session(session)


# --- Garde-fous « dernier administrateur » ---------------------------------

def _est_role_admin(role: Role, permissions: set[str] | None = None) -> bool:
    codes = permissions if permissions is not None else set(role.permission_codes)
    return ADMIN_CAPABILITIES <= codes


def _admins_actifs(db: Session) -> list[Utilisateur]:
    return [
        u for u in db.scalars(select(Utilisateur).where(Utilisateur.actif.is_(True)))
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
        email=email, nom=data.nom.strip(), prenom=data.prenom.strip(), role_id=role.id,
        modes_connexion=list(data.modes_connexion),
    )
    db.add(utilisateur)
    db.flush()
    db.refresh(utilisateur)
    return utilisateur


def modifier_utilisateur(
    db: Session, utilisateur: Utilisateur, data: UtilisateurModification, auteur: Utilisateur | None = None
) -> Utilisateur:
    nouveau_role = _role(db, data.role_id) if data.role_id is not None else None
    if auteur is not None and auteur.id == utilisateur.id:
        # On ne se retire pas soi-même l'accès : un autre administrateur doit le faire.
        if data.actif is False:
            raise ApiError(400, "action_sur_soi", "Vous ne pouvez pas désactiver votre propre compte.")
        if nouveau_role is not None and nouveau_role.id != utilisateur.role_id:
            raise ApiError(400, "action_sur_soi", "Vous ne pouvez pas changer votre propre rôle.")
    retire_admin = (
        data.actif is False
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
    if data.actif is not None:
        utilisateur.actif = data.actif
        if not data.actif:
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
