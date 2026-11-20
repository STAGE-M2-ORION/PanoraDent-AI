"""POST /utilisateurs : modes de connexion choisis par l'administrateur et
e-mail de première connexion."""
from sqlalchemy import select

from app.auth_models import Jeton, TypeJeton, Utilisateur

from .conftest import BASE, connexion_mdp

EMAIL = "dr.rabe@cabinet.example.org"
MOT_DE_PASSE = "mon premier mot de passe"


def _roles(admin) -> dict:
    return {r["libelle"]: r["id"] for r in admin.get(f"{BASE}/roles").json()}


def _creer(admin, **champs):
    corps = {"email": EMAIL, "prenom": "Aina", "role_id": _roles(admin)["Praticien"], **champs}
    return admin.post(f"{BASE}/utilisateurs", json=corps)


def test_creation_envoie_le_lien_de_premiere_connexion(admin, nouveau_client, boite, db):
    r = _creer(admin, modes_connexion=["mot_de_passe", "google"])
    assert r.status_code == 201, r.text
    assert r.json()["modes_connexion"] == ["mot_de_passe", "google"]
    assert r.json()["mot_de_passe_defini"] is False

    (message,) = [m for m in boite if m.destinataire == EMAIL]
    assert message.sujet == "Votre compte PanoraDent AI"
    assert "Bonjour Aina," in message.texte and "Continuer avec Google" in message.texte
    jeton = message.texte.split("premiere-connexion?jeton=", 1)[1].split()[0]
    lignes = db.scalars(select(Jeton).join(Utilisateur).where(Utilisateur.email == EMAIL)).all()
    assert [l.type for l in lignes] == [TypeJeton.premiere_connexion]

    # Le lien reçu sert une fois : le praticien choisit son mot de passe et entre.
    praticien = nouveau_client()
    r = praticien.post(f"{BASE}/auth/premiere-connexion", json={"jeton": jeton, "mot_de_passe": MOT_DE_PASSE})
    assert r.status_code == 204
    assert praticien.get(f"{BASE}/moi").json()["email"] == EMAIL
    assert connexion_mdp(nouveau_client(), EMAIL, MOT_DE_PASSE).status_code == 200


def test_compte_mot_de_passe_seul_mail_sans_mention_de_google(admin, boite):
    assert _creer(admin, modes_connexion=["mot_de_passe"]).status_code == 201
    (message,) = [m for m in boite if m.destinataire == EMAIL]
    assert "premiere-connexion?jeton=" in message.texte and "Google" not in message.texte


def test_compte_google_seul_recoit_une_invitation_sans_lien_a_usage_unique(admin, boite, db):
    assert _creer(admin, modes_connexion=["google"]).status_code == 201
    (message,) = [m for m in boite if m.destinataire == EMAIL]
    assert "Continuer avec Google" in message.texte and "jeton=" not in message.texte
    assert "http://localhost:3000/connexion" in message.texte
    assert not db.scalars(select(Jeton).join(Utilisateur).where(Utilisateur.email == EMAIL)).all()


def test_modes_de_connexion_invalides_422(admin, boite):
    for modes in ([], ["sms"], "google"):
        r = _creer(admin, modes_connexion=modes)
        assert r.status_code == 422 and r.json()["code"] == "champ_invalide", modes
    assert boite == []


def test_modes_dedoublonnes_et_ordonnes(admin):
    r = _creer(admin, modes_connexion=["google", "mot_de_passe", "google"])
    assert r.json()["modes_connexion"] == ["mot_de_passe", "google"]


def test_adresse_deja_prise_aucun_mail(admin, boite):
    assert _creer(admin).status_code == 201
    boite.clear()
    r = _creer(admin, email=EMAIL.upper())
    assert r.status_code == 409 and r.json()["code"] == "adresse_deja_prise"
    assert boite == []
