"""Sprint 1 — critères d'acceptation de l'authentification Google.

Les six premiers cas sont ceux qui, mal traités, laissent entrer n'importe qui.
"""
import io
import time
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.routing import APIRoute
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select

from app import auth_security as sec
from app.auth_deps import COOKIE_ACCES, COOKIE_OAUTH, COOKIE_RAFRAICHISSEMENT, publique, session_ouverte
from app.auth_models import Journal, SessionUtilisateur, Utilisateur
from app.config import Settings
from app.identity import FournisseurGoogle, fournisseur, sub_factice
from app.main import app
from app.permissions import PERMISSIONS, PRACTITIONER_ROLE, VIEWER_ROLE
from app.routers import analyses as analyses_router

from .conftest import ADMIN_EMAIL, BASE, connexion, demarrer, erreur


def _set_cookies(r) -> dict[str, str]:
    """En-têtes Set-Cookie par nom de cookie."""
    return {h.split("=", 1)[0]: h for h in r.headers.get_list("set-cookie")}


def _user(db, email) -> Utilisateur:
    db.expire_all()
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _nb_sessions(db) -> int:
    db.expire_all()
    return len(db.scalars(select(SessionUtilisateur)).all())


def _journal(db, action=None) -> list[Journal]:
    db.expire_all()
    q = select(Journal).order_by(Journal.horodatage)
    if action:
        q = q.where(Journal.action == action)
    return db.scalars(q).all()


# --- 1. Démarrage ----------------------------------------------------------

def test_demarrer_porte_state_nonce_challenge_et_pose_le_state_en_cookie(client):
    r = client.get(f"{BASE}/auth/google/demarrer", follow_redirects=False)
    assert r.status_code == 302
    params = parse_qs(urlparse(r.headers["location"]).query)
    assert params["state"][0] and params["nonce"][0] and params["code_challenge"][0]

    cookie = _set_cookies(r)[COOKIE_OAUTH].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    tx = sec.decode_token(client.cookies.get(COOKIE_OAUTH), sec.OAUTH)
    assert tx["state"] == params["state"][0]
    assert tx["nonce"] == params["nonce"][0]
    assert sec.pkce_challenge(tx["cv"]) == params["code_challenge"][0]


def test_url_google_complete_avec_pkce_s256():
    url = FournisseurGoogle().url_autorisation("s", "n", "c")
    parsed = urlparse(url)
    q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    assert parsed.netloc == "accounts.google.com"
    assert q["response_type"] == "code" and q["code_challenge_method"] == "S256"
    assert q["state"] == "s" and q["nonce"] == "n" and q["code_challenge"] == "c"
    assert "openid" in q["scope"].split() and "email" in q["scope"].split()
    assert q["client_id"] and q["redirect_uri"].endswith("/api/v1/auth/google/retour")


# --- 2. state ----------------------------------------------------------------

def test_state_different_refuse_sans_session(client, db):
    r = connexion(client, ADMIN_EMAIL, state="un-autre-state")
    assert erreur(r) == "etat_invalide"
    assert COOKIE_ACCES not in _set_cookies(r)
    assert _nb_sessions(db) == 0


def test_retour_sans_cookie_de_transaction_refuse(client, nouveau_client, db):
    params = demarrer(client)
    autre_navigateur = nouveau_client()  # n'a pas le cookie : attaque par fixation de session
    fake = fournisseur()
    code = fake.emettre_code(fake.revendications(ADMIN_EMAIL, params["nonce"]), params["code_challenge"])
    r = autre_navigateur.get(
        f"{BASE}/auth/google/retour", params={"code": code, "state": params["state"]}, follow_redirects=False
    )
    assert erreur(r) == "etat_invalide"
    assert _nb_sessions(db) == 0


# --- 3 à 6. Les six contrôles du jeton d'identité --------------------------

def test_aud_d_un_autre_client_refuse(client, db):
    r = connexion(client, ADMIN_EMAIL, aud="autre-application.apps.googleusercontent.com")
    assert erreur(r) == "echec_google"
    assert _nb_sessions(db) == 0
    assert "aud_invalide" in _journal(db, "connexion")[-1].details["motif"]


