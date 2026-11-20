import uuid
from datetime import datetime

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from .auth_models import MODES_CONNEXION, Role, Utilisateur, en_utc

ModeConnexion = Literal["mot_de_passe", "google"]


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
    photo_source: str | None  # "importee" | "google" | None

    @classmethod
    def depuis(cls, u: Utilisateur) -> "UtilisateurOut":
        if u.photo_cle:
            # La clé change à chaque import : l'URL aussi, le cache navigateur suit.
            jeton = u.photo_cle.rsplit("/", 1)[-1].split(".", 1)[0]
            photo_url, photo_source = f"/api/v1/photos/{u.id}?v={jeton}", "importee"
        elif u.photo_google:
            photo_url, photo_source = u.photo_google, "google"
        else:
            photo_url, photo_source = None, None
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
            preferences=dict(u.preferences or {}),
            role=RoleResume(id=u.role.id, libelle=u.role.libelle, systeme=u.role.systeme),
            permissions=u.permission_codes,
            derniere_connexion=en_utc(u.derniere_connexion),
            cree_le=en_utc(u.cree_le),
            photo_url=photo_url,
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


class OubliEntree(BaseModel):
    email: str = Field(max_length=320)


class ReinitialisationEntree(BaseModel):
    jeton: str = Field(max_length=256)
    nouveau: str = Field(max_length=1024)


class PremiereConnexionEntree(BaseModel):
    jeton: str = Field(max_length=256)
    mot_de_passe: str = Field(max_length=1024)


class UtilisateurModification(BaseModel):
    nom: str | None = Field(default=None, max_length=120)
    prenom: str | None = Field(default=None, max_length=120)
    role_id: uuid.UUID | None = None
    actif: bool | None = None


class RoleCreation(BaseModel):
    libelle: str = Field(min_length=2, max_length=80)
    permissions: list[str] = []


class RoleModification(BaseModel):
    """`permissions`, s'il est fourni, REMPLACE l'ensemble des permissions."""
    libelle: str | None = Field(default=None, min_length=2, max_length=80)
    permissions: list[str] | None = None


class RoleOut(BaseModel):
    id: uuid.UUID
    libelle: str
    systeme: bool
    permissions: list[str]
    nb_utilisateurs: int

    @classmethod
    def depuis(cls, role: Role) -> "RoleOut":
        return cls(
            id=role.id,
            libelle=role.libelle,
            systeme=role.systeme,
            permissions=role.permission_codes,
            nb_utilisateurs=len(role.utilisateurs),
        )
