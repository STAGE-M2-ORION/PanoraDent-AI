import uuid
from datetime import datetime

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from .auth_models import MODES_CONNEXION, Role, Utilisateur, en_utc

ModeConnexion = Literal["mot_de_passe", "google"]

# Préférences par défaut : un compte qui n'a rien réglé les reçoit telles quelles.
PREFERENCES_DEFAUT = {
    "theme": "systeme",
    "langue": "fr",
    "seuil_confiance_defaut": 0.5,
    # E-mails de notification, par type (sprint 13). « Analyse terminée » ne
    # s'envoie pas par e-mail : elle arrive quelques secondes après le dépôt.
    "courriel_analyse_echouee": True,
    "courriel_analyse_rouverte": True,
    # Lecteurs : un praticien lui confie une analyse (sinon, il ne la voit pas).
    "courriel_analyse_confiee": True,
    # Administrateurs seulement : une demande d'accès attend une décision.
    "courriel_demande_acces": True,
}


def preferences_completes(preferences: dict | None) -> dict:
    stockees = dict(preferences or {})
    # Avant le sprint 13, une seule case « notifications par e-mail » (qui ne
    # déclenchait rien) : qui l'avait décochée ne reçoit aucun e-mail.
    if stockees.get("notifications") is False:
        stockees.setdefault("courriel_analyse_echouee", False)
        stockees.setdefault("courriel_analyse_rouverte", False)
        stockees.setdefault("courriel_analyse_confiee", False)
        stockees.setdefault("courriel_demande_acces", False)
    return {cle: stockees.get(cle, defaut) for cle, defaut in PREFERENCES_DEFAUT.items()}


def _url_photo(u: Utilisateur, taille: int | None = None) -> str:
    # La clé change à chaque import : l'URL aussi, le cache navigateur suit.
    jeton = u.photo_cle.rsplit("/", 1)[-1].split(".", 1)[0]
    suffixe = f"&taille={taille}" if taille else ""
    return f"/api/v1/photos/{u.id}?v={jeton}{suffixe}"


def _modes_valides(modes: list[str]) -> list[str]:
    # Ordre canonique et sans doublon ; la base refuse de toute façon une liste vide.
    uniques = [m for m in MODES_CONNEXION if m in modes]
    if not uniques:
        raise ValueError("au moins un mode de connexion est requis")
    return uniques


class PermissionOut(BaseModel):
    code: str
    libelle: str

    model_config = {"from_attributes": True}


class RoleResume(BaseModel):
    id: uuid.UUID
    libelle: str
    systeme: bool


class UtilisateurOut(BaseModel):
    id: uuid.UUID
    email: str
    nom: str
    prenom: str
    actif: bool
    modes_connexion: list[str]
    # Le compte a-t-il déjà de quoi se connecter avec chaque mode ?
    mot_de_passe_defini: bool
    google_rattache: bool
    doit_changer_mdp: bool
    titre: str | None
    specialite: str | None
    numero_ordre: str | None
    telephone: str | None
    preferences: dict
    role: RoleResume
    permissions: list[str]
    derniere_connexion: datetime | None
    cree_le: datetime
    # URL à afficher telle quelle : photo importée, sinon photo Google, sinon null.
    photo_url: str | None
    # Miniature 128 px (avatars), même règle.
    photo_miniature_url: str | None
    photo_source: str | None  # "importee" | "google" | None

    @classmethod
    def depuis(cls, u: Utilisateur) -> "UtilisateurOut":
        if u.photo_cle:
            photo_url, miniature, photo_source = _url_photo(u), _url_photo(u, 128), "importee"
        elif u.photo_google:
            photo_url, miniature, photo_source = u.photo_google, u.photo_google, "google"
        else:
            photo_url, miniature, photo_source = None, None, None
        return cls(
            id=u.id,
            email=u.email,
            nom=u.nom,
            prenom=u.prenom,
            actif=u.actif,
            modes_connexion=list(u.modes_connexion or []),
            mot_de_passe_defini=u.mot_de_passe is not None,
            google_rattache=u.google_sub is not None,
            doit_changer_mdp=u.doit_changer_mdp,
            titre=u.titre,
            specialite=u.specialite,
            numero_ordre=u.numero_ordre,
            telephone=u.telephone,
            preferences=preferences_completes(u.preferences),
            role=RoleResume(id=u.role.id, libelle=u.role.libelle, systeme=u.role.systeme),
            permissions=u.permission_codes,
            derniere_connexion=en_utc(u.derniere_connexion),
            cree_le=en_utc(u.cree_le),
            photo_url=photo_url,
            photo_miniature_url=miniature,
            photo_source=photo_source,
        )