def test_jeton_expire_puis_signature_invalide_refuses(client, nouveau_client, db):
    passe = int(time.time()) - 3600
    r = connexion(client, ADMIN_EMAIL, iat=passe - 300, exp=passe)
    assert erreur(r) == "echec_google"
    assert "jeton_expire" in _journal(db, "connexion")[-1].details["motif"]

    r = connexion(nouveau_client(), ADMIN_EMAIL, cle="etrangere")
    assert erreur(r) == "echec_google"
    assert "signature_invalide" in _journal(db, "connexion")[-1].details["motif"]
    assert _nb_sessions(db) == 0


def test_emetteur_autre_que_google_refuse(client, db):
    assert erreur(connexion(client, ADMIN_EMAIL, iss="https://attaquant.example")) == "echec_google"
    assert _nb_sessions(db) == 0


def test_nonce_different_refuse(client, db):
    r = connexion(client, ADMIN_EMAIL, nonce="nonce-d-une-ancienne-demande")
    assert erreur(r) == "etat_invalide"
    assert _nb_sessions(db) == 0


def test_email_non_verifie_refuse(client, db):
    assert erreur(connexion(client, ADMIN_EMAIL, email_verified=False)) == "adresse_non_verifiee"
    assert _nb_sessions(db) == 0


def test_pkce_code_verifier_obligatoire(client, db):
    """Un code intercepté ne sert à rien sans le code_verifier de CE navigateur."""
    params = demarrer(client)
    fake = fournisseur()
    code = fake.emettre_code(fake.revendications(ADMIN_EMAIL, params["nonce"]), "challenge-d-un-autre")
    r = client.get(
        f"{BASE}/auth/google/retour", params={"code": code, "state": params["state"]}, follow_redirects=False
    )
    assert erreur(r) == "echec_google"
    assert _nb_sessions(db) == 0


def test_refus_de_consentement_chez_google(client):
    params = demarrer(client)
    r = client.get(
        f"{BASE}/auth/google/retour",
        params={"error": "access_denied", "state": params["state"]},
        follow_redirects=False,
    )
    assert erreur(r) == "echec_google"


# --- 7. Adresse inconnue ---------------------------------------------------

def test_adresse_inconnue_refusee_et_aucun_compte_cree(client, db):
    avant = len(db.scalars(select(Utilisateur)).all())
    r = connexion(client, "inconnu@gmail.example.org")
    assert erreur(r) == "compte_inconnu"
    db.expire_all()
    assert len(db.scalars(select(Utilisateur)).all()) == avant
    ligne = _journal(db, "connexion")[-1]
    assert ligne.resultat == "refus" and "adresse_inconnue" in ligne.details["motif"]


# --- 8. Compte désactivé ---------------------------------------------------

def test_compte_desactive_refuse(admin, creer_compte, nouveau_client, db):
    compte = creer_compte("dr.martin@cabinet.example.org")
    r = admin.patch(f"{BASE}/utilisateurs/{compte['id']}", json={"actif": False})
    assert r.status_code == 200 and r.json()["actif"] is False
    assert erreur(connexion(nouveau_client(), "dr.martin@cabinet.example.org")) == "compte_desactive"


# --- 9. Première connexion -------------------------------------------------

def test_premiere_connexion_enregistre_sub_et_pose_les_cookies(client, db):
    assert _user(db, ADMIN_EMAIL).google_sub is None
    r = connexion(client, ADMIN_EMAIL, given_name="Lionel", family_name="Rakoto")
    assert erreur(r) is None
    assert r.headers["location"] == "http://localhost:3000/"

    u = _user(db, ADMIN_EMAIL)
    assert u.google_sub == sub_factice(ADMIN_EMAIL)
    assert u.derniere_connexion is not None
    assert (u.prenom, u.nom) == ("Lionel", "Rakoto")  # repris de Google car vides

    cookies = _set_cookies(r)
    for nom in (COOKIE_ACCES, COOKIE_RAFRAICHISSEMENT):
        attrs = cookies[nom].lower()
        assert "httponly" in attrs and "secure" in attrs and "samesite=lax" in attrs
    assert "max-age=900" in cookies[COOKIE_ACCES].lower()
    assert f"max-age={7 * 24 * 3600}" in cookies[COOKIE_RAFRAICHISSEMENT].lower()

    acces = sec.decode_token(client.cookies.get(COOKIE_ACCES), sec.ACCESS)
    assert acces["sub"] == str(u.id) and acces["role"] == "Administrateur"
    assert set(acces["permissions"]) == set(PERMISSIONS)

    moi = client.get(f"{BASE}/moi")
    assert moi.status_code == 200
    assert moi.json()["email"] == ADMIN_EMAIL and moi.json()["role"]["libelle"] == "Administrateur"
    assert _journal(db, "connexion")[-1].resultat == "succes"


