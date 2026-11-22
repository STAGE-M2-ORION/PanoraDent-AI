"""Liens à usage unique : mot de passe oublié, réinitialisation, première connexion."""
from datetime import timedelta

from sqlalchemy import select

from app import auth_security as sec
from app.auth_deps import COOKIE_ACCES
from app.auth_models import Jeton, Journal, TypeJeton, Utilisateur, en_utc, maintenant
from app.services import jetons

from .conftest import BASE, MDP, connexion_mdp

EMAIL = "dr.rabe@cabinet.example.org"
NOUVEAU = "un tout nouveau mot de passe"
LIEN_INVALIDE = {
    "code": "lien_invalide",
    "message": "Ce lien n'est plus valable : il a expiré, a déjà servi ou n'existe pas. Demandez-en un nouveau.",
}


def _oubli(client, email=EMAIL):
    return client.post(f"{BASE}/auth/mot-de-passe/oubli", json={"email": email})


def _reinitialiser(client, jeton, nouveau=NOUVEAU):
    return client.post(f"{BASE}/auth/mot-de-passe/reinitialiser", json={"jeton": jeton, "nouveau": nouveau})


def _premiere(client, jeton, mot_de_passe=NOUVEAU):
    return client.post(f"{BASE}/auth/premiere-connexion", json={"jeton": jeton, "mot_de_passe": mot_de_passe})


def _jeton_du_mail(boite, destinataire=EMAIL) -> str:
    (message,) = [m for m in boite if m.destinataire == destinataire]
    return message.texte.split("jeton=", 1)[1].split()[0]


def _jetons(db) -> list[Jeton]:
    """Liens de réinitialisation (le jeu de départ a déjà émis un lien de
    première connexion pour l'administrateur)."""
    db.expire_all()
    return db.scalars(select(Jeton).where(Jeton.type == TypeJeton.reinitialisation)).all()


def _user(db, email=EMAIL) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


# --- Mot de passe oublié ---------------------------------------------------------

def test_oubli_adresse_inconnue_204_et_aucun_mail(client, boite, db):
    r = _oubli(client, "personne@cabinet.example.org")
    assert r.status_code == 204 and r.content == b""
    assert boite == [] and _jetons(db) == []
    ligne = db.scalars(select(Journal).where(Journal.action == "demande_reinitialisation")).one()
    assert ligne.resultat == "refus" and ligne.details["motif"] == "adresse_inconnue"


def test_oubli_adresse_connue_204_un_mail_et_seule_l_empreinte_en_base(client, compte_mdp, boite, db):
    compte_mdp(EMAIL)
    r = _oubli(client, EMAIL.upper())
    assert r.status_code == 204 and r.content == b""
    jeton = _jeton_du_mail(boite)
    assert "nouveau-mot-de-passe?jeton=" in boite[0].texte
    (ligne,) = _jetons(db)
    assert ligne.type == TypeJeton.reinitialisation
    assert ligne.empreinte == sec.empreinte(jeton) and ligne.empreinte != jeton
    duree = (en_utc(ligne.expiration) - maintenant()).total_seconds()
    assert 59 * 60 < duree <= 3600


def test_oubli_meme_reponse_pour_compte_desactive_ou_sans_mode_mot_de_passe(client, compte_mdp, boite):
    compte_mdp(EMAIL, actif=False)
    compte_mdp("google.seul@cabinet.example.org", modes=("google",))
    for adresse in (EMAIL, "google.seul@cabinet.example.org"):
        r = _oubli(client, adresse)
        assert r.status_code == 204 and r.content == b""
    assert boite == []


def test_nouvelle_demande_invalide_les_liens_precedents(client, compte_mdp, boite):
    compte_mdp(EMAIL)
    _oubli(client)
    premier = _jeton_du_mail(boite)
    boite.clear()
    _oubli(client)
    second = _jeton_du_mail(boite)
    assert _reinitialiser(client, premier).json() == LIEN_INVALIDE
    assert _reinitialiser(client, second).status_code == 204


# --- Réinitialisation -------------------------------------------------------------

def test_reinitialisation_reussie_ouvre_la_session_et_change_le_mot_de_passe(
    nouveau_client, compte_mdp, boite, db
):
    compte_mdp(EMAIL)
    navigateur = nouveau_client()
    _oubli(navigateur)
    r = _reinitialiser(navigateur, _jeton_du_mail(boite))
    assert r.status_code == 204
    assert COOKIE_ACCES in navigateur.cookies
    assert navigateur.get(f"{BASE}/moi").status_code == 200
    autre = nouveau_client()
    assert connexion_mdp(autre, EMAIL, MDP).status_code == 401
    assert connexion_mdp(autre, EMAIL, NOUVEAU).status_code == 200
    changement = db.scalars(select(Journal).where(Journal.action == "changement_mot_de_passe")).one()
    assert changement.resultat == "succes" and changement.details["via"] == "reinitialisation"


