"""Sprint 2 — gestion des comptes : motif, modes de connexion, sessions d'un
compte, renvoi du lien, réinitialisation par l'administrateur."""
from sqlalchemy import select

from app.auth_models import Journal, Utilisateur

from .conftest import ADMIN_EMAIL, BASE, MDP, connexion, connexion_mdp, erreur

EMAIL = "dr.rabe@cabinet.example.org"


def _user(db, email=EMAIL) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _derniere(db, action) -> Journal:
    db.expire_all()
    return db.scalars(select(Journal).where(Journal.action == action).order_by(Journal.horodatage)).all()[-1]


def _roles(admin) -> dict:
    return {r["libelle"]: r["id"] for r in admin.get(f"{BASE}/roles").json()}


def _patch(admin, compte, **corps):
    return admin.patch(f"{BASE}/utilisateurs/{compte.id}", json=corps)


# --- Motif -------------------------------------------------------------------------------

def test_desactivation_et_changement_de_role_exigent_un_motif(admin, compte_mdp, db):
    compte = compte_mdp(EMAIL)
    for corps in ({"actif": False}, {"actif": False, "motif": "   "}, {"role_id": _roles(admin)["Lecteur"]}):
        r = _patch(admin, compte, **corps)
        assert r.status_code == 422 and r.json()["code"] == "motif_requis", corps
    assert _user(db).actif is True


def test_motif_et_role_avant_apres_inscrits_au_journal(admin, compte_mdp, db):
    compte = compte_mdp(EMAIL)
    r = _patch(admin, compte, role_id=_roles(admin)["Lecteur"], motif="Stage terminé")
    assert r.status_code == 200
    ligne = _derniere(db, "modification_compte")
    assert ligne.details["motif"] == "Stage terminé"
    assert ligne.details["role"] == {"avant": "Praticien", "apres": "Lecteur"}
    assert ligne.cible == f"utilisateur:{compte.id}"


def test_reactivation_et_modification_du_nom_sans_motif(admin, compte_mdp, db):
    compte = compte_mdp(EMAIL, actif=False)
    assert _patch(admin, compte, actif=True).status_code == 200
    assert _patch(admin, compte, prenom="Aina").status_code == 200
    assert _user(db).actif is True and _user(db).prenom == "Aina"


# --- Modes de connexion ---------------------------------------------------------------------

def test_retirer_le_mode_google_efface_le_rattachement_et_ferme_les_sessions(admin, nouveau_client, creer_compte, db):
    creer_compte(EMAIL)
    c = nouveau_client()
    assert erreur(connexion(c, EMAIL)) is None
    assert _user(db).google_sub is not None
    r = _patch(admin, _user(db), modes_connexion=["mot_de_passe"])
    assert r.status_code == 200 and r.json()["modes_connexion"] == ["mot_de_passe"]
    assert _user(db).google_sub is None
    assert c.get(f"{BASE}/moi").status_code == 401
    assert erreur(connexion(nouveau_client(), EMAIL)) == "google_non_autorise"
    assert _derniere(db, "modification_compte").details["modes"] == {
        "avant": ["mot_de_passe", "google"], "apres": ["mot_de_passe"],
    }


def test_retirer_le_mode_mot_de_passe_efface_l_empreinte(admin, nouveau_client, compte_mdp, db):
    compte = compte_mdp(EMAIL)
    assert _patch(admin, compte, modes_connexion=["google"]).status_code == 200
    assert _user(db).mot_de_passe is None
    assert connexion_mdp(nouveau_client(), EMAIL).status_code == 401


def test_modes_vides_ou_inconnus_422(admin, compte_mdp):
    compte = compte_mdp(EMAIL)
    for modes in ([], ["sms"]):
        assert _patch(admin, compte, modes_connexion=modes).status_code == 422


# --- Sessions d'un compte -----------------------------------------------------------------------

def test_sessions_d_un_compte_listees_puis_fermees(admin, nouveau_client, compte_mdp, db):
    compte = compte_mdp(EMAIL)
    postes = [nouveau_client(), nouveau_client()]
    for poste in postes:
        connexion_mdp(poste, EMAIL)
    sessions = admin.get(f"{BASE}/utilisateurs/{compte.id}/sessions").json()
    assert len(sessions) == 2 and all(s["agent"] for s in sessions)
    assert admin.delete(f"{BASE}/utilisateurs/{compte.id}/sessions").status_code == 204
    assert admin.get(f"{BASE}/utilisateurs/{compte.id}/sessions").json() == []
    for poste in postes:
        assert poste.get(f"{BASE}/moi").status_code == 401
    assert _derniere(db, "revocation_sessions").details == {"sessions": 2}


def test_fermer_ses_propres_sessions_par_l_administration_refuse(admin, db):
    uid = _user(db, ADMIN_EMAIL).id
    r = admin.delete(f"{BASE}/utilisateurs/{uid}/sessions")
    assert r.status_code == 400 and r.json()["code"] == "action_sur_soi"


# --- Renvoi du lien de première connexion ---------------------------------------------------

def test_renvoi_du_lien_invalide_le_precedent(admin, nouveau_client, creer_compte, boite, db):
    creer_compte(EMAIL, modes_connexion=["mot_de_passe"])
    premier = boite[-1].texte.split("jeton=", 1)[1].split()[0]
    boite.clear()
    r = admin.post(f"{BASE}/utilisateurs/{_user(db).id}/renvoyer-lien")
    assert r.status_code == 204
    (message,) = boite
    second = message.texte.split("jeton=", 1)[1].split()[0]
    c = nouveau_client()
    assert c.post(f"{BASE}/auth/premiere-connexion", json={"jeton": premier, "mot_de_passe": "phrase solide numero un"}).status_code == 400
    assert c.post(f"{BASE}/auth/premiere-connexion", json={"jeton": second, "mot_de_passe": "phrase solide numero un"}).status_code == 204
    assert _derniere(db, "renvoi_lien").cible == f"utilisateur:{_user(db).id}"


