"""Sprint 11, conditions de clôture : ni le praticien ni le lecteur n'atteignent
l'administration ; un changement de paramètre du cabinet se reflète sur le
compte rendu suivant."""
import re

from fastapi.routing import APIRoute

from app.main import app
from app.permissions import PERMISSIONS, PRACTITIONER_ROLE, SYSTEM_ROLES, VIEWER_ROLE

from .conftest import BASE
from .test_analyses import objets  # noqa: F401
from .test_compte_rendu import cloturer, poser_image
from .test_revue import PRATICIEN, _url, analyse  # noqa: F401

# Permissions que ni le praticien ni le lecteur ne détiennent : celles de l'administration.
ADMINISTRATION = set(PERMISSIONS) - SYSTEM_ROLES[PRACTITIONER_ROLE] - SYSTEM_ROLES[VIEWER_ROLE]


def _permissions(route) -> set[str]:
    def appels(dependant):
        for d in dependant.dependencies:
            yield d.call
            yield from appels(d)

    trouvees = set()
    for appel in appels(route.dependant):
        p = getattr(appel, "permission", None)
        if isinstance(p, str):
            trouvees.add(p)
    return trouvees


def routes_d_administration():
    return sorted({(m, r.path) for r in app.routes if isinstance(r, APIRoute) and _permissions(r) & ADMINISTRATION
                   for m in r.methods})


def test_praticien_et_lecteur_refuses_sur_toute_route_d_administration(connecte):
    routes = routes_d_administration()
    assert {"user:manage", "role:manage", "cabinet:manage", "model:manage", "document:manage"} <= ADMINISTRATION
    # Garde-fou : la découverte trouve bien les écrans d'administration.
    for attendue in [("GET", "/api/v1/journal"), ("GET", "/api/v1/supervision"), ("GET", "/api/v1/utilisateurs"),
                     ("PUT", "/api/v1/cabinet/retention"), ("GET", "/api/v1/administration/indicateurs"),
                     ("POST", "/api/v1/journal/purge"), ("GET", "/api/v1/documents")]:
        assert attendue in routes, attendue
    acceptees = []
    for role in (PRACTITIONER_ROLE, VIEWER_ROLE):
        client = connecte(f"{role.lower()}.admin@cabinet.example.org", role)
        for methode, chemin in routes:
            url = re.sub(r"\{(\w+)\}", "00000000-0000-0000-0000-000000000000", chemin)
            r = client.request(methode, url, json={})
            if r.status_code != 403 or r.json().get("code") != "acces_refuse":
                acceptees.append(f"{role} : {methode} {chemin} -> {r.status_code}")
    assert not acceptees, acceptees


def test_un_changement_du_cabinet_se_reflete_sur_le_compte_rendu_suivant(admin, connecte, analyse, objets):
    poser_image(objets)
    praticien = connecte(PRATICIEN)
    cloturer(praticien, analyse)

    assert admin.put(f"{BASE}/cabinet", json={"nom": "Cabinet Ankatso", "adresse": "Rue 12",
                                               "mentions": "Dossier patient Ankatso."}).status_code == 200
    premier = praticien.get(_url(analyse, "/compte-rendu")).content
    assert b"Cabinet Ankatso" in premier and b"Dossier patient Ankatso." in premier

    assert admin.put(f"{BASE}/cabinet", json={"nom": "Cabinet Isoraka", "adresse": "Rue 40",
                                               "mentions": "Dossier patient Isoraka."}).status_code == 200
    suivant = praticien.get(_url(analyse, "/compte-rendu")).content
    assert b"Cabinet Isoraka" in suivant and b"Dossier patient Isoraka." in suivant
    assert b"Ankatso" not in suivant           # reconstruit à la demande : rien de figé