def test_noms_saisis_par_l_administrateur_ne_sont_pas_ecrases(creer_compte, nouveau_client, db):
    creer_compte("dr.durand@cabinet.example.org", nom="Durand", prenom="Alice")
    c = nouveau_client()
    assert erreur(connexion(c, "dr.durand@cabinet.example.org", given_name="Ali", family_name="D.")) is None
    u = _user(db, "dr.durand@cabinet.example.org")
    assert (u.prenom, u.nom) == ("Alice", "Durand")


def test_sub_connu_avec_nouvelle_adresse_met_la_ligne_a_jour(client, nouveau_client, db):
    assert erreur(connexion(client, ADMIN_EMAIL)) is None
    sub = _user(db, ADMIN_EMAIL).google_sub
    r = connexion(nouveau_client(), "admin.nouvelle@cabinet.example.org", sub=sub)
    assert erreur(r) is None
    assert _user(db, "admin.nouvelle@cabinet.example.org").google_sub == sub
    assert _user(db, ADMIN_EMAIL) is None


# --- 10. Adresse connue, autre sub ------------------------------------------

def test_adresse_connue_avec_un_autre_sub_refusee_et_journalisee(client, nouveau_client, db):
    assert erreur(connexion(client, ADMIN_EMAIL)) is None
    r = connexion(nouveau_client(), ADMIN_EMAIL, sub="un-autre-compte-google")
    assert erreur(r) == "compte_inconnu"
    ligne = _journal(db, "connexion")[-1]
    assert ligne.resultat == "refus" and "sub_different" in ligne.details["motif"]
    assert ligne.utilisateur_id == _user(db, ADMIN_EMAIL).id
    assert _user(db, ADMIN_EMAIL).google_sub == sub_factice(ADMIN_EMAIL)


# --- 11. 401 sans jeton ; rafraîchissement après déconnexion ----------------

def test_routes_protegees_sans_jeton_401(client):
    for methode, url in (
        ("get", f"{BASE}/moi"),
        ("get", f"{BASE}/analyses"),
        ("get", f"{BASE}/model/versions"),
        ("get", f"{BASE}/utilisateurs"),
        ("post", f"{BASE}/utilisateurs"),
        ("get", f"{BASE}/roles"),
    ):
        r = getattr(client, methode)(url)
        assert r.status_code == 401, url
        assert r.json()["code"] == "non_authentifie" and r.json()["message"]


def test_rafraichir_puis_deconnexion_revoque_des_deux_cotes(admin, db):
    rafraichissement = admin.cookies.get(COOKIE_RAFRAICHISSEMENT)
    acces = admin.cookies.get(COOKIE_ACCES)

    r = admin.post(f"{BASE}/auth/rafraichir")
    assert r.status_code == 204 and COOKIE_ACCES in _set_cookies(r)

    r = admin.post(f"{BASE}/auth/deconnexion")
    assert r.status_code == 204
    cookies = _set_cookies(r)
    assert 'max-age=0' in cookies[COOKIE_ACCES].lower() and 'max-age=0' in cookies[COOKIE_RAFRAICHISSEMENT].lower()
    assert _journal(db, "deconnexion")[-1].resultat == "succes"

    # Un jeton volé avant la déconnexion ne sert plus à rien.
    admin.cookies.set(COOKIE_RAFRAICHISSEMENT, rafraichissement, path="/api/v1/auth")
    admin.cookies.set(COOKIE_ACCES, acces, path="/api")
    r = admin.post(f"{BASE}/auth/rafraichir")
    assert r.status_code == 401 and r.json()["code"] == "session_expiree"
    assert admin.get(f"{BASE}/moi").status_code == 401