class UtilisateurCreation(BaseModel):
    """Créé par l'administrateur, qui choisit les modes de connexion autorisés.
    Aucun mot de passe ici : l'intéressé le choisit lui-même par son lien de
    première connexion. Nom et prénom vides sont repris de Google au premier
    rattachement."""
    nom: str = Field(default="", max_length=120)
    prenom: str = Field(default="", max_length=120)
    email: EmailStr = Field(max_length=255)
    role_id: uuid.UUID
    modes_connexion: list[ModeConnexion] = Field(default_factory=lambda: list(MODES_CONNEXION))

    _modes = field_validator("modes_connexion")(_modes_valides)


class ConnexionEntree(BaseModel):
    """L'adresse n'est PAS validée comme e-mail : une adresse mal formée doit
    recevoir le même refus neutre qu'une adresse inconnue, pas un 422."""
    email: str = Field(max_length=320)
    mot_de_passe: str = Field(max_length=1024)


class ProfilModification(BaseModel):
    """Champs absents : inchangés. `null` ou vide : effacé."""
    model_config = {"extra": "forbid", "str_strip_whitespace": True}

    nom: str | None = Field(default=None, max_length=120)
    prenom: str | None = Field(default=None, max_length=120)
    titre: str | None = Field(default=None, max_length=80)
    specialite: str | None = Field(default=None, max_length=120)
    numero_ordre: str | None = Field(default=None, max_length=60)
    telephone: str | None = Field(default=None, max_length=30, pattern=r"^[0-9+()./ -]*$")

    @field_validator("titre", "specialite", "numero_ordre", "telephone")
    @classmethod
    def _vide_vers_null(cls, valeur: str | None) -> str | None:
        return valeur or None


class PreferencesModification(BaseModel):
    model_config = {"extra": "forbid"}

    theme: Literal["clair", "sombre", "systeme"] | None = None
    langue: Literal["fr", "en"] | None = None
    # Seuil appliqué à l'ouverture d'une analyse.
    seuil_confiance_defaut: float | None = Field(default=None, ge=0.05, le=0.95)
    courriel_analyse_echouee: bool | None = None
    courriel_analyse_rouverte: bool | None = None
    courriel_analyse_confiee: bool | None = None
    courriel_demande_acces: bool | None = None


class ChangementMotDePasse(BaseModel):
    # Facultatif seulement pour un compte qui n'a pas encore de mot de passe.
    ancien: str | None = Field(default=None, max_length=1024)
    nouveau: str = Field(max_length=1024)


class SessionOut(BaseModel):
    id: uuid.UUID
    agent: str | None
    ip: str | None
    cree_le: datetime
    expire_le: datetime
    courante: bool


class OubliEntree(BaseModel):
    email: str = Field(max_length=320)


class ReinitialisationEntree(BaseModel):
    jeton: str = Field(max_length=256)
    nouveau: str = Field(max_length=1024)


class PremiereConnexionEntree(BaseModel):
    jeton: str = Field(max_length=256)
    mot_de_passe: str = Field(max_length=1024)


class UtilisateurModification(BaseModel):
    """`motif` est obligatoire pour une désactivation ou un changement de rôle :
    il est inscrit au journal avec l'action."""
    nom: str | None = Field(default=None, max_length=120)
    prenom: str | None = Field(default=None, max_length=120)
    role_id: uuid.UUID | None = None
    actif: bool | None = None
    modes_connexion: list[ModeConnexion] | None = None
    motif: str | None = Field(default=None, max_length=500)

    @field_validator("modes_connexion")
    @classmethod
    def _modes(cls, modes):
        return None if modes is None else _modes_valides(modes)


class RoleCreation(BaseModel):
    libelle: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=255)
    permissions: list[str] = []


class RoleModification(BaseModel):
    """`permissions`, s'il est fourni, REMPLACE l'ensemble des permissions."""
    libelle: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=255)
    permissions: list[str] | None = None


class RoleDuplication(BaseModel):
    """Sans libellé : « Copie de <rôle> » (numérotée si elle existe déjà)."""
    libelle: str | None = Field(default=None, min_length=2, max_length=80)


class RoleOut(BaseModel):
    id: uuid.UUID
    libelle: str
    description: str
    systeme: bool
    permissions: list[str]
    nb_utilisateurs: int

    @classmethod
    def depuis(cls, role: Role) -> "RoleOut":
        return cls(
            id=role.id,
            libelle=role.libelle,
            description=role.description or "",
            systeme=role.systeme,
            permissions=role.permission_codes,
            nb_utilisateurs=len(role.utilisateurs),
        )
