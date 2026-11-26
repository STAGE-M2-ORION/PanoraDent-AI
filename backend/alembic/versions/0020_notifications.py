"""notifications : événements adressés à un utilisateur (sprint 13)

Une ligne par notification et par destinataire, conservée en base : celles
reçues hors connexion attendent l'ouverture de la session. Index sur
(destinataire, date) : le panneau lit les plus récentes, et compte les non
lues, d'un seul utilisateur à la fois.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("utilisateur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("titre", sa.String(200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("analyse_id", sa.String(), sa.ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reference", sa.String(40), nullable=True),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.Column("lue_le", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_notifications_destinataire_date", "notifications", ["utilisateur_id", "cree_le"])


def downgrade():
    op.drop_table("notifications")
