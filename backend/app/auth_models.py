"""Modèle d'authentification : utilisateur, rôle, permission, session, jeton, journal.

Deux modes de connexion coexistent — mot de passe et Google — et
`modes_connexion` dit lesquels un compte a le droit d'utiliser. Les
identifiants sont des UUID générés par l'application (ils ne révèlent ni
l'ordre ni le nombre de comptes).

Les règles de cohérence sont tenues PAR LA BASE (contraintes CHECK), pas
seulement par le code :

- `modes_connexion` est une liste non vide de valeurs connues ;
- une empreinte de mot de passe n'existe que si le mode `mot_de_passe` est
  autorisé, un `google_sub` que si le mode `google` l'est.

Un compte sans empreinte ni `google_sub` ne peut pas se connecter : c'est
l'état normal entre sa création et sa première connexion.

Les contraintes existent en deux variantes, PostgreSQL (jsonb) et SQLite
(tests), choisies à la création des tables (`ddl_if`).

Importer ce module enregistre les tables sur `Base.metadata` (Alembic).
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Column, DateTime, Enum, ForeignKey, Index,
    SmallInteger, String, Table, Uuid, func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

MODE_MOT_DE_PASSE = "mot_de_passe"
MODE_GOOGLE = "google"
MODES_CONNEXION = (MODE_MOT_DE_PASSE, MODE_GOOGLE)

# JSON portable : jsonb sous PostgreSQL, texte JSON sous SQLite.
Json = JSON().with_variant(JSONB(), "postgresql")


def maintenant() -> datetime:
    return datetime.now(timezone.utc)


def en_utc(dt: datetime | None) -> datetime | None:
    """SQLite (tests) relit les `timestamptz` sans fuseau : on les recale en UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class TypeJeton(str, enum.Enum):
    premiere_connexion = "premiere_connexion"
    reinitialisation = "reinitialisation"


role_permission = Table(
    "role_permission",
    Base.metadata,
    Column("role_id", Uuid, ForeignKey("role.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_code", String(64), ForeignKey("permission.code", ondelete="CASCADE"), primary_key=True),
)


class Permission(Base):
    __tablename__ = "permission"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    libelle: Mapped[str] = mapped_column(String(255), default="")


class Role(Base):
    __tablename__ = "role"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    libelle: Mapped[str] = mapped_column(String(80), unique=True)
    # Phrase libre : à quoi sert ce rôle (affichée avec son résumé).
    description: Mapped[str] = mapped_column(String(255), default="")
    # Rôle système : ni modifiable (nom, description, permissions), ni supprimable.
    systeme: Mapped[bool] = mapped_column(Boolean, default=False)

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permission, lazy="selectin", order_by=Permission.code
    )
    utilisateurs: Mapped[list["Utilisateur"]] = relationship(back_populates="role")

    @property
    def permission_codes(self) -> list[str]:
        return [p.code for p in self.permissions]


# --- Contraintes de `utilisateur` (deux dialectes) ---------------------------

def _contraintes_pg() -> list[CheckConstraint]:
    return [
        CheckConstraint(
            "jsonb_typeof(modes_connexion) = 'array'"
            " AND jsonb_array_length(modes_connexion) BETWEEN 1 AND 2"
            " AND modes_connexion <@ '[\"mot_de_passe\", \"google\"]'::jsonb",
            name="ck_utilisateur_modes_connexion",
        ).ddl_if(dialect="postgresql"),
        CheckConstraint(
            "mot_de_passe IS NULL OR modes_connexion @> '[\"mot_de_passe\"]'::jsonb",
            name="ck_utilisateur_mot_de_passe_autorise",
        ).ddl_if(dialect="postgresql"),
        CheckConstraint(
            "google_sub IS NULL OR modes_connexion @> '[\"google\"]'::jsonb",
            name="ck_utilisateur_google_autorise",
        ).ddl_if(dialect="postgresql"),
    ]


def _contraintes_sqlite() -> list[CheckConstraint]:
    # SQLite interdit les sous-requêtes dans un CHECK : on raisonne sur le texte
    # JSON. Retirer les deux valeurs permises, les virgules et les espaces doit
    # laisser « [] » exactement.
    restes = "replace(replace(replace(replace(modes_connexion, '\"mot_de_passe\"', ''), '\"google\"', ''), ',', ''), ' ', '')"
    return [
        CheckConstraint(
            "json_type(modes_connexion) = 'array'"
            " AND json_array_length(modes_connexion) BETWEEN 1 AND 2"
            f" AND {restes} = '[]'",
            name="ck_utilisateur_modes_connexion",
        ).ddl_if(dialect="sqlite"),
        CheckConstraint(
            "mot_de_passe IS NULL OR instr(modes_connexion, '\"mot_de_passe\"') > 0",
            name="ck_utilisateur_mot_de_passe_autorise",
        ).ddl_if(dialect="sqlite"),
        CheckConstraint(
            "google_sub IS NULL OR instr(modes_connexion, '\"google\"') > 0",
            name="ck_utilisateur_google_autorise",
        ).ddl_if(dialect="sqlite"),
    ]


