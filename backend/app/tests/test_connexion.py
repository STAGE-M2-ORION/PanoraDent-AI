"""POST /auth/connexion : adresse e-mail et mot de passe, verrouillage."""
from datetime import timedelta

import bcrypt
from sqlalchemy import select

from app import auth_security as sec
from app.auth_deps import COOKIE_ACCES, COOKIE_RAFRAICHISSEMENT
from app.auth_models import Journal, Utilisateur, maintenant

from .conftest import BASE, MDP, connexion_mdp

EMAIL = "dr.rabe@cabinet.example.org"


def _user(db, email=EMAIL) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _journal(db, action="connexion") -> list[Journal]:
    db.expire_all()
    return db.scalars(select(Journal).where(Journal.action == action).order_by(Journal.horodatage)).all()


def test_identifiants_justes(client, compte_mdp, db):
    compte_mdp(EMAIL)
    r = connexion_mdp(client, EMAIL.upper())  # l'adresse est insensible à la casse
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["email"] == EMAIL and corps["role"]["libelle"] == "Praticien"
    assert "analysis:create" in corps["permissions"]
    for nom in (COOKIE_ACCES, COOKIE_RAFRAICHISSEMENT):
        cookie = next(c for c in client.cookies.jar if c.name == nom)
        assert cookie.secure and cookie.has_nonstandard_attr("HttpOnly")
    assert "samesite=lax" in r.headers.get("set-cookie", "").lower()
    assert client.get(f"{BASE}/moi").json()["email"] == EMAIL
    ligne = _journal(db)[-1]
    assert ligne.resultat == "succes" and ligne.details["mode"] == "mot_de_passe"
    assert _user(db).derniere_connexion is not None


def test_mot_de_passe_faux_et_adresse_inconnue_meme_reponse(client, compte_mdp, db):
    compte_mdp(EMAIL)
    faux = connexion_mdp(client, EMAIL, "pas le bon mot de passe")
    inconnu = connexion_mdp(client, "personne@cabinet.example.org")
    mal_formee = connexion_mdp(client, "pas-une-adresse")
    for r in (faux, inconnu, mal_formee):
        assert r.status_code == 401
        assert r.json() == {"code": "identifiants_invalides", "message": "Adresse e-mail ou mot de passe incorrect."}
    assert COOKIE_ACCES not in client.cookies
    # Le motif précis ne va qu'au journal.
    assert [l.details["motif"] for l in _journal(db)] == ["mot_de_passe_faux", "adresse_inconnue", "adresse_inconnue"]


def test_bcrypt_tourne_aussi_pour_une_adresse_inconnue(client, monkeypatch):
    appels = []
    vrai = bcrypt.checkpw
    monkeypatch.setattr(sec.bcrypt, "checkpw", lambda a, b: appels.append(1) or vrai(a, b))
    assert connexion_mdp(client, "personne@cabinet.example.org").status_code == 401
    assert appels == [1]


def test_cinq_echecs_puis_423_meme_avec_le_bon_mot_de_passe(client, compte_mdp, db, monkeypatch):
    compte_mdp(EMAIL)
    for _ in range(5):
        assert connexion_mdp(client, EMAIL, "mauvais mot de passe").status_code == 401
    assert len(_journal(db, "verrouillage")) == 1
    # Le verrouillage se contrôle AVANT la comparaison : bcrypt ne tourne plus.
    appels = []
    monkeypatch.setattr(sec.bcrypt, "checkpw", lambda a, b: appels.append(1) or True)
    for mot_de_passe in (MDP, "mauvais mot de passe"):
        r = connexion_mdp(client, EMAIL, mot_de_passe)
        assert r.status_code == 423
        assert r.json()["code"] == "compte_verrouille"
        assert 14 * 60 < r.json()["details"]["secondes_restantes"] <= 15 * 60
        assert int(r.headers["retry-after"]) > 0
    assert appels == []


def test_deverrouillage_apres_le_delai(client, compte_mdp, db):
    compte_mdp(EMAIL)
    for _ in range(5):
        connexion_mdp(client, EMAIL, "mauvais mot de passe")
    u = _user(db)
    u.verrouille_jusqu_a = maintenant() - timedelta(seconds=1)
    db.commit()
    assert connexion_mdp(client, EMAIL).status_code == 200
    u = _user(db)
    assert u.verrouille_jusqu_a is None and u.echecs_connexion == 0


def test_succes_apres_un_echec_remet_le_compteur_a_zero(client, compte_mdp, db):
    compte_mdp(EMAIL)
    for _ in range(4):
        connexion_mdp(client, EMAIL, "mauvais mot de passe")
    assert _user(db).echecs_connexion == 4
    assert connexion_mdp(client, EMAIL).status_code == 200
    assert _user(db).echecs_connexion == 0
    # Quatre nouveaux échecs ne verrouillent donc pas.
    for _ in range(4):
        assert connexion_mdp(client, EMAIL, "mauvais mot de passe").status_code == 401


def test_compte_desactive_403_quels_que_soient_les_identifiants(client, compte_mdp):
    compte_mdp(EMAIL, actif=False)
    for mot_de_passe in (MDP, "mauvais mot de passe"):
        r = connexion_mdp(client, EMAIL, mot_de_passe)
        assert r.status_code == 403 and r.json()["code"] == "compte_desactive"


def test_mode_mot_de_passe_non_autorise_refus_neutre(client, compte_mdp, db):
    compte_mdp(EMAIL, modes=("google",))
    r = connexion_mdp(client, EMAIL)
    assert r.status_code == 401 and r.json()["code"] == "identifiants_invalides"
    assert _journal(db)[-1].details["motif"] == "mode_non_autorise"


def test_compte_sans_mot_de_passe_choisi_refus_neutre(client, creer_compte, db):
    """Entre la création et la première connexion, aucun mot de passe ne marche."""
    creer_compte(EMAIL, modes_connexion=["mot_de_passe"])
    r = connexion_mdp(client, EMAIL, "")
    assert r.status_code == 401 and r.json()["code"] == "identifiants_invalides"
    assert _journal(db)[-1].details["motif"] == "mot_de_passe_non_defini"