def test_rafraichir_sans_cookie_ou_session_expiree(nouveau_client, admin, db):
    assert nouveau_client().post(f"{BASE}/auth/rafraichir").status_code == 401
    for s in db.scalars(select(SessionUtilisateur)):
        s.expire_le = s.expire_le.replace(year=2000)
    db.commit()
    assert admin.post(f"{BASE}/auth/rafraichir").status_code == 401


def test_jeton_de_rafraichissement_refuse_comme_jeton_d_acces(admin):
    admin.cookies.set(COOKIE_ACCES, admin.cookies.get(COOKIE_RAFRAICHISSEMENT), path="/api")
    assert admin.get(f"{BASE}/moi").status_code == 401


def test_desactivation_coupe_la_session_immediatement(admin, connecte, db):
    praticien = connecte("dr.leroy@cabinet.example.org")
    assert praticien.get(f"{BASE}/moi").status_code == 200
    uid = _user(db, "dr.leroy@cabinet.example.org").id
    admin.patch(f"{BASE}/utilisateurs/{uid}", json={"actif": False})
    assert praticien.get(f"{BASE}/moi").status_code == 401
    assert praticien.post(f"{BASE}/auth/rafraichir").status_code == 401


# --- 12. Création de compte ------------------------------------------------

def test_creation_de_compte_403_201_409(admin, connecte, db):
    praticien = connecte("dr.petit@cabinet.example.org")
    roles = {r["libelle"]: r["id"] for r in admin.get(f"{BASE}/roles").json()}
    corps = {"nom": "Bernard", "prenom": "Paul", "email": "Dr.Bernard@Cabinet.example.org",
             "role_id": roles[VIEWER_ROLE]}

    r = praticien.post(f"{BASE}/utilisateurs", json=corps)
    assert r.status_code == 403 and r.json()["code"] == "acces_refuse"

    r = admin.post(f"{BASE}/utilisateurs", json=corps)
    assert r.status_code == 201
    compte = r.json()
    assert compte["email"] == "dr.bernard@cabinet.example.org"  # stockée en minuscules
    assert compte["role"]["libelle"] == VIEWER_ROLE and compte["actif"] is True
    assert {"analysis:read", "model:read"} == set(compte["permissions"])
    assert "google_sub" not in compte

    r = admin.post(f"{BASE}/utilisateurs", json={**corps, "email": "DR.BERNARD@cabinet.example.org"})
    assert r.status_code == 409 and r.json()["code"] == "adresse_deja_prise"

    ligne = _journal(db, "creation_compte")[-1]
    assert ligne.details["adresse"] == "dr.bernard@cabinet.example.org"
    assert ligne.utilisateur_id == _user(db, ADMIN_EMAIL).id

    liste = admin.get(f"{BASE}/utilisateurs").json()
    assert "dr.bernard@cabinet.example.org" in {u["email"] for u in liste}


