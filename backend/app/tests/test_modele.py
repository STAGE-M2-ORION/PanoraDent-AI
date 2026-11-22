"""Règles du modèle tenues par la base elle-même (contraintes CHECK), et
empreinte du jeton de rafraîchissement."""
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth_models import (
    Jeton, Role, SessionUtilisateur, TypeJeton, Utilisateur, maintenant,
)
from app.permissions import PRACTITIONER_ROLE

from .conftest import ADMIN_EMAIL, BASE

EMPREINTE_BCRYPT = "$2b$12$" + "x" * 53


def _inserer(db, **champs):
    role = db.scalar(select(Role).where(Role.libelle == PRACTITIONER_ROLE))
    champs.setdefault("email", "dr.test@cabinet.example.org")
    db.add(Utilisateur(role_id=role.id, **champs))
    db.commit()


@pytest.mark.parametrize("modes", [[], ["sms"], ["google", "sms"], "google"])
def test_modes_de_connexion_invalides_refuses_par_la_base(db, modes):
    with pytest.raises(IntegrityError):
        _inserer(db, modes_connexion=modes)


def test_empreinte_sans_mode_mot_de_passe_refusee_par_la_base(db):
    with pytest.raises(IntegrityError):
        _inserer(db, modes_connexion=["google"], mot_de_passe=EMPREINTE_BCRYPT)


def test_sub_google_sans_mode_google_refuse_par_la_base(db):
    with pytest.raises(IntegrityError):
        _inserer(db, modes_connexion=["mot_de_passe"], google_sub="1234567890")


@pytest.mark.parametrize("modes", [["mot_de_passe"], ["google"], ["mot_de_passe", "google"]])
def test_compte_en_attente_de_premiere_connexion_accepte(db, modes):
    """Ni empreinte ni `sub` : l'état normal entre la création et la première connexion."""
    _inserer(db, modes_connexion=modes)
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == "dr.test@cabinet.example.org"))
    assert u.mot_de_passe is None and u.google_sub is None and u.actif


def test_compte_complet_accepte(db):
    _inserer(db, modes_connexion=["mot_de_passe", "google"], mot_de_passe=EMPREINTE_BCRYPT, google_sub="42")


def test_empreinte_de_jeton_unique(db):
    admin = db.scalar(select(Utilisateur).where(Utilisateur.email == ADMIN_EMAIL))
    for _ in range(2):
        db.add(Jeton(
            utilisateur_id=admin.id, type=TypeJeton.reinitialisation,
            empreinte="a" * 64, expiration=maintenant() + timedelta(hours=1),
        ))
    with pytest.raises(IntegrityError):
        db.commit()


def test_session_enregistre_empreinte_appareil_et_ip(admin, db):
    session = db.scalars(select(SessionUtilisateur)).one()
    assert len(session.empreinte_refresh) == 64
    assert session.agent  # User-Agent du client de test
    assert session.ip


def test_rafraichissement_refuse_si_empreinte_differente(admin, db):
    """Un jeton de rafraîchissement bien signé mais qui n'est pas celui
    enregistré pour la session (rejoué, remplacé) est refusé."""
    session = db.scalars(select(SessionUtilisateur)).one()
    session.empreinte_refresh = "0" * 64
    db.commit()
    assert admin.post(f"{BASE}/auth/rafraichir").status_code == 401
