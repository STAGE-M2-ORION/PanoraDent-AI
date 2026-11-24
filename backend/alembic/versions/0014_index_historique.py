"""index de l'historique : date des analyses, cible du journal

- `analyses.created_at` : tri et pagination par clé (date, id) de l'historique ;
- `journal.cible` : fiche d'historique d'une analyse, lue dans le journal
  (« analyse:<id> »).

Le praticien (`analyses.utilisateur_id`) et l'état (`analyses.statut`) sont
déjà indexés.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-23
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_analyses_created_at", "analyses", ["created_at"])
    op.create_index("ix_journal_cible", "journal", ["cible"])


def downgrade():
    op.drop_index("ix_journal_cible", table_name="journal")
    op.drop_index("ix_analyses_created_at", table_name="analyses")
