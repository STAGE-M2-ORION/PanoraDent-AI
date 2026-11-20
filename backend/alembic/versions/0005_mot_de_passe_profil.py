"""deux modes de connexion, profil, jetons de lien ; noms de colonnes de la spécification

- `utilisateur` : mot de passe (empreinte bcrypt), modes de connexion,
  `actif` (remplace l'énumération `statut`), verrouillage, profil
  professionnel, préférences, `cree_le` / `modifie_le`, adresse en citext ;
  contraintes CHECK sur les modes de connexion.
- `session` : empreinte du jeton de rafraîchissement, appareil, adresse IP ;
  `cree_le`, `expire_le`, `revoquee_le`.
- `journal` : `horodatage`, `utilisateur_id`, `ip`, `cible`, `details` (jsonb).
- `jeton` : liens à usage unique (première connexion, réinitialisation).

Les comptes existants sont conservés : ils se connectaient par Google, ils
reçoivent le mode `["google"]`.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

type_jeton = postgresql.ENUM("premiere_connexion", "reinitialisation", name="type_jeton", create_type=False)
statut = postgresql.ENUM("actif", "desactive", name="statut_utilisateur", create_type=False)


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    # --- utilisateur -------------------------------------------------------
    op.alter_column("utilisateur", "email", type_=postgresql.CITEXT(), existing_type=sa.String(255))
    op.alter_column("utilisateur", "date_creation", new_column_name="cree_le")
    op.add_column("utilisateur", sa.Column("mot_de_passe", sa.String(255), nullable=True))
    op.add_column("utilisateur", sa.Column(
        "modes_connexion", postgresql.JSONB(), nullable=False, server_default=sa.text("'[\"google\"]'::jsonb"),
    ))
    op.alter_column("utilisateur", "modes_connexion", server_default=None)
    op.add_column("utilisateur", sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.execute("UPDATE utilisateur SET actif = (statut = 'actif')")
    op.drop_column("utilisateur", "statut")
    statut.drop(op.get_bind(), checkfirst=True)
    op.add_column("utilisateur", sa.Column("doit_changer_mdp", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("utilisateur", sa.Column("echecs_connexion", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("utilisateur", sa.Column("verrouille_jusqu_a", sa.DateTime(timezone=True), nullable=True))
    op.add_column("utilisateur", sa.Column("titre", sa.String(80), nullable=True))
    op.add_column("utilisateur", sa.Column("specialite", sa.String(120), nullable=True))
    op.add_column("utilisateur", sa.Column("numero_ordre", sa.String(60), nullable=True))
    op.add_column("utilisateur", sa.Column("telephone", sa.String(30), nullable=True))
    op.add_column("utilisateur", sa.Column(
        "preferences", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"),
    ))
    op.add_column("utilisateur", sa.Column(
        "modifie_le", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(),
    ))
    op.create_check_constraint("ck_utilisateur_echecs_positifs", "utilisateur", "echecs_connexion >= 0")
    op.create_check_constraint(
        "ck_utilisateur_modes_connexion", "utilisateur",
        "jsonb_typeof(modes_connexion) = 'array'"
        " AND jsonb_array_length(modes_connexion) BETWEEN 1 AND 2"
        " AND modes_connexion <@ '[\"mot_de_passe\", \"google\"]'::jsonb",
    )
    op.create_check_constraint(
        "ck_utilisateur_mot_de_passe_autorise", "utilisateur",
        "mot_de_passe IS NULL OR modes_connexion @> '[\"mot_de_passe\"]'::jsonb",
    )
    op.create_check_constraint(
        "ck_utilisateur_google_autorise", "utilisateur",
        "google_sub IS NULL OR modes_connexion @> '[\"google\"]'::jsonb",
    )

    # --- session -----------------------------------------------------------
    op.alter_column("session", "date_creation", new_column_name="cree_le")
    op.alter_column("session", "date_expiration", new_column_name="expire_le")
    op.alter_column("session", "date_revocation", new_column_name="revoquee_le")
    op.add_column("session", sa.Column("empreinte_refresh", sa.String(64), nullable=True))
    op.add_column("session", sa.Column("agent", sa.String(255), nullable=True))
    op.add_column("session", sa.Column("ip", sa.String(45), nullable=True))
    # Les sessions ouvertes avant cette révision n'ont pas d'empreinte : elles
    # ne pourront plus se rafraîchir. On les clôt proprement.
    op.execute("UPDATE session SET revoquee_le = now() WHERE revoquee_le IS NULL")

    # --- journal -----------------------------------------------------------
    op.alter_column("journal", "date", new_column_name="horodatage")
    op.execute("ALTER INDEX ix_journal_date RENAME TO ix_journal_horodatage")
    op.alter_column("journal", "auteur_id", new_column_name="utilisateur_id")
    op.alter_column("journal", "adresse_ip", new_column_name="ip")
    op.add_column("journal", sa.Column("cible", sa.String(120), nullable=True))
    op.add_column("journal", sa.Column(
        "details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"),
    ))
    op.execute(
        "UPDATE journal SET details = jsonb_build_object('texte', detail) WHERE detail <> ''"
    )
    op.drop_column("journal", "detail")

    # --- jeton -------------------------------------------------------------
    type_jeton.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "jeton",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "utilisateur_id", sa.Uuid(),
            sa.ForeignKey("utilisateur.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("type", type_jeton, nullable=False),
        sa.Column("empreinte", sa.String(64), nullable=False, unique=True),
        sa.Column("expiration", sa.DateTime(timezone=True), nullable=False),
        sa.Column("utilise_le", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cree_le", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_jeton_utilisateur_id", "jeton", ["utilisateur_id"])


def downgrade():
    op.drop_index("ix_jeton_utilisateur_id", table_name="jeton")
    op.drop_table("jeton")
    type_jeton.drop(op.get_bind(), checkfirst=True)

    op.add_column("journal", sa.Column("detail", sa.Text(), nullable=False, server_default=""))
    op.execute("UPDATE journal SET detail = coalesce(details->>'texte', details::text)")
    op.drop_column("journal", "details")
    op.drop_column("journal", "cible")
    op.alter_column("journal", "ip", new_column_name="adresse_ip")
    op.alter_column("journal", "utilisateur_id", new_column_name="auteur_id")
    op.execute("ALTER INDEX ix_journal_horodatage RENAME TO ix_journal_date")
    op.alter_column("journal", "horodatage", new_column_name="date")

    op.drop_column("session", "ip")
    op.drop_column("session", "agent")
    op.drop_column("session", "empreinte_refresh")
    op.alter_column("session", "revoquee_le", new_column_name="date_revocation")
    op.alter_column("session", "expire_le", new_column_name="date_expiration")
    op.alter_column("session", "cree_le", new_column_name="date_creation")

    for nom in (
        "ck_utilisateur_google_autorise", "ck_utilisateur_mot_de_passe_autorise",
        "ck_utilisateur_modes_connexion", "ck_utilisateur_echecs_positifs",
    ):
        op.drop_constraint(nom, "utilisateur", type_="check")
    statut.create(op.get_bind(), checkfirst=True)
    op.add_column("utilisateur", sa.Column("statut", statut, nullable=False, server_default="actif"))
    op.execute("UPDATE utilisateur SET statut = CASE WHEN actif THEN 'actif' ELSE 'desactive' END::statut_utilisateur")
    for colonne in (
        "modifie_le", "preferences", "telephone", "numero_ordre", "specialite", "titre",
        "verrouille_jusqu_a", "echecs_connexion", "doit_changer_mdp", "actif",
        "modes_connexion", "mot_de_passe",
    ):
        op.drop_column("utilisateur", colonne)
    op.alter_column("utilisateur", "cree_le", new_column_name="date_creation")
    op.alter_column("utilisateur", "email", type_=sa.String(255), existing_type=postgresql.CITEXT())
