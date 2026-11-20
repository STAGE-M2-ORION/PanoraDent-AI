"""description d'un rôle

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

DESCRIPTIONS = {
    "Administrateur": "Gère les comptes, les rôles et la supervision de la plateforme.",
    "Praticien": "Dépose, relit et clôture ses analyses, génère les comptes rendus.",
    "Lecteur": "Consulte les analyses et la performance du modèle, en lecture seule.",
}


def upgrade():
    op.add_column("role", sa.Column("description", sa.String(255), nullable=False, server_default=""))
    role = sa.table("role", sa.column("libelle", sa.String), sa.column("description", sa.String))
    for libelle, description in DESCRIPTIONS.items():
        op.execute(role.update().where(role.c.libelle == libelle).values(description=description))


def downgrade():
    op.drop_column("role", "description")