class Utilisateur(Base):
    __tablename__ = "utilisateur"
    __table_args__ = (
        CheckConstraint("echecs_connexion >= 0", name="ck_utilisateur_echecs_positifs"),
        *_contraintes_pg(),
        *_contraintes_sqlite(),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # citext sous PostgreSQL : unicité et recherche insensibles à la casse.
    # L'application la stocke de toute façon en minuscules.
    email: Mapped[str] = mapped_column(String(255).with_variant(CITEXT(), "postgresql"), unique=True)
    nom: Mapped[str] = mapped_column(String(120), default="")
    prenom: Mapped[str] = mapped_column(String(120), default="")

    # Empreinte bcrypt ; nulle tant que le compte n'a pas choisi de mot de passe.
    mot_de_passe: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Identifiant stable du compte Google, rempli au premier rattachement.
    # Ensuite c'est lui qui identifie l'utilisateur : l'adresse peut changer.
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    # Modes autorisés par l'administrateur : ["mot_de_passe"], ["google"] ou les deux.
    modes_connexion: Mapped[list[str]] = mapped_column(Json, default=lambda: list(MODES_CONNEXION))

    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("role.id", ondelete="RESTRICT"))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    # Posé après une réinitialisation par l'administrateur : toute navigation
    # est renvoyée vers le choix d'un nouveau mot de passe.
    doit_changer_mdp: Mapped[bool] = mapped_column(Boolean, default=False)
    echecs_connexion: Mapped[int] = mapped_column(SmallInteger, default=0)
    verrouille_jusqu_a: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Profil professionnel, repris sur le compte rendu.
    titre: Mapped[str | None] = mapped_column(String(80), nullable=True)
    specialite: Mapped[str | None] = mapped_column(String(120), nullable=True)
    numero_ordre: Mapped[str | None] = mapped_column(String(60), nullable=True)
    telephone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Photo importée (clé dans le stockage objet), prioritaire sur celle du
    # compte Google (revendication `picture`, reprise à chaque connexion Google).
    photo_cle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    photo_google: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # thème, langue, seuil de confiance par défaut, notifications.
    preferences: Mapped[dict] = mapped_column(Json, default=dict)

    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    modifie_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=maintenant, onupdate=maintenant
    )
    derniere_connexion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role: Mapped[Role] = relationship(back_populates="utilisateurs", lazy="joined")
    sessions: Mapped[list["SessionUtilisateur"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def permission_codes(self) -> list[str]:
        return self.role.permission_codes

    def a_permission(self, code: str) -> bool:
        return code in self.permission_codes

    def autorise(self, mode: str) -> bool:
        return mode in (self.modes_connexion or [])


# Unicité insensible à la casse, en plus de la contrainte simple (utile sous
# SQLite, redondante mais inoffensive avec citext).
Index("ux_utilisateur_email_minuscules", func.lower(Utilisateur.email), unique=True)


class SessionUtilisateur(Base):
    """Une session ouverte par une connexion réussie, quel que soit le mode.

    Le jeton de rafraîchissement porte son `id` ; seule son empreinte (sha256)
    est conservée, et la déconnexion marque la session révoquée."""
    __tablename__ = "session"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="CASCADE"), index=True
    )
    empreinte_refresh: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Appareil (User-Agent tronqué) et adresse IP, pour que l'utilisateur
    # reconnaisse ses sessions dans son profil.
    agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    expire_le: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoquee_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    utilisateur: Mapped[Utilisateur] = relationship(back_populates="sessions")

    def valide(self, instant: datetime | None = None) -> bool:
        instant = instant or maintenant()
        return self.revoquee_le is None and en_utc(self.expire_le) > instant


class Jeton(Base):
    """Lien à usage unique : première connexion ou réinitialisation.

    Le jeton lui-même part par e-mail et n'est JAMAIS stocké : seule son
    empreinte sha256 l'est, comme pour un mot de passe."""
    __tablename__ = "jeton"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[TypeJeton] = mapped_column(
        Enum(TypeJeton, name="type_jeton", values_callable=lambda e: [m.value for m in e])
    )
    empreinte: Mapped[str] = mapped_column(String(64), unique=True)
    expiration: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    utilise_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)

    def utilisable(self, instant: datetime | None = None) -> bool:
        instant = instant or maintenant()
        return self.utilise_le is None and en_utc(self.expiration) > instant


class Journal(Base):
    """Connexions réussies et refusées (avec leur motif), verrouillages,
    liens, changements de mot de passe, comptes, sessions. L'écran de
    consultation viendra plus tard ; les lignes existent dès maintenant."""
    __tablename__ = "journal"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    horodatage: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    # Auteur de l'action (l'utilisateur connecté, ou le compte visé par un refus).
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(50))
    resultat: Mapped[str] = mapped_column(String(20))
    # Objet de l'action, p. ex. « utilisateur:<id> » ou « session:<id> ».
    cible: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    # Motif d'un refus, adresse présentée… Jamais de jeton ni de mot de passe.
    details: Mapped[dict] = mapped_column(Json, default=dict)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
