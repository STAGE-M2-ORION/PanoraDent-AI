"""analyse : déposant, référence anonyme, date d'examen, note, affichage, masques

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analyses", sa.Column("reference", sa.String(20), nullable=True))
    op.add_column("analyses", sa.Column(
        "utilisateur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True,
    ))
    op.create_index("ix_analyses_utilisateur_id", "analyses", ["utilisateur_id"])
    op.add_column("analyses", sa.Column("date_examen", sa.Date(), nullable=True))
    op.add_column("analyses", sa.Column("note", sa.Text(), nullable=False, server_default=""))
    op.add_column("analyses", sa.Column("image_affichage_key", sa.String(), nullable=True))
    op.add_column("analyses", sa.Column(
        "masques", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"),
    ))
    # Références des analyses existantes : PDX-<année>-<rang dans l'année>.
    op.execute("""
        UPDATE analyses a SET reference = r.ref FROM (
            SELECT id, 'PDX-' || extract(year FROM created_at)::int || '-' ||
                   lpad(row_number() OVER (PARTITION BY extract(year FROM created_at)
                                           ORDER BY created_at)::text, 4, '0') AS ref
            FROM analyses
        ) r WHERE a.id = r.id
    """)
    op.alter_column("analyses", "reference", nullable=False)
    op.create_unique_constraint("uq_analyses_reference", "analyses", ["reference"])


def downgrade():
    op.drop_constraint("uq_analyses_reference", "analyses", type_="unique")
    for colonne in ("masques", "image_affichage_key", "note", "date_examen"):
        op.drop_column("analyses", colonne)
    op.drop_index("ix_analyses_utilisateur_id", table_name="analyses")
    op.drop_column("analyses", "utilisateur_id")
    op.drop_column("analyses", "reference")
