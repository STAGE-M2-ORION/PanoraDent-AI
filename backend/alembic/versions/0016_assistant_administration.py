"""administration de l'assistant : état « en cours » des documents, réglages de la recherche

- `documents.etat` accepte « en_cours » (document pris par le worker) ;
- `parametres_assistant` : une ligne (id = 1), nombre de passages et seuil de
  similarité, modifiables depuis l'administration.

Les deux permissions nouvelles (`assistant:use`, `document:manage`) sont
créées par le jeu de départ, rejoué à chaque démarrage.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("documents") as t:
        t.drop_constraint("ck_documents_etat", type_="check")
        t.create_check_constraint("ck_documents_etat", "etat IN ('en_attente', 'en_cours', 'indexe', 'echec')")

    op.create_table(
        "parametres_assistant",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("passages", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("seuil", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("maj_le", sa.DateTime(), nullable=True),
        sa.Column("maj_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_parametres_assistant_unique"),
        sa.CheckConstraint("passages BETWEEN 1 AND 10", name="ck_parametres_assistant_passages"),
        sa.CheckConstraint("seuil >= 0 AND seuil <= 1", name="ck_parametres_assistant_seuil"),
    )


def downgrade():
    op.drop_table("parametres_assistant")
    op.execute("UPDATE documents SET etat = 'en_attente' WHERE etat = 'en_cours'")
    with op.batch_alter_table("documents") as t:
        t.drop_constraint("ck_documents_etat", type_="check")
        t.create_check_constraint("ck_documents_etat", "etat IN ('en_attente', 'indexe', 'echec')")
