"""Durcissement de l'API (sprint 12, lot D) : limitation de débit, en-têtes de
sécurité, bornes de taille des corps et de chaque téléversement."""
import pytest
from sqlalchemy import select

from app import securite
from app.auth_models import Journal
from app.config import settings

from .conftest import BASE, MDP, connexion_mdp


def figer_le_compteur(monkeypatch, instant: float = 1_800_000_030.0) -> None:
    """Le compteur seul compte à un instant fixe ; le reste de l'application
    (expiration des jetons…) garde l'heure réelle."""
    compter = securite.COMPTEUR.compter
    monkeypatch.setattr(securite.COMPTEUR, "compter",
                        lambda regle, adresse, limite, maintenant=None: compter(regle, adresse, limite, maintenant=instant))


@pytest.fixture()
def limites(monkeypatch):
    """Rallume la limitation (coupée pour les autres tests), compteurs neufs.
    L'horloge du limiteur est figée au milieu d'une minute : sinon un test
    qui chevauche le changement de minute voit son compteur repartir à zéro."""
    securite.COMPTEUR.vider()
    figer_le_compteur(monkeypatch)

    def _regler(**valeurs):
        for nom, valeur in valeurs.items():
            monkeypatch.setattr(settings, nom, valeur)

    yield _regler
    securite.COMPTEUR.vider()


# --- Limitation de débit -------------------------------------------------------------

def test_connexion_limitee_par_poste_et_journalisee(client, compte_mdp, db, limites):
    limites(limite_connexion_minute=3)
    compte_mdp("dr.debit@cabinet.example.org")
    for _ in range(3):
        assert connexion_mdp(client, "dr.debit@cabinet.example.org", "faux mot de passe").status_code == 401
    for _ in range(2):
        r = connexion_mdp(client, "dr.debit@cabinet.example.org", MDP)   # même le bon mot de passe
        assert r.status_code == 429
        assert r.json()["code"] == "trop_de_requetes"
        assert 1 <= int(r.headers["retry-after"]) <= 60
    # Un autre poste n'est pas concerné.
    r = client.post(f"{BASE}/auth/connexion", json={"email": "dr.debit@cabinet.example.org", "mot_de_passe": MDP},
                    headers={"X-Real-IP": "192.0.2.50"})
    assert r.status_code == 200
    # Une seule entrée au journal pour la fenêtre, avec la règle et la limite.
    (entree,) = db.scalars(select(Journal).where(Journal.action == "limite_depassee")).all()
    assert entree.details == {"regle": "connexion", "limite_par_minute": 3}
    assert entree.resultat == "refus"


def test_mot_de_passe_oublie_et_liens_limites(client, limites):
    limites(limite_oubli_minute=2, limite_connexion_minute=2)
    codes = [client.post(f"{BASE}/auth/mot-de-passe/oubli", json={"email": "x@cabinet.example.org"}).status_code
             for _ in range(3)]
    assert codes == [204, 204, 429]
    codes = [client.post(f"{BASE}/auth/premiere-connexion", json={"jeton": "faux", "nouveau": MDP}).status_code
             for _ in range(3)]
    assert codes[-1] == 429 and 429 not in codes[:2]


def test_api_limitee_mais_pas_la_sonde(admin, limites):
    limites(limite_api_minute=5)
    codes = [admin.get(f"{BASE}/moi").status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]
    # La sonde de santé (interrogée en continu par la supervision) n'est jamais comptée.
    from starlette.requests import Request
    sonde = Request({"type": "http", "method": "GET", "path": f"{BASE}/health", "headers": [], "query_string": b""})
    assert securite._regles_de(sonde) == []


def test_fenetre_suivante_repart_de_zero():
    c = securite.Compteur()
    assert [c.compter("r", "a", 2, maintenant=120.0)[0] for _ in range(3)] == [True, True, False]
    ok, n, reste = c.compter("r", "a", 2, maintenant=179.5)
    assert (ok, n, reste) == (False, 4, 1)
    assert c.compter("r", "a", 2, maintenant=180.0)[:2] == (True, 1)


# --- En-têtes de sécurité ---------------------------------------------------------------

def test_entetes_de_securite_sur_l_api(admin, client):
    for r in (admin.get(f"{BASE}/moi"), client.get(f"{BASE}/moi"), admin.get(f"{BASE}/introuvable")):
        h = r.headers
        assert h["x-content-type-options"] == "nosniff"
        assert h["x-frame-options"] == "DENY"
        assert h["referrer-policy"] == "no-referrer"
        assert h["cross-origin-resource-policy"] == "same-origin"
        assert h["content-security-policy"].startswith("default-src 'none'")
        assert "form-action 'self'" in h["content-security-policy"]
        assert h["cache-control"] == "no-store"
        assert "server" not in h
    # La documentation interactive charge ses scripts : pas de politique de contenu.
    assert client.get("/docs").headers.get("content-security-policy") is None


def test_entetes_aussi_sur_un_refus_de_debit(admin, limites):
    limites(limite_api_minute=1)
    admin.get(f"{BASE}/moi")
    r = admin.get(f"{BASE}/moi")
    assert r.status_code == 429 and r.headers["x-frame-options"] == "DENY"


# --- Bornes de taille ---------------------------------------------------------------------

def test_corps_json_borne_a_un_mega(admin):
    r = admin.put(f"{BASE}/cabinet", content=b"{" + b" " * (1024 * 1024 + 10) + b"}",
                  headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json()["code"] == "requete_trop_volumineuse"


def test_corps_annonce_trop_gros_refuse_avant_lecture(admin):
    """La taille annoncée suffit : le corps n'est pas lu (ni écrit sur le disque)."""
    r = admin.post(f"{BASE}/documents", content=b"x" * 10,
                   headers={"content-type": "multipart/form-data; boundary=b", "content-length": str(30 * 1024 * 1024)})
    assert r.status_code == 413 and r.json()["code"] == "fichier_trop_volumineux"


PNG = b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(("methode", "chemin", "champ", "module", "message"), [
    ("post", "/analyses", "fichier", "app.services.anonymize", "20 Mo"),
    ("post", "/analyses/apercu", "fichier", "app.services.anonymize", "20 Mo"),
    ("put", "/cabinet/logo", "fichier", "app.routers.cabinet", "1 Mo"),
    ("put", "/moi/photo", "fichier", "app.routers.photos", "2 Mo"),
    ("post", "/documents", "fichier", "app.routers.documents", "20 Mo"),
])
def test_chaque_televersement_est_borne(admin, monkeypatch, methode, chemin, champ, module, message):
    """Chaque route revérifie la taille de SON fichier (sous la borne générale de
    21 Mo). Plafond abaissé à 4 Kio le temps du test : même code, sans envoyer
    20 Mo ; un octet de plus que le plafond est refusé."""
    import importlib
    monkeypatch.setattr(importlib.import_module(module), "TAILLE_MAX", 4096)
    nom = "doc.md" if chemin == "/documents" else "image.png"
    r = getattr(admin, methode)(f"{BASE}{chemin}", files={champ: (nom, PNG + b"0" * (4097 - len(PNG)), "image/png")})
    assert r.status_code == 413, (chemin, r.status_code, r.text[:200])
    assert r.json()["code"] == "fichier_trop_volumineux" and message in r.json()["message"]
