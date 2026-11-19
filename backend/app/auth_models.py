"""Modèle d'authentification : utilisateur, rôle, permission, session, journal.

L'authentification passe uniquement par Google : AUCUNE colonne ne porte de mot
de passe. Les identifiants sont des UUID générés par l'application (ils ne
révèlent ni l'ordre ni le nombre de comptes).

Importer ce module enregistre les tables sur `Base.metadata` (Alembic).
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey, Index, String, Table, Text, Uuid, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def maintenant() -> datetime:
    return datetime.now(timezone.utc)


def en_utc(dt: datetime | None) -> datetime | None:
    """SQLite (tests) relit les `timestamptz` sans fuseau : on les recale en UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class StatutUtilisateur(str, enum.Enum):
    actif = "actif"
    desactive = "desactive"


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
    # Rôle système : ni supprimable, ni renommable.
    systeme: Mapped[bool] = mapped_column(Boolean, default=False)

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permission, lazy="selectin", order_by=Permission.code
    )
    utilisateurs: Mapped[list["Utilisateur"]] = relationship(back_populates="role")

    @property
    def permission_codes(self) -> list[str]:
        return [p.code for p in self.permissions]


class Utilisateur(Base):
    __tablename__ = "utilisateur"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Repris de Google à la première connexion si l'administrateur les a laissés vides.
    nom: Mapped[str] = mapped_column(String(120), default="")
    prenom: Mapped[str] = mapped_column(String(120), default="")
    # Adresse Google attendue, toujours stockée en minuscules.
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # Identifiant stable du compte Google, rempli à la première connexion.
    # Ensuite c'est lui qui identifie l'utilisateur : l'adresse peut changer.
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("role.id", ondelete="RESTRICT"))
    statut: Mapped[StatutUtilisateur] = mapped_column(
        Enum(
            StatutUtilisateur,
            name="statut_utilisateur",
            values_callable=lambda e: [m.value for m in e],
        ),
        default=StatutUtilisateur.actif,
    )
    derniere_connexion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    date_creation: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    # Photo de profil : celle du compte Google (revendication `picture`,
    # reprise à chaque connexion) et, prioritaire, celle importée à la main
    # (clé dans le stockage objet).
    photo_google: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    photo_cle: Mapped[str | None] = mapped_column(String(255), nullable=True)

    role: Mapped[Role] = relationship(back_populates="utilisateurs", lazy="joined")
    sessions: Mapped[list["SessionUtilisateur"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def actif(self) -> bool:
        return self.statut == StatutUtilisateur.actif

    @property
    def permission_codes(self) -> list[str]:
        return self.role.permission_codes

    def a_permission(self, code: str) -> bool:
        return code in self.permission_codes


# Unicité insensible à la casse, en plus de la contrainte simple.
Index("ux_utilisateur_email_minuscules", func.lower(Utilisateur.email), unique=True)


class SessionUtilisateur(Base):
    """Une session ouverte par une connexion Google réussie. Le jeton de
    rafraîchissement porte son `id` ; la déconnexion la marque révoquée."""
    __tablename__ = "session"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="CASCADE"), index=True
    )
    date_creation: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant)
    date_expiration: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    date_revocation: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    utilisateur: Mapped[Utilisateur] = relationship(back_populates="sessions")

    def valide(self, instant: datetime | None = None) -> bool:
        instant = instant or maintenant()
        return self.date_revocation is None and en_utc(self.date_expiration) > instant


class Journal(Base):
    """Connexions, refus (avec leur motif), créations de compte, déconnexions.
    L'écran de consultation viendra plus tard ; les lignes existent dès maintenant."""
    __tablename__ = "journal"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=maintenant, index=True)
    action: Mapped[str] = mapped_column(String(50))
    auteur_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    adresse_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    resultat: Mapped[str] = mapped_column(String(20))
    # Motif d'un refus, adresse présentée, compte créé… Jamais de jeton.
    detail: Mapped[str] = mapped_column(Text, default="")
