"""paramètres du cabinet : nom, adresse, mentions et logo du compte rendu

Une seule ligne (id = 1), créée à la première lecture. Le logo vit dans le
stockage objet ; la table n'en garde que la clé.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "parametres_cabinet",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False, server_default=""),
        sa.Column("adresse", sa.Text(), nullable=False, server_default=""),
        sa.Column("mentions", sa.Text(), nullable=False, server_default=""),
        sa.Column("logo_cle", sa.String(), nullable=True),
        sa.Column("maj_le", sa.DateTime(), nullable=True),
        sa.Column("maj_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_parametres_cabinet_unique"),
    )


def downgrade():
    op.drop_table("parametres_cabinet")
