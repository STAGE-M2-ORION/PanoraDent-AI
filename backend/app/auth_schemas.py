import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from .auth_models import Role, StatutUtilisateur, Utilisateur, en_utc


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
    statut: StatutUtilisateur
    role: RoleResume
    permissions: list[str]
    derniere_connexion: datetime | None
    date_creation: datetime
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
            statut=u.statut,
            role=RoleResume(id=u.role.id, libelle=u.role.libelle, systeme=u.role.systeme),
            permissions=u.permission_codes,
            derniere_connexion=en_utc(u.derniere_connexion),
            date_creation=en_utc(u.date_creation),
            photo_url=photo_url,
            photo_source=photo_source,
        )


class UtilisateurCreation(BaseModel):
    """Créé par l'administrateur avec l'adresse Google de l'intéressé. Nom et
    prénom peuvent rester vides : ils seront repris de Google à la première
    connexion. Aucun mot de passe : la plateforme n'en conserve aucun."""
    nom: str = Field(default="", max_length=120)
    prenom: str = Field(default="", max_length=120)
    email: EmailStr = Field(max_length=255)
    role_id: uuid.UUID


class UtilisateurModification(BaseModel):
    nom: str | None = Field(default=None, max_length=120)
    prenom: str | None = Field(default=None, max_length=120)
    role_id: uuid.UUID | None = None
    statut: StatutUtilisateur | None = None


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
