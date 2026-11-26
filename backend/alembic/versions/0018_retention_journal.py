"""rétention du journal d'audit : durée de conservation et dernier abaissement

- `parametres_cabinet.retention_jours` (365 par défaut, 180 au moins) ;
- `retention_abaissee_le` et `retention_abaissee_session_id` : la session qui
  a abaissé la durée en dernier ne peut pas purger.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("parametres_cabinet") as t:
        t.add_column(sa.Column("retention_jours", sa.Integer(), nullable=False, server_default="365"))
        t.add_column(sa.Column("retention_abaissee_le", sa.DateTime(), nullable=True))
        t.add_column(sa.Column("retention_abaissee_session_id", sa.Uuid(), nullable=True))
        t.create_check_constraint("ck_parametres_cabinet_retention", "retention_jours BETWEEN 180 AND 3650")


def downgrade():
    with op.batch_alter_table("parametres_cabinet") as t:
        t.drop_constraint("ck_parametres_cabinet_retention", type_="check")
        t.drop_column("retention_abaissee_session_id")
        t.drop_column("retention_abaissee_le")
        t.drop_column("retention_jours")
