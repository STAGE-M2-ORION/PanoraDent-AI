"""photo de profil : photo du compte Google et photo importée

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("utilisateur", sa.Column("photo_google", sa.String(1024), nullable=True))
    op.add_column("utilisateur", sa.Column("photo_cle", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("utilisateur", "photo_cle")
    op.drop_column("utilisateur", "photo_google")
