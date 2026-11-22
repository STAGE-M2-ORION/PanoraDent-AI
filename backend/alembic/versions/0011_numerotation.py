"""numérotation FDI : rang appris, rattachement anomalie -> dent, dents absentes

- `detections.rang` : rang appris par le modèle « rangs » (1 à 8) ;
- `detections.dent_id` : la dent qui porte une anomalie (rattachement du
  service d'inférence) — l'anomalie suit le numéro de sa dent ;
- `dents_absentes` : dents déclarées absentes par le praticien, auteur et date.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("detections", sa.Column("rang", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_detections_rang", "detections", "rang IS NULL OR rang BETWEEN 1 AND 8")
    op.add_column("detections", sa.Column("dent_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_detections_dent", "detections", "detections",
                          ["dent_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_detections_dent_id", "detections", ["dent_id"])

    op.create_table(
        "dents_absentes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("analysis_id", sa.String(), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fdi", sa.Integer(), nullable=False),
        sa.Column("auteur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cree_le", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("analysis_id", "fdi", name="uq_dents_absentes_analyse_fdi"),
        sa.CheckConstraint("fdi IN (11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,"
                           "31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48)", name="ck_dents_absentes_fdi"),
    )
    op.create_index("ix_dents_absentes_analysis_id", "dents_absentes", ["analysis_id"])


def downgrade():
    op.drop_index("ix_dents_absentes_analysis_id", table_name="dents_absentes")
    op.drop_table("dents_absentes")
    op.drop_index("ix_detections_dent_id", table_name="detections")
    op.drop_constraint("fk_detections_dent", "detections", type_="foreignkey")
    op.drop_column("detections", "dent_id")
    op.drop_constraint("ck_detections_rang", "detections", type_="check")
    op.drop_column("detections", "rang")
