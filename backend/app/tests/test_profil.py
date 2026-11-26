"""Routes /moi : profil, préférences, mot de passe, sessions ouvertes."""
from sqlalchemy import select

from app.auth_models import Journal, Utilisateur

from .conftest import BASE, MDP, connexion, connexion_mdp, erreur

EMAIL = "dr.rabe@cabinet.example.org"
NOUVEAU = "un tout nouveau mot de passe"


def _user(db, email=EMAIL) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


# --- Profil ---------------------------------------------------------------------------

def test_modifier_son_profil(client, compte_mdp, db):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    r = client.patch(f"{BASE}/moi", json={
        "prenom": "  Aina ", "nom": "Rabe", "titre": "Dr", "specialite": "Orthodontie",
        "numero_ordre": "MG-1234", "telephone": "+261 34 00 000 00",
    })
    assert r.status_code == 200, r.text
    moi = r.json()
    assert (moi["prenom"], moi["titre"], moi["telephone"]) == ("Aina", "Dr", "+261 34 00 000 00")
    # Absent : inchangé ; null ou vide : effacé.
    r = client.patch(f"{BASE}/moi", json={"titre": None, "specialite": ""})
    moi = r.json()
    assert moi["titre"] is None and moi["specialite"] is None and moi["numero_ordre"] == "MG-1234"
    assert db.scalars(select(Journal).where(Journal.action == "modification_profil")).all()


def test_profil_refuse_l_adresse_et_les_champs_invalides(client, compte_mdp):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    for corps in ({"email": "autre@x.org"}, {"telephone": "<script>"}, {"titre": "x" * 81}):
        r = client.patch(f"{BASE}/moi", json=corps)
        assert r.status_code == 422 and r.json()["code"] == "champ_invalide", corps


def test_routes_moi_exigent_une_session(client):
    for methode, chemin in (
        ("patch", "/moi"), ("patch", "/moi/preferences"), ("post", "/moi/mot-de-passe"),
        ("get", "/moi/sessions"), ("delete", "/moi/sessions/00000000-0000-0000-0000-000000000000"),
    ):
        assert getattr(client, methode)(f"{BASE}{chemin}").status_code == 401, chemin


# --- Préférences ---------------------------------------------------------------------------

def test_preferences_par_defaut_puis_mise_a_jour_partielle(client, compte_mdp):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    assert client.get(f"{BASE}/moi").json()["preferences"] == {
        "theme": "systeme", "langue": "fr", "seuil_confiance_defaut": 0.5,
        "courriel_analyse_echouee": True, "courriel_analyse_rouverte": True, "courriel_demande_acces": True,
    }
    r = client.patch(f"{BASE}/moi/preferences", json={"theme": "sombre", "seuil_confiance_defaut": 0.4})
    assert r.status_code == 200
    assert r.json() == {"theme": "sombre", "langue": "fr", "seuil_confiance_defaut": 0.4,
                        "courriel_analyse_echouee": True, "courriel_analyse_rouverte": True,
                        "courriel_demande_acces": True}
    r = client.patch(f"{BASE}/moi/preferences", json={"courriel_analyse_rouverte": False})
    assert r.json()["theme"] == "sombre" and r.json()["courriel_analyse_rouverte"] is False
    assert r.json()["courriel_analyse_echouee"] is True
    assert client.get(f"{BASE}/moi").json()["preferences"]["theme"] == "sombre"


def test_l_ancienne_case_decochee_coupe_les_courriels(client, compte_mdp, db):
    """Avant le sprint 13 : une seule case « notifications par e-mail »."""
    u = compte_mdp(EMAIL)
    u.preferences = {"notifications": False}
    db.commit()
    connexion_mdp(client, EMAIL)
    prefs = client.get(f"{BASE}/moi").json()["preferences"]
    assert prefs["courriel_analyse_echouee"] is False and prefs["courriel_analyse_rouverte"] is False
    assert "notifications" not in prefs


def test_preferences_invalides_422(client, compte_mdp):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    for corps in ({"theme": "rose"}, {"seuil_confiance_defaut": 1.5}, {"inconnu": 1}, {"notifications": False}):
        assert client.patch(f"{BASE}/moi/preferences", json=corps).status_code == 422, corps


# --- Mot de passe ---------------------------------------------------------------------------

def test_changer_son_mot_de_passe_revoque_les_autres_sessions(nouveau_client, compte_mdp, db):
    compte_mdp(EMAIL)
    ici, ailleurs = nouveau_client(), nouveau_client()
    connexion_mdp(ici, EMAIL)
    connexion_mdp(ailleurs, EMAIL)
    r = ici.post(f"{BASE}/moi/mot-de-passe", json={"ancien": MDP, "nouveau": NOUVEAU})
    assert r.status_code == 204
    assert ici.get(f"{BASE}/moi").status_code == 200        # la session courante continue
    assert ailleurs.get(f"{BASE}/moi").status_code == 401   # les autres sont fermées
    assert connexion_mdp(nouveau_client(), EMAIL, NOUVEAU).status_code == 200
    assert connexion_mdp(nouveau_client(), EMAIL, MDP).status_code == 401
    ligne = db.scalars(select(Journal).where(Journal.action == "changement_mot_de_passe")).all()[-1]
    assert ligne.resultat == "succes" and ligne.details["via"] == "profil"


