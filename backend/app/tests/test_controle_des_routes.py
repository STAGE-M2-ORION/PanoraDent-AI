"""Sprint 8, lot E — contrôle d'accès de TOUTES les routes, y compris celles à venir.

Le sprint 2 a posé : toute route est publique (liste fermée) ou exige une
session. On ajoute ici les deux étages suivants, calculés sur les routes
réellement montées (une route ajoutée demain est contrôlée sans rien écrire) :

1. les routes qui exigent une session SANS permission (ouvertes à tous les
   rôles, lecteur compris) forment une liste fermée : en ajouter une est un
   choix conscient ;
2. le rôle lecteur est refusé (403) sur toute route d'écriture, hors son
   propre compte : masquer un bouton n'est pas une protection, c'est le
   serveur qui refuse.
"""
import re

from fastapi.routing import APIRoute

from app.auth_deps import publique
from app.main import app
from app.permissions import VIEWER_ROLE

from .conftest import BASE

ECRITURE = {"POST", "PUT", "PATCH", "DELETE"}

# Routes ouvertes à toute session : son propre compte, les photos des
# collègues (avatars), l'en-tête du cabinet (affiché sur le compte rendu).
SANS_PERMISSION = {
    ("GET", "/api/v1/moi"), ("PATCH", "/api/v1/moi"), ("PATCH", "/api/v1/moi/preferences"),
    ("POST", "/api/v1/moi/mot-de-passe"), ("GET", "/api/v1/moi/sessions"),
    ("DELETE", "/api/v1/moi/sessions/{session_id}"),
    ("PUT", "/api/v1/moi/photo"), ("DELETE", "/api/v1/moi/photo"), ("GET", "/api/v1/photos/{utilisateur_id}"),
    ("GET", "/api/v1/cabinet"), ("GET", "/api/v1/cabinet/logo"),
}


def _appels(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _appels(d)


def _routes():
    for route in app.routes:
        if isinstance(route, APIRoute):
            appels = list(_appels(route.dependant))
            for methode in route.methods:
                yield methode, route.path, appels


def _exige_une_permission(appels) -> bool:
    return any("exiger" in getattr(c, "__qualname__", "") for c in appels)


def test_routes_sans_permission_liste_fermee():
    ouvertes = {(m, p) for m, p, appels in _routes() if publique not in appels and not _exige_une_permission(appels)}
    assert ouvertes == SANS_PERMISSION, (
        f"Route ouverte à tous les rôles ajoutée : {sorted(ouvertes - SANS_PERMISSION)} ; "
        f"ou retirée : {sorted(SANS_PERMISSION - ouvertes)}")


def test_le_lecteur_est_refuse_sur_toute_route_d_ecriture(connecte):
    lecteur = connecte("lecteur.routes@cabinet.example.org", VIEWER_ROLE)
    ecritures = sorted((m, p) for m, p, appels in _routes()
                       if m in ECRITURE and publique not in appels and (m, p) not in SANS_PERMISSION)
    assert len(ecritures) >= 25                        # garde-fou : la découverte des routes fonctionne
    acceptees = []
    for methode, chemin in ecritures:
        # Le refus précède toute lecture : des identifiants factices suffisent.
        url = re.sub(r"\{(\w+)\}", lambda m: "18" if m.group(1) == "fdi" else "inconnu", chemin)
        r = lecteur.request(methode, url, json={})
        if r.status_code != 403 or r.json().get("code") != "acces_refuse":
            acceptees.append(f"{methode} {chemin} -> {r.status_code}")
    assert not acceptees, f"Routes d'écriture que le lecteur n'est pas empêché d'appeler : {acceptees}"


def test_le_lecteur_consulte_sans_rien_produire(connecte, admin, db):
    from app.models import Analysis, StatutAnalyse

    a = Analysis(reference="PDX-2026-0300", image_key="images/l.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="v1", inference_mode="real")
    db.add(a)
    db.commit()
    lecteur = connecte("lecteur.consulte@cabinet.example.org", VIEWER_ROLE)
    # Consulter : l'analyse, l'historique et sa fiche, l'export CSV (une lecture), les modèles, l'en-tête.
    for url in (f"{BASE}/analyses", f"{BASE}/analyses/{a.id}", f"{BASE}/historique", f"{BASE}/historique.csv",
                f"{BASE}/analyses/{a.id}/historique", f"{BASE}/model/versions", f"{BASE}/cabinet"):
        assert lecteur.get(url).status_code == 200, url
    # Produire un compte rendu reste réservé (report:generate), même en brouillon.
    r = lecteur.get(f"{BASE}/analyses/{a.id}/compte-rendu", params={"brouillon": "true"})
    assert r.status_code == 403 and r.json()["code"] == "acces_refuse"
