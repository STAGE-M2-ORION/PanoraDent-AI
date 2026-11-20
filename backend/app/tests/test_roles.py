"""Sprint 2 — rôles et permissions : rôles système figés, rôles personnalisés,
duplication, journal, effet d'un changement de rôle."""
from jose import jwt
from sqlalchemy import select

from app.auth_deps import COOKIE_ACCES
from app.auth_models import Journal

from .conftest import BASE, connexion_mdp

LECTEUR = ["analysis:read", "model:read"]


def _roles(client) -> dict:
    return {r["libelle"]: r for r in client.get(f"{BASE}/roles").json()}


def _journal(db, action) -> list[Journal]:
    db.expire_all()
    return db.scalars(select(Journal).where(Journal.action == action).order_by(Journal.horodatage)).all()


def test_roles_systeme_figes_quel_que_soit_le_champ(admin):
    for libelle, role in _roles(admin).items():
        assert role["systeme"] is True and role["description"]
        for corps in ({"libelle": f"{libelle} bis"}, {"description": "autre"}, {"permissions": ["model:read"]}):
            r = admin.patch(f"{BASE}/roles/{role['id']}", json=corps)
            assert r.status_code == 400 and r.json()["code"] == "role_systeme", (libelle, corps)
        assert admin.delete(f"{BASE}/roles/{role['id']}").json()["code"] == "role_systeme"
    # Rien n'a bougé.
    assert sorted(_roles(admin)["Lecteur"]["permissions"]) == LECTEUR


def test_creer_un_role_avec_description_et_nom_deja_pris_refuse(admin, db):
    r = admin.post(f"{BASE}/roles", json={
        "libelle": "Assistant", "description": "Prépare les clichés", "permissions": ["analysis:create", "analysis:read"],
    })
    assert r.status_code == 201
    assert r.json()["description"] == "Prépare les clichés" and r.json()["systeme"] is False
    for libelle in ("assistant", "PRATICIEN"):
        r = admin.post(f"{BASE}/roles", json={"libelle": libelle})
        assert r.status_code == 409 and r.json()["code"] == "libelle_deja_pris", libelle
    ligne = _journal(db, "creation_role")[-1]
    assert ligne.details["libelle"] == "Assistant" and ligne.cible.startswith("role:")


def test_modifier_un_role_personnalise_journalise_avant_apres(admin, db):
    rid = admin.post(f"{BASE}/roles", json={"libelle": "Assistant", "permissions": ["analysis:read"]}).json()["id"]
    r = admin.patch(f"{BASE}/roles/{rid}", json={
        "libelle": "Assistant dentaire", "description": "Accueil", "permissions": ["analysis:read", "model:read"],
    })
    assert r.status_code == 200
    assert (r.json()["libelle"], r.json()["description"]) == ("Assistant dentaire", "Accueil")
    ligne = _journal(db, "modification_role")[-1]
    assert ligne.details["avant"]["permissions"] == ["analysis:read"]
    assert ligne.details["apres"]["permissions"] == ["analysis:read", "model:read"]


def test_dupliquer_un_role_systeme_donne_un_role_personnalise(admin, db):
    praticien = _roles(admin)["Praticien"]
    copie = admin.post(f"{BASE}/roles/{praticien['id']}/dupliquer").json()
    assert copie["libelle"] == "Copie de Praticien" and copie["systeme"] is False
    assert copie["permissions"] == praticien["permissions"] and copie["description"] == praticien["description"]
    seconde = admin.post(f"{BASE}/roles/{praticien['id']}/dupliquer").json()
    assert seconde["libelle"] == "Copie de Praticien (2)"
    nommee = admin.post(f"{BASE}/roles/{praticien['id']}/dupliquer", json={"libelle": "Praticien junior"})
    assert nommee.status_code == 201 and nommee.json()["libelle"] == "Praticien junior"
    # La copie, elle, se modifie.
    assert admin.patch(f"{BASE}/roles/{copie['id']}", json={"permissions": LECTEUR}).status_code == 200
    assert _journal(db, "duplication_role")[-1].details["source"] == "Praticien"


def test_suppression_d_un_role_attribue_refusee_puis_journalisee(admin, db):
    role = admin.post(f"{BASE}/roles", json={"libelle": "Assistant", "permissions": LECTEUR}).json()
    compte = admin.post(f"{BASE}/utilisateurs", json={"email": "assistant@cabinet.example.org", "role_id": role["id"]}).json()
    r = admin.delete(f"{BASE}/roles/{role['id']}")
    assert r.status_code == 400 and r.json()["code"] == "role_utilise"
    admin.patch(f"{BASE}/utilisateurs/{compte['id']}", json={"role_id": _roles(admin)["Lecteur"]["id"], "motif": "Réorganisation"})
    assert admin.delete(f"{BASE}/roles/{role['id']}").status_code == 204
    assert _journal(db, "suppression_role")[-1].details["libelle"] == "Assistant"


def test_praticien_appelant_une_route_d_administration_403(connecte):
    praticien = connecte("dr.rabe@cabinet.example.org")
    for methode, chemin in (
        ("get", "/utilisateurs"), ("post", "/utilisateurs"), ("get", "/roles"), ("get", "/permissions"),
        ("post", "/roles"),
    ):
        r = getattr(praticien, methode)(f"{BASE}{chemin}", **({"json": {}} if methode == "post" else {}))
        assert r.status_code == 403, chemin


def test_role_gestion_des_comptes_sans_gestion_des_roles(admin, nouveau_client, compte_mdp, db):
    """Un rôle `user:manage` seul lit les rôles (pour les attribuer) mais ne les modifie pas."""
    admin.post(f"{BASE}/roles", json={"libelle": "Secrétariat", "permissions": ["user:manage"]})
    compte_mdp("secretariat@cabinet.example.org", role="Secrétariat")
    c = nouveau_client()
    connexion_mdp(c, "secretariat@cabinet.example.org")
    assert c.get(f"{BASE}/roles").status_code == 200
    assert c.get(f"{BASE}/permissions").status_code == 200
    assert c.post(f"{BASE}/roles", json={"libelle": "Autre"}).status_code == 403
    assert c.get(f"{BASE}/utilisateurs").status_code == 200


def test_changement_de_role_immediat_et_porte_par_le_jeton_rafraichi(admin, nouveau_client, compte_mdp, db):
    """Les permissions sont relues en base à chaque requête : le changement de
    rôle s'applique tout de suite, et le jeton rafraîchi porte les nouvelles."""
    compte = compte_mdp("dr.rabe@cabinet.example.org")
    praticien = nouveau_client()
    connexion_mdp(praticien, "dr.rabe@cabinet.example.org")
    assert praticien.get(f"{BASE}/moi").json()["role"]["libelle"] == "Praticien"

    lecteur = _roles(admin)["Lecteur"]["id"]
    r = admin.patch(f"{BASE}/utilisateurs/{compte.id}", json={"role_id": lecteur, "motif": "Stage terminé"})
    assert r.status_code == 200

    assert praticien.get(f"{BASE}/moi").json()["permissions"] == LECTEUR  # sans attendre
    assert praticien.post(f"{BASE}/auth/rafraichir").status_code == 204
    jeton = praticien.cookies.get(COOKIE_ACCES)
    assert sorted(jwt.get_unverified_claims(jeton)["permissions"]) == LECTEUR