def test_ancien_mot_de_passe_faux_400_et_nouveau_trop_faible_422(client, compte_mdp):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    r = client.post(f"{BASE}/moi/mot-de-passe", json={"ancien": "pas le bon", "nouveau": NOUVEAU})
    assert r.status_code == 400 and r.json()["code"] == "ancien_mot_de_passe_incorrect"
    r = client.post(f"{BASE}/moi/mot-de-passe", json={"nouveau": NOUVEAU})
    assert r.status_code == 400  # l'ancien est obligatoire quand il existe
    r = client.post(f"{BASE}/moi/mot-de-passe", json={"ancien": MDP, "nouveau": "court"})
    assert r.status_code == 422 and r.json()["code"] == "mot_de_passe_trop_faible"
    r = client.post(f"{BASE}/moi/mot-de-passe", json={"ancien": MDP, "nouveau": MDP})
    assert r.status_code == 422


def test_compte_google_definit_un_mot_de_passe_sans_ancien(nouveau_client, creer_compte, db):
    creer_compte(EMAIL)  # deux modes, pas encore de mot de passe
    c = nouveau_client()
    assert erreur(connexion(c, EMAIL)) is None
    assert c.post(f"{BASE}/moi/mot-de-passe", json={"nouveau": NOUVEAU}).status_code == 204
    assert connexion_mdp(nouveau_client(), EMAIL, NOUVEAU).status_code == 200


def test_mot_de_passe_refuse_si_le_mode_n_est_pas_autorise(nouveau_client, creer_compte):
    creer_compte(EMAIL, modes_connexion=["google"])
    c = nouveau_client()
    connexion(c, EMAIL)
    r = c.post(f"{BASE}/moi/mot-de-passe", json={"nouveau": NOUVEAU})
    assert r.status_code == 400 and r.json()["code"] == "mode_non_autorise"


# --- Sessions ---------------------------------------------------------------------------------

def test_lister_ses_sessions_la_courante_signalee(nouveau_client, compte_mdp):
    compte_mdp(EMAIL)
    ici, ailleurs = nouveau_client(), nouveau_client()
    connexion_mdp(ailleurs, EMAIL)
    connexion_mdp(ici, EMAIL)
    sessions = ici.get(f"{BASE}/moi/sessions").json()
    assert len(sessions) == 2
    assert [s["courante"] for s in sessions] == [True, False]  # la plus récente d'abord
    assert sessions[0]["agent"] and sessions[0]["ip"]


def test_revoquer_une_session_depuis_une_autre(nouveau_client, compte_mdp, db):
    compte_mdp(EMAIL)
    ici, ailleurs = nouveau_client(), nouveau_client()
    connexion_mdp(ailleurs, EMAIL)
    connexion_mdp(ici, EMAIL)
    autre = next(s for s in ici.get(f"{BASE}/moi/sessions").json() if not s["courante"])
    assert ici.delete(f"{BASE}/moi/sessions/{autre['id']}").status_code == 204
    assert ailleurs.post(f"{BASE}/auth/rafraichir").status_code == 401
    assert ailleurs.get(f"{BASE}/moi").status_code == 401
    assert ici.get(f"{BASE}/moi").status_code == 200
    assert ici.delete(f"{BASE}/moi/sessions/{autre['id']}").status_code == 404  # déjà close
    assert db.scalars(select(Journal).where(Journal.action == "revocation_session")).one()


def test_on_ne_revoque_pas_la_session_d_un_autre_compte(nouveau_client, compte_mdp):
    compte_mdp(EMAIL)
    compte_mdp("autre@cabinet.example.org")
    moi, lui = nouveau_client(), nouveau_client()
    connexion_mdp(moi, EMAIL)
    connexion_mdp(lui, "autre@cabinet.example.org")
    sa_session = lui.get(f"{BASE}/moi/sessions").json()[0]["id"]
    assert moi.delete(f"{BASE}/moi/sessions/{sa_session}").status_code == 404
    assert lui.get(f"{BASE}/moi").status_code == 200


def test_revoquer_sa_session_courante_deconnecte(client, compte_mdp):
    compte_mdp(EMAIL)
    connexion_mdp(client, EMAIL)
    courante = client.get(f"{BASE}/moi/sessions").json()[0]["id"]
    r = client.delete(f"{BASE}/moi/sessions/{courante}")
    assert r.status_code == 204 and "pd_acces=" in r.headers.get("set-cookie", "")
    assert client.get(f"{BASE}/moi").status_code == 401
