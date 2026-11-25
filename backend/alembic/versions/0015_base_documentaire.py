"""base documentaire de l'assistant : documents, passages et vecteurs (pgvector)

- extension `vector` (image pgvector/pgvector) ;
- `documents` : fichier de référence déposé (PDF ou Markdown), son empreinte,
  son état d'indexation et le modèle de vectorisation utilisé ;
- `passages` : extraits découpés, section et page pour la citation, vecteur
  `vector(1024)` (bge-m3) et index HNSW en distance cosinus.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-24
"""
from alembic import op
import sqlalchemy as sa

from app.vecteurs import DIMENSION, Vecteur

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    postgres = op.get_bind().dialect.name == "postgresql"
    if postgres:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "documents",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("titre", sa.String(200), nullable=False),
        sa.Column("nom_fichier", sa.String(255), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("cle_stockage", sa.String(), nullable=False),
        sa.Column("empreinte", sa.String(64), nullable=False, unique=True),
        sa.Column("taille", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("etat", sa.String(16), nullable=False, server_default="en_attente"),
        sa.Column("erreur", sa.Text(), nullable=True),
        sa.Column("modele_vecteurs", sa.String(120), nullable=True),
        sa.Column("nb_passages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("depose_par_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True),
        sa.Column("depose_le", sa.DateTime(), nullable=False),
        sa.Column("indexe_le", sa.DateTime(), nullable=True),
        sa.CheckConstraint("format IN ('pdf', 'markdown')", name="ck_documents_format"),
        sa.CheckConstraint("etat IN ('en_attente', 'indexe', 'echec')", name="ck_documents_etat"),
    )
    op.create_index("ix_documents_etat", "documents", ["etat"])

    op.create_table(
        "passages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("document_id", sa.String(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rang", sa.Integer(), nullable=False),
        sa.Column("texte", sa.Text(), nullable=False),
        sa.Column("section", sa.String(300), nullable=True),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("modele", sa.String(120), nullable=True),
        sa.Column("vecteur", Vecteur(DIMENSION), nullable=True),
        sa.UniqueConstraint("document_id", "rang", name="uq_passages_document_rang"),
    )
    op.create_index("ix_passages_document_id", "passages", ["document_id"])
    op.create_index("ix_passages_modele", "passages", ["modele"])
    if postgres:
        # Recherche approchée des plus proches voisins, en distance cosinus (`<=>`).
        op.execute("CREATE INDEX ix_passages_vecteur ON passages USING hnsw (vecteur vector_cosine_ops)")


def downgrade():
    op.drop_table("passages")
    op.drop_table("documents")
    # L'extension `vector` reste installée : la retirer n'apporte rien et
    # échouerait si une autre base du serveur s'en servait.