def test_reinitialisation_revoque_toutes_les_sessions_ouvertes(nouveau_client, compte_mdp, boite):
    compte_mdp(EMAIL)
    intrus, poste = nouveau_client(), nouveau_client()
    assert connexion_mdp(intrus, EMAIL).status_code == 200
    assert connexion_mdp(poste, EMAIL).status_code == 200
    _oubli(poste)
    assert _reinitialiser(nouveau_client(), _jeton_du_mail(boite)).status_code == 204
    for navigateur in (intrus, poste):
        assert navigateur.get(f"{BASE}/moi").status_code == 401
        assert navigateur.post(f"{BASE}/auth/rafraichir").status_code == 401


def test_reinitialisation_leve_le_verrouillage(client, compte_mdp, boite, db):
    compte_mdp(EMAIL)
    for _ in range(5):
        connexion_mdp(client, EMAIL, "mauvais mot de passe")
    assert connexion_mdp(client, EMAIL).status_code == 423
    _oubli(client)
    assert _reinitialiser(client, _jeton_du_mail(boite)).status_code == 204
    assert connexion_mdp(client, EMAIL, NOUVEAU).status_code == 200


def test_lien_utilise_deux_fois_refuse_au_second_usage(client, compte_mdp, boite):
    compte_mdp(EMAIL)
    _oubli(client)
    jeton = _jeton_du_mail(boite)
    assert _reinitialiser(client, jeton).status_code == 204
    r = _reinitialiser(client, jeton, "encore un autre mot de passe")
    assert r.status_code == 400 and r.json() == LIEN_INVALIDE


def test_lien_expire_puis_lien_inexistant_meme_message(client, compte_mdp, boite, db):
    compte_mdp(EMAIL)
    _oubli(client)
    jeton = _jeton_du_mail(boite)
    (ligne,) = _jetons(db)
    ligne.expiration = maintenant() - timedelta(seconds=1)
    db.commit()
    expire = _reinitialiser(client, jeton)
    inexistant = _reinitialiser(client, "jeton-qui-n-existe-pas")
    assert expire.status_code == inexistant.status_code == 400
    assert expire.json() == inexistant.json() == LIEN_INVALIDE
    motifs = [l.details["motif"] for l in db.scalars(
        select(Journal).where(Journal.action == "changement_mot_de_passe").order_by(Journal.horodatage)
    )]
    assert motifs == ["lien_expire", "lien_inexistant"]


def test_mot_de_passe_trop_faible_422_et_lien_toujours_utilisable(client, compte_mdp, boite):
    compte_mdp(EMAIL)
    _oubli(client)
    jeton = _jeton_du_mail(boite)
    r = _reinitialiser(client, jeton, "court")
    assert r.status_code == 422 and r.json()["code"] == "mot_de_passe_trop_faible"
    assert "12 caractères" in r.json()["message"]
    assert _reinitialiser(client, jeton).status_code == 204


def test_lien_d_un_compte_desactive_entre_temps_refuse(client, compte_mdp, boite, db):
    compte_mdp(EMAIL)
    _oubli(client)
    jeton = _jeton_du_mail(boite)
    u = _user(db)
    u.actif = False
    db.commit()
    assert _reinitialiser(client, jeton).json() == LIEN_INVALIDE


# --- Première connexion -------------------------------------------------------------

def test_premiere_connexion_consommee_une_seule_fois(nouveau_client, creer_compte, db):
    creer_compte(EMAIL, modes_connexion=["mot_de_passe", "google"])
    jeton = jetons.emettre(db, _user(db), TypeJeton.premiere_connexion)
    db.commit()
    navigateur = nouveau_client()
    assert _premiere(navigateur, jeton).status_code == 204
    assert navigateur.get(f"{BASE}/moi").json()["mot_de_passe_defini"] is True
    assert connexion_mdp(nouveau_client(), EMAIL, NOUVEAU).status_code == 200
    r = _premiere(nouveau_client(), jeton, "autre mot de passe solide")
    assert r.status_code == 400 and r.json() == LIEN_INVALIDE


def test_jeton_d_un_autre_type_refuse(client, compte_mdp, boite):
    """Un lien de réinitialisation ne sert pas de lien de première connexion."""
    compte_mdp(EMAIL)
    _oubli(client)
    assert _premiere(client, _jeton_du_mail(boite)).json() == LIEN_INVALIDE


def test_jeton_ne_touche_que_son_propre_compte(client, compte_mdp, boite, db):
    """Le lien est lié au compte qui l'a reçu : il ne change pas le mot de passe d'un autre."""
    compte_mdp(EMAIL)
    compte_mdp("dr.autre@cabinet.example.org")
    _oubli(client, "dr.autre@cabinet.example.org")
    jeton_autre = _jeton_du_mail(boite, "dr.autre@cabinet.example.org")
    assert _reinitialiser(client, jeton_autre).status_code == 204
    assert connexion_mdp(client, EMAIL, MDP).status_code == 200
    assert connexion_mdp(client, "dr.autre@cabinet.example.org", NOUVEAU).status_code == 200


def test_premiere_connexion_refusee_si_le_mode_mot_de_passe_n_est_pas_autorise(client, creer_compte, db):
    creer_compte(EMAIL, modes_connexion=["google"])
    jeton = jetons.emettre(db, _user(db), TypeJeton.premiere_connexion)
    db.commit()
    assert _premiere(client, jeton).json() == LIEN_INVALIDE
