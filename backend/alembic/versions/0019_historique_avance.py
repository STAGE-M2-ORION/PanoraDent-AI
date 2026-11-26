"""historique avancé : recherche plein texte en français, vues enregistrées

- PostgreSQL : extension `unaccent`, fonction `f_unaccent` (immuable, donc
  indexable), index GIN plein texte (configuration française, sans accents)
  sur la référence, la note et la conclusion des analyses ; et index
  trigramme (`pg_trgm`) sur la référence, pour la recherche partielle
  (« 0042 ») : sans lui, le « OU » avec le plein texte imposerait de tout lire ;
- `vues_historique` : jeux de filtres nommés, propres à leur auteur.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

# Doit rester identique à l'expression de la recherche (routers/historique.py).
DOCUMENT = ("to_tsvector('french'::regconfig, f_unaccent(coalesce(reference, '') || ' ' || "
            "coalesce(note, '') || ' ' || coalesce(conclusion, '')))")


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
        op.execute(
            "CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text "
            "LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT "
            "AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$")
        op.execute(f"CREATE INDEX ix_analyses_texte ON analyses USING gin ({DOCUMENT})")
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute("CREATE INDEX ix_analyses_reference_trgm ON analyses USING gin (reference gin_trgm_ops)")

    op.create_table(
        "vues_historique",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("utilisateur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(80), nullable=False),
        sa.Column("filtres", sa.JSON(), nullable=False),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("utilisateur_id", "nom", name="uq_vues_historique_auteur_nom"),
    )
    op.create_index("ix_vues_historique_utilisateur_id", "vues_historique", ["utilisateur_id"])


def downgrade():
    op.drop_table("vues_historique")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_analyses_reference_trgm")
        op.execute("DROP INDEX IF EXISTS ix_analyses_texte")
        op.execute("DROP FUNCTION IF EXISTS f_unaccent(text)")
