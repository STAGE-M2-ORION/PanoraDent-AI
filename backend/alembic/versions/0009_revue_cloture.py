"""revue des détections et clôture de l'analyse

- `detections` : état du verdict (a_revoir, validee, corrigee, rejetee),
  auteur et date de la revue, date de création ; la confiance devient
  facultative (ajout du praticien). Le booléen `reviewed` disparaît : une
  détection déjà marquée revue devient « validée ».
- `verdicts` : un verdict par ligne, jamais modifié, au plus annulé ; il porte
  les valeurs retenues, la proposition d'origine restant sur la détection.
- `analyses` : conclusion, date et auteur de la clôture.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("detections", sa.Column("etat", sa.String(10), nullable=False, server_default="a_revoir"))
    op.create_check_constraint(
        "ck_detections_etat", "detections", "etat IN ('a_revoir', 'validee', 'corrigee', 'rejetee')"
    )
    op.create_index("ix_detections_etat", "detections", ["etat"])
    op.execute("UPDATE detections SET etat = 'validee' WHERE reviewed")
    op.drop_column("detections", "reviewed")
    op.add_column("detections", sa.Column("revu_par_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_detections_revu_par", "detections", "utilisateur", ["revu_par_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column("detections", sa.Column("revu_le", sa.DateTime(), nullable=True))
    op.add_column("detections", sa.Column("cree_le", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.alter_column("detections", "confidence", nullable=True)

    op.create_table(
        "verdicts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("detection_id", sa.String(), sa.ForeignKey("detections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("fdi", sa.Integer(), nullable=True),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("commentaire", sa.Text(), nullable=False, server_default=""),
        sa.Column("auteur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cree_le", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("annule_le", sa.DateTime(), nullable=True),
        sa.Column("annule_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("action IN ('valider', 'corriger', 'rejeter', 'ajouter')", name="ck_verdicts_action"),
        sa.UniqueConstraint("detection_id", "numero", name="uq_verdicts_detection_numero"),
    )
    op.create_index("ix_verdicts_detection_id", "verdicts", ["detection_id"])
    op.create_index("ix_verdicts_auteur_id", "verdicts", ["auteur_id"])

    op.add_column("analyses", sa.Column("conclusion", sa.Text(), nullable=False, server_default=""))
    op.add_column("analyses", sa.Column("cloturee_le", sa.DateTime(), nullable=True))
    op.add_column("analyses", sa.Column("cloturee_par_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_analyses_cloturee_par", "analyses", "utilisateur", ["cloturee_par_id"], ["id"], ondelete="SET NULL"
    )


def downgrade():
    op.drop_constraint("fk_analyses_cloturee_par", "analyses", type_="foreignkey")
    op.drop_column("analyses", "cloturee_par_id")
    op.drop_column("analyses", "cloturee_le")
    op.drop_column("analyses", "conclusion")

    op.drop_index("ix_verdicts_auteur_id", table_name="verdicts")
    op.drop_index("ix_verdicts_detection_id", table_name="verdicts")
    op.drop_table("verdicts")

    # Les ajouts du praticien n'ont pas de confiance : on leur rend 1.
    op.execute("UPDATE detections SET confidence = 1 WHERE confidence IS NULL")
    op.alter_column("detections", "confidence", nullable=False)
    op.drop_column("detections", "cree_le")
    op.drop_column("detections", "revu_le")
    op.drop_constraint("fk_detections_revu_par", "detections", type_="foreignkey")
    op.drop_column("detections", "revu_par_id")
    op.add_column("detections", sa.Column("reviewed", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE detections SET reviewed = (etat <> 'a_revoir')")
    op.drop_index("ix_detections_etat", table_name="detections")
    op.drop_constraint("ck_detections_etat", "detections", type_="check")
    op.drop_column("detections", "etat")
