"""authentification Google : utilisateur, role, permission, role_permission, session, journal

Remplace le schéma d'authentification par mot de passe de la révision 0002
(permissions, roles, role_permissions, users, refresh_tokens). Les comptes de
0002 ne sont PAS migrés : ils portaient des mots de passe et aucun `sub` Google ;
l'administrateur est recréé par `seed_auth` depuis ADMIN_EMAIL.

Aucune colonne ne porte de mot de passe. Identifiants UUID générés par
l'application.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

statut = sa.Enum("actif", "desactive", name="statut_utilisateur")


def upgrade():
    # --- Ancien schéma (mot de passe) ---------------------------------------
    op.drop_index("ix_refresh_tokens_jti", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("role_permissions")
    op.drop_table("roles")
    op.drop_index("ix_permissions_code", table_name="permissions")
    op.drop_table("permissions")

    # --- Nouveau schéma -------------------------------------------------------
    op.create_table(
        "permission",
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("libelle", sa.String(255), nullable=False, server_default=""),
    )
    op.create_table(
        "role",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("libelle", sa.String(80), nullable=False, unique=True),
        sa.Column("systeme", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "role_permission",
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("role.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "permission_code", sa.String(64),
            sa.ForeignKey("permission.code", ondelete="CASCADE"), primary_key=True,
        ),
    )
    op.create_table(
        "utilisateur",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False, server_default=""),
        sa.Column("prenom", sa.String(120), nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("google_sub", sa.String(255), nullable=True, unique=True),
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("role.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("statut", statut, nullable=False, server_default="actif"),
        sa.Column("derniere_connexion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("date_creation", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ux_utilisateur_email_minuscules", "utilisateur", [sa.text("lower(email)")], unique=True
    )
    op.create_table(
        "session",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "utilisateur_id", sa.Uuid(),
            sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("date_creation", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("date_expiration", sa.DateTime(timezone=True), nullable=False),
        sa.Column("date_revocation", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_session_utilisateur_id", "session", ["utilisateur_id"])
    op.create_table(
        "journal",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column(
            "auteur_id", sa.Uuid(),
            sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("adresse_ip", sa.String(45), nullable=True),
        sa.Column("resultat", sa.String(20), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_journal_date", "journal", ["date"])


def downgrade():
    op.drop_index("ix_journal_date", table_name="journal")
    op.drop_table("journal")
    op.drop_index("ix_session_utilisateur_id", table_name="session")
    op.drop_table("session")
    op.drop_index("ux_utilisateur_email_minuscules", table_name="utilisateur")
    op.drop_table("utilisateur")
    statut.drop(op.get_bind(), checkfirst=True)
    op.drop_table("role_permission")
    op.drop_table("role")
    op.drop_table("permission")

    # Schéma de 0002, vide (les comptes ne sont pas restaurés).
    op.create_table(
        "permissions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_permissions_code", "permissions", ["code"], unique=True)
    op.create_table(
        "roles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.String(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_id", sa.String(), sa.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=False, server_default=""),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("role_id", sa.String(), sa.ForeignKey("roles.id"), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("jti", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"], unique=True)
