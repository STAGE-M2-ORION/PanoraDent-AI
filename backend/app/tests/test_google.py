"""Connexion Google avec les modes autorisés, et rattachement depuis une session ouverte."""
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select

from app.auth_deps import COOKIE_ACCES
from app.auth_models import Journal, Utilisateur
from app.identity import fournisseur, sub_factice

from .conftest import BASE, connexion, connexion_mdp, erreur

EMAIL = "dr.rabe@cabinet.example.org"


def _user(db, email=EMAIL) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _rattacher(client, email=EMAIL, **revendications):
    """Parcours de rattachement depuis la session ouverte de `client`."""
    r = client.get(f"{BASE}/auth/google/demarrer", params={"rattacher": 1}, follow_redirects=False)
    assert r.status_code == 302
    params = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    if "nonce" not in params:  # redirection d'erreur
        return r
    fake = fournisseur()
    revendications.setdefault("nonce", params["nonce"])
    code = fake.emettre_code(fake.revendications(email, **revendications), params["code_challenge"])
    return client.get(
        f"{BASE}/auth/google/retour", params={"code": code, "state": params["state"]}, follow_redirects=False
    )


# --- Connexion Google et modes autorisés ------------------------------------------------

def test_compte_rattache_connecte_avec_google(nouveau_client, creer_compte, db):
    creer_compte(EMAIL, modes_connexion=["google"])
    c = nouveau_client()
    assert erreur(connexion(c, EMAIL)) is None
    assert c.get(f"{BASE}/moi").json()["google_rattache"] is True
    assert erreur(connexion(nouveau_client(), EMAIL)) is None  # reconnu ensuite par son sub


def test_mode_google_non_autorise_refuse_avec_son_motif(nouveau_client, compte_mdp, db):
    compte_mdp(EMAIL, modes=("mot_de_passe",))
    c = nouveau_client()
    r = connexion(c, EMAIL)
    assert erreur(r) == "google_non_autorise"
    assert COOKIE_ACCES not in c.cookies
    assert _user(db).google_sub is None
    ligne = db.scalars(select(Journal).where(Journal.action == "connexion")).all()[-1]
    assert ligne.resultat == "refus" and ligne.details["code"] == "google_non_autorise"


def test_nonce_absent_refuse(nouveau_client, creer_compte):
    creer_compte(EMAIL)
    assert erreur(connexion(nouveau_client(), EMAIL, nonce=None)) == "etat_invalide"


def test_meme_compte_par_mot_de_passe_puis_par_google(nouveau_client, compte_mdp):
    compte_mdp(EMAIL)
    assert connexion_mdp(nouveau_client(), EMAIL).status_code == 200
    assert erreur(connexion(nouveau_client(), EMAIL)) is None


# --- Rattachement depuis le profil ----------------------------------------------------------

def test_rattachement_depuis_une_session_ouverte(client, compte_mdp, db):
    compte_mdp(EMAIL)
    assert connexion_mdp(client, EMAIL).status_code == 200
    r = _rattacher(client)
    assert r.headers["location"] == "http://localhost:3000/profil?onglet=securite&google=rattache"
    assert _user(db).google_sub == sub_factice(EMAIL)
    ligne = db.scalars(select(Journal).where(Journal.action == "rattachement_google")).one()
    assert ligne.resultat == "succes"
    # Le rattachement n'ouvre pas une seconde session : la première continue.
    assert client.get(f"{BASE}/moi").json()["google_rattache"] is True


def test_rattachement_sans_session_renvoie_a_la_connexion(client):
    r = client.get(f"{BASE}/auth/google/demarrer", params={"rattacher": 1}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/connexion?erreur=session_expiree")


def test_rattachement_d_une_autre_adresse_refuse(client, compte_mdp, db):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    r = _rattacher(client, "quelqu.un.d.autre@gmail.com")
    assert r.headers["location"] == "http://localhost:3000/profil?onglet=securite&erreur=google_non_rattache"
    assert _user(db).google_sub is None


def test_rattachement_refuse_si_le_mode_google_n_est_pas_autorise(client, compte_mdp, db):
    compte_mdp(EMAIL, modes=("mot_de_passe",))
    connexion_mdp(client, EMAIL)
    r = _rattacher(client)
    assert r.headers["location"].endswith("erreur=google_non_autorise")
    assert _user(db).google_sub is None


def test_rattachement_d_un_compte_google_deja_utilise_refuse(client, compte_mdp, db):
    compte_mdp(EMAIL)
    compte_mdp("autre@cabinet.example.org", google_sub=sub_factice(EMAIL))
    connexion_mdp(client, EMAIL)
    assert _rattacher(client).headers["location"].endswith("erreur=google_non_rattache")
    assert _user(db).google_sub is None
