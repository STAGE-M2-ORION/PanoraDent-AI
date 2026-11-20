"""file de traitement des analyses ; boîtes en fractions de l'image

- `analyses` : statut (en_file, en_cours, terminee, echouee), erreur,
  tentatives, lance_le, demarre_le, termine_le, duree_ms. Les analyses
  existantes sont terminées (elles ont été analysées à l'import).
- `detections` : x, y, w, h passent de pixels à FRACTIONS de l'image ;
  version du modèle portée par chaque détection.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analyses", sa.Column("statut", sa.String(12), nullable=False, server_default="terminee"))
    op.alter_column("analyses", "statut", server_default="en_file")
    op.create_index("ix_analyses_statut", "analyses", ["statut"])
    op.create_check_constraint(
        "ck_analyses_statut", "analyses", "statut IN ('en_file', 'en_cours', 'terminee', 'echouee')"
    )
    op.add_column("analyses", sa.Column("erreur", sa.Text(), nullable=False, server_default=""))
    op.add_column("analyses", sa.Column("tentatives", sa.Integer(), nullable=False, server_default="0"))
    for colonne in ("lance_le", "demarre_le", "termine_le"):
        op.add_column("analyses", sa.Column(colonne, sa.DateTime(), nullable=True))
    op.add_column("analyses", sa.Column("duree_ms", sa.Integer(), nullable=True))
    op.alter_column("analyses", "model_version", server_default="")
    op.alter_column("analyses", "inference_mode", server_default="")

    for colonne in ("x", "y", "w", "h"):
        op.alter_column("detections", colonne, type_=sa.Float(), postgresql_using=f"{colonne}::double precision")
    op.execute("""
        UPDATE detections d SET x = d.x / a.width, w = d.w / a.width,
                                y = d.y / a.height, h = d.h / a.height
        FROM analyses a WHERE a.id = d.analysis_id AND a.width > 0 AND a.height > 0
    """)
    op.add_column("detections", sa.Column("model_version", sa.String(), nullable=False, server_default=""))
    op.execute("""
        UPDATE detections d SET model_version = a.model_version
        FROM analyses a WHERE a.id = d.analysis_id AND d.source = 'model'
    """)


def downgrade():
    op.execute("""
        UPDATE detections d SET x = round(d.x * a.width), w = round(d.w * a.width),
                                y = round(d.y * a.height), h = round(d.h * a.height)
        FROM analyses a WHERE a.id = d.analysis_id
    """)
    for colonne in ("x", "y", "w", "h"):
        op.alter_column("detections", colonne, type_=sa.Integer(), postgresql_using=f"round({colonne})::integer")
    op.drop_column("detections", "model_version")
    for colonne in ("duree_ms", "termine_le", "demarre_le", "lance_le", "tentatives", "erreur"):
        op.drop_column("analyses", colonne)
    op.drop_constraint("ck_analyses_statut", "analyses", type_="check")
    op.drop_index("ix_analyses_statut", table_name="analyses")
    op.drop_column("analyses", "statut")