def test_renvoi_refuse_si_le_mot_de_passe_est_deja_choisi_ou_le_compte_desactive(admin, compte_mdp, boite):
    actif = compte_mdp(EMAIL)
    r = admin.post(f"{BASE}/utilisateurs/{actif.id}/renvoyer-lien")
    assert r.status_code == 400 and r.json()["code"] == "deja_active"
    off = compte_mdp("off@cabinet.example.org", actif=False)
    assert admin.post(f"{BASE}/utilisateurs/{off.id}/renvoyer-lien").json()["code"] == "compte_desactive"
    assert boite == []


def test_renvoi_pour_un_compte_google_seul_renvoie_l_invitation(admin, creer_compte, boite, db):
    creer_compte(EMAIL, modes_connexion=["google"])
    boite.clear()
    assert admin.post(f"{BASE}/utilisateurs/{_user(db).id}/renvoyer-lien").status_code == 204
    assert "Continuer avec Google" in boite[-1].texte and "jeton=" not in boite[-1].texte


# --- Réinitialisation par l'administrateur ----------------------------------------------------

def test_reinitialisation_par_l_admin(admin, nouveau_client, compte_mdp, boite, db):
    compte = compte_mdp(EMAIL)
    poste = nouveau_client()
    connexion_mdp(poste, EMAIL)

    assert admin.post(f"{BASE}/utilisateurs/{compte.id}/reinitialiser-mot-de-passe").status_code == 204
    assert poste.get(f"{BASE}/moi").status_code == 401           # sessions fermées
    assert _user(db).doit_changer_mdp is True
    (message,) = [m for m in boite if m.destinataire == EMAIL]
    assert "réinitialisé" in message.sujet and "nouveau-mot-de-passe?jeton=" in message.texte

    # L'ancien mot de passe ouvre encore une session… qui impose le changement.
    c = nouveau_client()
    assert connexion_mdp(c, EMAIL).json()["doit_changer_mdp"] is True

    # Le lien reçu lève l'obligation.
    jeton = message.texte.split("jeton=", 1)[1].split()[0]
    r = nouveau_client().post(f"{BASE}/auth/mot-de-passe/reinitialiser", json={"jeton": jeton, "nouveau": "nouvelle phrase choisie"})
    assert r.status_code == 204
    assert _user(db).doit_changer_mdp is False
    assert _derniere(db, "reinitialisation_par_admin").utilisateur_id == _user(db, ADMIN_EMAIL).id


def test_reinitialisation_refusee_sur_soi_sans_mode_ou_compte_desactive(admin, compte_mdp, db):
    soi = _user(db, ADMIN_EMAIL)
    assert admin.post(f"{BASE}/utilisateurs/{soi.id}/reinitialiser-mot-de-passe").json()["code"] == "action_sur_soi"
    google = compte_mdp("google@cabinet.example.org", modes=("google",))
    assert admin.post(f"{BASE}/utilisateurs/{google.id}/reinitialiser-mot-de-passe").json()["code"] == "mode_non_autorise"
    off = compte_mdp("off@cabinet.example.org", actif=False)
    assert admin.post(f"{BASE}/utilisateurs/{off.id}/reinitialiser-mot-de-passe").json()["code"] == "compte_desactive"


def test_changement_impose_depuis_la_session(nouveau_client, admin, compte_mdp, db):
    """Après la réinitialisation par l'admin, le changement depuis la session
    (page « première connexion » sans jeton) lève aussi l'obligation."""
    compte = compte_mdp(EMAIL)
    admin.post(f"{BASE}/utilisateurs/{compte.id}/reinitialiser-mot-de-passe")
    c = nouveau_client()
    connexion_mdp(c, EMAIL)
    r = c.post(f"{BASE}/moi/mot-de-passe", json={"ancien": MDP, "nouveau": "nouvelle phrase choisie"})
    assert r.status_code == 204
    assert c.get(f"{BASE}/moi").json()["doit_changer_mdp"] is False


# --- Dernier administrateur ------------------------------------------------------------------

def test_le_dernier_administrateur_ne_peut_pas_etre_retire(admin, nouveau_client, compte_mdp, db):
    """Deux administrateurs : le second désactive le premier (motif), puis
    devient le dernier ; retirer l'administration à son rôle est refusé."""
    direction = admin.post(f"{BASE}/roles/{_roles(admin)['Administrateur']}/dupliquer", json={"libelle": "Direction"}).json()
    compte_mdp("direction@cabinet.example.org", role="Direction")
    second = nouveau_client()
    connexion_mdp(second, "direction@cabinet.example.org")

    premier = _user(db, ADMIN_EMAIL)
    r = second.patch(f"{BASE}/utilisateurs/{premier.id}", json={"actif": False, "motif": "Départ du cabinet"})
    assert r.status_code == 200

    r = second.patch(f"{BASE}/roles/{direction['id']}", json={"permissions": ["analysis:read"]})
    assert r.status_code == 400 and r.json()["code"] == "dernier_administrateur"
    r = second.patch(f"{BASE}/utilisateurs/{premier.id}", json={"actif": True})
    assert r.status_code == 200  # la réactivation, elle, ne demande pas de motif
