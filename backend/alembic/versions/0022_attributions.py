"""analyses confiées à un lecteur ; permission `analysis:read_all`

- `attributions` : une analyse confiée à un ou plusieurs lecteurs par son
  déposant (ou un administrateur), avant ou après la clôture ;
- `analysis:read_all` : « consulter toutes les analyses du cabinet ». Un rôle
  qui a `analysis:read` SANS elle ne voit plus que les analyses qui lui sont
  confiées. Elle est donnée ici à tout rôle qui lit déjà les analyses, sauf
  au rôle système Lecteur : les rôles personnalisés ne changent pas de
  comportement ; le Lecteur, lui, perd l'accès aux analyses existantes tant
  qu'on ne les lui a pas confiées (décision du 27/11/2026). Les rôles système
  sont de toute façon resynchronisés par `seed_auth` au démarrage.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

CODE = "analysis:read_all"
LIBELLE = "Consulter toutes les analyses du cabinet (sinon : celles qui vous sont confiées)"


def upgrade():
    op.create_table(
        "attributions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("analysis_id", sa.String(), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lecteur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attribue_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("analysis_id", "lecteur_id", name="uq_attributions_analyse_lecteur"),
    )
    op.create_index("ix_attributions_analysis_id", "attributions", ["analysis_id"])
    op.create_index("ix_attributions_lecteur_id", "attributions", ["lecteur_id"])

    connexion = op.get_bind()
    existe = connexion.execute(sa.text("SELECT 1 FROM permission WHERE code = :c"), {"c": CODE}).first()
    if existe is None:
        connexion.execute(sa.text("INSERT INTO permission (code, libelle) VALUES (:c, :l)"), {"c": CODE, "l": LIBELLE})
    connexion.execute(sa.text(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT rp.role_id, :c FROM role_permission rp JOIN role r ON r.id = rp.role_id "
        "WHERE rp.permission_code = 'analysis:read' AND NOT (r.systeme AND r.libelle = 'Lecteur') "
        "AND NOT EXISTS (SELECT 1 FROM role_permission d WHERE d.role_id = rp.role_id AND d.permission_code = :c)"
    ), {"c": CODE})


def downgrade():
    connexion = op.get_bind()
    connexion.execute(sa.text("DELETE FROM role_permission WHERE permission_code = :c"), {"c": CODE})
    connexion.execute(sa.text("DELETE FROM permission WHERE code = :c"), {"c": CODE})
    op.drop_table("attributions")