def test_creation_de_compte_champ_invalide_422(admin):
    roles = admin.get(f"{BASE}/roles").json()
    r = admin.post(f"{BASE}/utilisateurs", json={"email": "pas-une-adresse", "role_id": roles[0]["id"]})
    assert r.status_code == 422
    assert r.json()["code"] == "champ_invalide" and "email" in r.json()["message"]
    r = admin.post(f"{BASE}/utilisateurs", json={"email": "x@cabinet.example.org",
                                                 "role_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 422 and r.json()["code"] == "champ_invalide"


# --- Autorisation par permission ------------------------------------------

def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("L", (64, 32), 128).save(buf, format="PNG")
    return buf.getvalue()


def test_lecteur_ne_cree_pas_d_analyse_mais_lit(connecte):
    lecteur = connecte("lecteur@cabinet.example.org", VIEWER_ROLE)
    r = lecteur.post(f"{BASE}/analyses", files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 403
    assert lecteur.get(f"{BASE}/analyses").status_code == 200
    assert lecteur.get(f"{BASE}/utilisateurs").status_code == 403


def test_flux_d_analyse_du_praticien(connecte, monkeypatch):
    stored = {}
    monkeypatch.setattr(analyses_router.storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(analyses_router.storage, "put", lambda k, d, c: stored.setdefault(k, d))
    monkeypatch.setattr(analyses_router.storage, "presigned_url", lambda k, expires=3600: f"http://s3/{k}")

    async def fake_infer(png, name="image.png"):
        return {"mode": "mock", "model_version": "t", "detections": [
            {"label": "tooth", "fdi": 11, "confidence": 0.9, "bbox": [1, 2, 3, 4]}]}

    monkeypatch.setattr(analyses_router.inference_client, "infer", fake_infer)
    praticien = connecte("dr.moreau@cabinet.example.org")
    r = praticien.post(f"{BASE}/analyses", files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    analyse = r.json()
    assert analyse["detections"][0]["fdi"] == 11 and stored
    assert praticien.get(f"{BASE}/analyses/{analyse['id']}").status_code == 200


def test_toute_route_porte_un_garde_ou_la_marque_publique():
    """Échoue si une route n'exige ni session/permission ni n'est marquée publique."""
    def appels(dependant):
        for dep in dependant.dependencies:
            yield dep.call
            yield from appels(dep)

    sans_garde = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        calls = set(appels(route.dependant))
        if publique not in calls and session_ouverte not in calls:
            sans_garde.append(f"{sorted(route.methods)} {route.path}")
    assert not sans_garde, f"Routes sans garde : {sans_garde}"


def test_routes_publiques_attendues():
    """La liste des routes publiques est fermée : en ajouter une est un choix conscient."""
    publiques = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and publique in {d.call for d in route.dependant.dependencies}:
            publiques.add(route.path)
    assert publiques == {
        "/", "/api/v1/health",
        "/api/v1/auth/google/demarrer", "/api/v1/auth/google/retour",
        "/api/v1/auth/rafraichir", "/api/v1/auth/deconnexion",
        "/api/v1/auth/fake/autoriser", "/api/v1/auth/fake/valider",
    }


# --- Garde-fous ------------------------------------------------------------

def test_fournisseur_factice_refuse_hors_environnement_de_test():
    for env in ("development", "production"):
        with pytest.raises(ValidationError):
            Settings(app_env=env, identity_provider="fake",
                     jwt_secret="x" * 40, google_client_id="a", google_client_secret="b")


def test_production_exige_secret_client_google_et_smtp():
    valide = dict(
        app_env="production", identity_provider="google", jwt_secret="x" * 40,
        google_client_id="a", google_client_secret="b", bcrypt_cout=12,
        courriel_mode="smtp", smtp_hote="smtp.example.org",
    )
    Settings(**valide)
    for defaut in (
        {"google_client_id": ""},
        {"jwt_secret": "court"},
        {"courriel_mode": "console"},
        {"smtp_hote": ""},
    ):
        with pytest.raises(ValidationError):
            Settings(**{**valide, **defaut})
    with pytest.raises(ValidationError):
        Settings(app_env="development", identity_provider="google", courriel_mode="memoire")


def test_pas_de_suppression_ni_de_retrait_de_son_propre_acces(admin, db):
    uid = _user(db, ADMIN_EMAIL).id
    roles = {r["libelle"]: r["id"] for r in admin.get(f"{BASE}/roles").json()}
    r = admin.patch(f"{BASE}/utilisateurs/{uid}", json={"actif": False})
    assert r.status_code == 400 and r.json()["code"] == "action_sur_soi"
    r = admin.patch(f"{BASE}/utilisateurs/{uid}", json={"role_id": roles[PRACTITIONER_ROLE]})
    assert r.status_code == 400
    assert admin.delete(f"{BASE}/utilisateurs/{uid}").status_code == 405


def test_jeu_de_depart_rejouable(db):
    from app import seed_auth
    for _ in range(3):
        perms = seed_auth.seed_permissions(db)
        roles = seed_auth.seed_roles(db, perms)
        seed_auth.seed_admin(db, roles["Administrateur"], ADMIN_EMAIL)
        db.commit()
    assert len(db.scalars(select(Utilisateur)).all()) == 1
    assert {r.libelle for r in roles.values()} == {"Administrateur", "Praticien", "Lecteur"}
    assert _user(db, ADMIN_EMAIL).actif is True


def test_jeu_de_depart_admin_deux_modes_et_lien_hache(db):
    """L'administrateur autorise les deux modes ; tant qu'il n'a pas de mot de
    passe, chaque passage émet un lien de 24 h dont seule l'empreinte est
    stockée, et qui remplace le précédent."""
    from app import seed_auth
    from app.auth_models import Jeton, TypeJeton, en_utc, maintenant

    perms = seed_auth.seed_permissions(db)
    roles = seed_auth.seed_roles(db, perms)
    liens = []
    for _ in range(2):
        liens.append(seed_auth.seed_admin(db, roles["Administrateur"], ADMIN_EMAIL))
        db.commit()

    admin = _user(db, ADMIN_EMAIL)
    assert admin.modes_connexion == ["mot_de_passe", "google"]
    assert admin.mot_de_passe is None
    jeton_clair = liens[-1].split("jeton=", 1)[1]
    assert liens[-1].startswith("http://localhost:3000/premiere-connexion?jeton=")
    (ligne,) = db.scalars(select(Jeton)).all()  # le premier lien a été invalidé
    assert ligne.type == TypeJeton.premiere_connexion
    assert ligne.empreinte != jeton_clair and len(ligne.empreinte) == 64
    duree = en_utc(ligne.expiration) - maintenant()
    assert 23.9 * 3600 < duree.total_seconds() <= 24 * 3600


def test_jeu_de_depart_complete_les_modes_d_un_admin_google(db):
    """Un administrateur venu du sprint « Google seul » reçoit aussi le mode mot de passe."""
    from app import seed_auth
    admin = _user(db, ADMIN_EMAIL)
    admin.modes_connexion = ["google"]
    db.commit()
    perms = seed_auth.seed_permissions(db)
    seed_auth.seed_admin(db, seed_auth.seed_roles(db, perms)["Administrateur"], ADMIN_EMAIL)
    db.commit()
    assert _user(db, ADMIN_EMAIL).modes_connexion == ["mot_de_passe", "google"]


def test_jeu_de_depart_sans_lien_une_fois_le_mot_de_passe_choisi(db):
    from app import seed_auth
    admin = _user(db, ADMIN_EMAIL)
    admin.mot_de_passe = "$2b$12$" + "x" * 53
    db.commit()
    perms = seed_auth.seed_permissions(db)
    lien = seed_auth.seed_admin(db, seed_auth.seed_roles(db, perms)["Administrateur"], ADMIN_EMAIL)
    assert lien is None


# --- Rôles (sprint 2, déjà en place) ---------------------------------------

def test_roles_systeme_et_crud(admin):
    roles = {r["libelle"]: r for r in admin.get(f"{BASE}/roles").json()}
    assert len(roles["Administrateur"]["permissions"]) == 8
    assert set(roles["Lecteur"]["permissions"]) == {"analysis:read", "model:read"}
    assert set(roles["Praticien"]["permissions"]) == {
        "analysis:create", "analysis:read", "analysis:delete",
        "detection:review", "report:generate", "model:read",
    }
    for role in roles.values():
        assert admin.delete(f"{BASE}/roles/{role['id']}").status_code == 400

    r = admin.post(f"{BASE}/roles", json={"libelle": "Assistant", "permissions": ["analysis:read"]})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert admin.post(f"{BASE}/roles", json={"libelle": "assistant"}).status_code == 409
    assert admin.post(f"{BASE}/roles", json={"libelle": "X2", "permissions": ["nope:nope"]}).status_code == 422
    r = admin.patch(f"{BASE}/roles/{rid}", json={"permissions": ["model:read"]})
    assert r.json()["permissions"] == ["model:read"]
    assert admin.delete(f"{BASE}/roles/{rid}").status_code == 204


def test_demarrer_sans_client_google_reste_sur_la_connexion(client, monkeypatch):
    """Sans client OAuth configuré, pas d'envoi chez Google avec une URL invalide."""
    from app.config import settings
    monkeypatch.setattr(settings, "identity_provider", "google")
    monkeypatch.setattr(settings, "google_client_id", "")
    r = client.get(f"{BASE}/auth/google/demarrer", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "http://localhost:3000/connexion?erreur=echec_google"


# --- Photo de profil -------------------------------------------------------

def _image(fmt="PNG", taille=(600, 400)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", taille, (200, 30, 30)).save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture()
def stockage(monkeypatch):
    """Stockage objet en mémoire à la place de MinIO."""
    from app.routers import photos
    objets = {}
    monkeypatch.setattr(photos.storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(photos.storage, "put", lambda k, d, c: objets.__setitem__(k, d))
    monkeypatch.setattr(photos.storage, "get", lambda k: objets[k])
    monkeypatch.setattr(photos.storage, "delete", lambda k: objets.pop(k, None))
    return objets


def test_photo_google_reprise_a_la_connexion(client, db):
    photo = "https://lh3.googleusercontent.com/a/ACg8ocJ-photo=s96-c"
    assert erreur(connexion(client, ADMIN_EMAIL, picture=photo)) is None
    moi = client.get(f"{BASE}/moi").json()
    assert moi["photo_url"] == photo and moi["photo_source"] == "google"


def test_photo_google_hors_domaine_google_ignoree(client):
    assert erreur(connexion(client, ADMIN_EMAIL, picture="https://attaquant.example/x.png")) is None
    assert client.get(f"{BASE}/moi").json()["photo_url"] is None
    assert erreur(connexion(client, ADMIN_EMAIL, picture="http://lh3.googleusercontent.com/a")) is None
    assert client.get(f"{BASE}/moi").json()["photo_url"] is None


def test_photo_importee_prioritaire_puis_retiree(client, nouveau_client, stockage):
    google = "https://lh3.googleusercontent.com/a/photo"
    assert erreur(connexion(client, ADMIN_EMAIL, picture=google)) is None

    r = client.put(f"{BASE}/moi/photo", files={"fichier": ("moi.jpg", _image("JPEG"), "image/jpeg")})
    assert r.status_code == 200, r.text
    moi = r.json()
    assert moi["photo_source"] == "importee" and moi["photo_url"].startswith(f"{BASE}/photos/")
    (cle, contenu), = stockage.items()
    with Image.open(io.BytesIO(contenu)) as img:
        assert img.format == "WEBP" and img.size == (256, 256)

    image = client.get(moi["photo_url"])
    assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
    assert nouveau_client().get(moi["photo_url"]).status_code == 401  # jamais sans session

    # Un nouvel import remplace l'ancien fichier et change l'URL.
    r2 = client.put(f"{BASE}/moi/photo", files={"fichier": ("b.png", _image("PNG"), "image/png")})
    assert r2.json()["photo_url"] != moi["photo_url"] and len(stockage) == 1

    r = client.delete(f"{BASE}/moi/photo")
    assert r.status_code == 200
    assert r.json()["photo_url"] == google and r.json()["photo_source"] == "google"
    assert stockage == {}


def test_photo_refuse_les_fichiers_qui_ne_sont_pas_des_images(client, stockage):
    assert erreur(connexion(client, ADMIN_EMAIL)) is None
    for nom, contenu in (("x.png", b"pas une image"), ("x.gif", _image("GIF")), ("vide.png", b"")):
        r = client.put(f"{BASE}/moi/photo", files={"fichier": (nom, contenu, "image/png")})
        assert r.status_code == 422 and r.json()["code"] == "image_invalide", nom
    r = client.put(f"{BASE}/moi/photo", files={"fichier": ("gros.png", b"0" * (5 * 1024 * 1024 + 1), "image/png")})
    assert r.status_code == 413
    assert stockage == {}


def test_admin_ne_se_desactive_pas_meme_avec_un_autre_admin(admin, creer_compte, db):
    creer_compte("admin2@cabinet.example.org", "Administrateur")
    uid = _user(db, ADMIN_EMAIL).id
    r = admin.patch(f"{BASE}/utilisateurs/{uid}", json={"actif": False})
    assert r.status_code == 400 and r.json()["code"] == "action_sur_soi"
    assert _user(db, ADMIN_EMAIL).actif is True
    # Le dernier administrateur reste protégé quand un AUTRE tente de le retirer.
    autre = _user(db, "admin2@cabinet.example.org").id
    assert admin.patch(f"{BASE}/utilisateurs/{autre}", json={"actif": False}).status_code == 200
