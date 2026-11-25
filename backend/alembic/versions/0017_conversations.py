"""conversations de l'assistant : un fil par couple analyse-auteur, et ses messages

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("analysis_id", sa.String(), sa.ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("auteur_id", sa.Uuid(), sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.Column("maj_le", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("analysis_id", "auteur_id", name="uq_conversations_analyse_auteur"),
    )
    op.create_index("ix_conversations_analysis_id", "conversations", ["analysis_id"])
    op.create_index("ix_conversations_auteur_id", "conversations", ["auteur_id"])

    op.create_table(
        "messages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("conversation_id", sa.String(), sa.ForeignKey("conversations.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("rang", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(12), nullable=False),
        sa.Column("statut", sa.String(12), nullable=True),
        sa.Column("texte", sa.Text(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("cree_le", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("conversation_id", "rang", name="uq_messages_conversation_rang"),
        sa.CheckConstraint("role IN ('question', 'reponse')", name="ck_messages_role"),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])


def downgrade():
    op.drop_table("messages")
    op.drop_table("conversations")
