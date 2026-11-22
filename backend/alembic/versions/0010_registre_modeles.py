"""registre des modèles : version active, paire de poids, bascules, rejeu

- `model_versions` : une version est une paire (dents + anomalies) ; chemins
  relatifs et empreintes sha256 des deux fichiers, empreinte du découpage,
  version active (une seule, tenue par un index unique partiel) et date
  d'activation.
- `model_bascules` : journal des bascules (auteur, version précédente,
  version activée, motif).
- `analyses` : version épinglée à la mise en file (`version_demandee`) et
  analyse d'origine d'un rejeu (`origine_id`).

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    for nom, type_ in (("poids_dents", sa.String()), ("poids_anomalies", sa.String()),
                       ("sha256_dents", sa.String(64)), ("sha256_anomalies", sa.String(64)),
                       ("empreinte_decoupage", sa.String(64)), ("active_le", sa.DateTime())):
        op.add_column("model_versions", sa.Column(nom, type_, nullable=True))
    op.add_column("model_versions",
                  sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ux_model_versions_actif", "model_versions", ["actif"], unique=True,
                    postgresql_where=sa.text("actif"))

    op.create_table(
        "model_bascules",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("horodatage", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("utilisateur_id", sa.Uuid(),
                  sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("version_precedente", sa.String(), nullable=True),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("motif", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_model_bascules_horodatage", "model_bascules", ["horodatage"])

    op.add_column("analyses", sa.Column("version_demandee", sa.String(), nullable=True))
    op.add_column("analyses", sa.Column("origine_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_analyses_origine", "analyses", "analyses",
                          ["origine_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_analyses_origine_id", "analyses", ["origine_id"])


def downgrade():
    op.drop_index("ix_analyses_origine_id", table_name="analyses")
    op.drop_constraint("fk_analyses_origine", "analyses", type_="foreignkey")
    op.drop_column("analyses", "origine_id")
    op.drop_column("analyses", "version_demandee")
    op.drop_index("ix_model_bascules_horodatage", table_name="model_bascules")
    op.drop_table("model_bascules")
    op.drop_index("ux_model_versions_actif", table_name="model_versions")
    for nom in ("actif", "active_le", "empreinte_decoupage", "sha256_anomalies",
                "sha256_dents", "poids_anomalies", "poids_dents"):
        op.drop_column("model_versions", nom)
