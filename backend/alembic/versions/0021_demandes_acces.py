"""demandes d'accès (sprint 13) ; lien générique des notifications

- `demandes_acces` : déposées depuis la page d'accueil, acceptées (compte créé
  par l'administrateur, rôle choisi par lui) ou refusées ; purgées 90 jours
  après leur traitement ;
- `notifications.lien` : page visée quand la notification ne porte pas sur une
  analyse (une demande d'accès, pour les administrateurs).

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "demandes_acces",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("profil", sa.String(40), nullable=False),
        sa.Column("etablissement", sa.String(160), nullable=False, server_default=""),
        sa.Column("ville", sa.String(80), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("statut", sa.String(12), nullable=False, server_default="en_attente"),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.Column("traitee_le", sa.DateTime(), nullable=True),
        sa.Column("traitee_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("motif_refus", sa.Text(), nullable=False, server_default=""),
        sa.Column("utilisateur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_demandes_acces_email", "demandes_acces", ["email"])
    op.create_index("ix_demandes_acces_statut", "demandes_acces", ["statut"])
    op.add_column("notifications", sa.Column("lien", sa.String(200), nullable=True))


def downgrade():
    op.drop_column("notifications", "lien")
    op.drop_table("demandes_acces")
