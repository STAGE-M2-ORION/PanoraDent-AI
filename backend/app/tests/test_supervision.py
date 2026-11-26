"""Sondes de santé et supervision (sprint 11, lot A).

Ce qui ferme le lot : une sonde en panne n'empêche pas les autres de répondre,
chacune est bornée à quelques secondes, et la page de santé publique ne
divulgue rien d'exploitable (ni version, ni trace, ni nom de machine).
"""
import asyncio
import json
import socket
import time
from datetime import datetime, timedelta

import httpx
import pytest

from app.config import settings
from app.models import Analysis, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import storage, supervision

from .conftest import BASE


class _Reponse:
    def __init__(self, statut=200, mode="real"):
        self.status_code, self._mode = statut, mode

    def json(self):
        return {"status": "ok", "mode": self._mode, "model_version": "dentex-2026.11"}


@pytest.fixture(autouse=True)
def services_sains(monkeypatch):
    """Stockage et inférence qui répondent ; chaque test en casse un."""
    monkeypatch.setattr(storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(supervision.httpx, "get", lambda url, timeout: _Reponse())


def _sonder(fabrique):
    return asyncio.run(supervision.sonder(fabrique))


# --- Sondes -------------------------------------------------------------------------

def test_tout_va_bien(session_factory):
    services = _sonder(session_factory)
    assert {n: s["etat"] for n, s in services.items()} == {
        "base": "ok", "stockage": "ok", "file": "ok", "inference": "ok"}
    assert all(isinstance(s["latence_ms"], int) for s in services.values())
    assert supervision.etat_global(services) == "ok"


def test_une_sonde_en_panne_n_empeche_pas_les_autres(session_factory, monkeypatch):
    def panne():
        raise ConnectionError("minio:9000 injoignable")

    monkeypatch.setattr(storage, "ensure_bucket", panne)
    services = _sonder(session_factory)
    assert services["stockage"] == {**services["stockage"], "etat": "panne", "detail": "Injoignable (ConnectionError)."}
    assert [services[n]["etat"] for n in ("base", "file", "inference")] == ["ok", "ok", "ok"]
    assert supervision.etat_global(services) == "degrade"


def test_une_sonde_qui_ne_repond_pas_est_bornee(session_factory, monkeypatch):
    monkeypatch.setattr(supervision, "DELAI", 0.3)

    def lente(url, timeout):
        time.sleep(3)
        return _Reponse()

    monkeypatch.setattr(supervision.httpx, "get", lente)
    async def chronometre():
        debut = time.monotonic()
        services = await supervision.sonder(session_factory)
        return services, time.monotonic() - debut

    # Durée mesurée DANS la boucle : c'est elle que voit le client. (`asyncio.run`
    # attend ensuite, à la fermeture, le fil encore bloqué ; un serveur, jamais.)
    services, duree = asyncio.run(chronometre())
    assert duree < 1.5                                         # on n'attend pas les 3 s
    assert services["inference"]["etat"] == "panne" and services["inference"]["detail"] == "Pas de réponse en 0.3 s."
    assert services["base"]["etat"] == "ok" and services["stockage"]["etat"] == "ok"


def test_base_en_panne_les_autres_repondent():
    def fabrique():
        raise OSError("connexion refusée à db:5432")

    services = _sonder(fabrique)
    assert services["base"]["etat"] == "panne" and services["file"]["etat"] == "panne"
    assert services["stockage"]["etat"] == "ok" and services["inference"]["etat"] == "ok"


def test_inference_en_erreur_ou_absente(session_factory, monkeypatch):
    monkeypatch.setattr(supervision.httpx, "get", lambda url, timeout: _Reponse(statut=503))
    assert _sonder(session_factory)["inference"]["etat"] == "panne"

    def absente(url, timeout):
        raise httpx.ConnectError("refus")

    monkeypatch.setattr(supervision.httpx, "get", absente)
    assert _sonder(session_factory)["inference"]["etat"] == "panne"


def test_modele_factice_degrade_au_cabinet_seulement(session_factory, monkeypatch):
    monkeypatch.setattr(supervision.httpx, "get", lambda url, timeout: _Reponse(mode="mock"))
    assert _sonder(session_factory)["inference"]["etat"] == "ok"   # tests, développement
    monkeypatch.setattr(settings, "app_env", "production")
    inference = _sonder(session_factory)["inference"]
    assert inference["etat"] == "degrade" and "sans modèle entraîné" in inference["detail"]


def test_file_en_retard_signalee(session_factory, db):
    db.add(Analysis(reference="PDX-2026-1200", image_key="k", width=1, height=1, statut=StatutAnalyse.EN_FILE,
                    lance_le=datetime.utcnow() - timedelta(minutes=25)))
    db.commit()
    fil = _sonder(session_factory)["file"]
    assert fil["etat"] == "degrade"
    assert fil["detail"].startswith("1 analyse et 0 document en attente ; la plus ancienne attend depuis 25 min")


# --- Page de santé publique ---------------------------------------------------------

def test_page_de_sante_publique_et_muette(nouveau_client):
    r = nouveau_client().get(f"{BASE}/health")   # sans session
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {"statut": "ok", "services": {"base": "ok", "stockage": "ok", "file": "ok", "inference": "ok"}}
    texte = r.text.lower()
    for secret in ("version", "dentex", "mode", "inference:8001", "minio", "latence", "detail",
                   socket.gethostname().lower(), "traceback"):
        assert secret not in texte, secret


def test_page_de_sante_degradee_sans_detail(nouveau_client, monkeypatch):
    def panne():
        raise ConnectionError("minio:9000 injoignable depuis panoradent-backend-7f9c")

    monkeypatch.setattr(storage, "ensure_bucket", panne)
    r = nouveau_client().get(f"{BASE}/health")
    assert r.status_code == 200
    assert r.json() == {"statut": "degrade",
                        "services": {"base": "ok", "stockage": "panne", "file": "ok", "inference": "ok"}}
    assert "minio" not in r.text and "panoradent-backend" not in r.text and "ConnectionError" not in r.text


def test_page_de_sante_503_si_la_base_est_injoignable(nouveau_client):
    from app.database import get_session_factory
    from app.main import app

    c = nouveau_client()

    def fabrique():
        raise OSError("db:5432")

    app.dependency_overrides[get_session_factory] = lambda: fabrique
    r = c.get(f"{BASE}/health")
    assert r.status_code == 503 and r.json()["services"]["base"] == "panne"


# --- Supervision (administration) ---------------------------------------------------

def test_supervision_detaillee_et_indicateurs(admin, db):
    aujourd_hui = datetime.utcnow()
    for i, (statut, duree) in enumerate([(StatutAnalyse.TERMINEE, 1000), (StatutAnalyse.TERMINEE, 3000),
                                         (StatutAnalyse.ECHOUEE, None), (StatutAnalyse.EN_FILE, None)]):
        db.add(Analysis(reference=f"PDX-2026-13{i:02d}", image_key="k", width=1, height=1, statut=statut,
                        lance_le=aujourd_hui, duree_ms=duree))
    db.add(Analysis(reference="PDX-2026-1399", image_key="k", width=1, height=1, statut=StatutAnalyse.TERMINEE,
                    lance_le=aujourd_hui - timedelta(days=30), duree_ms=99999))   # hors fenêtre
    db.commit()

    corps = admin.get(f"{BASE}/supervision").json()
    assert corps["statut"] == "ok"
    assert corps["services"]["base"]["detail"] == "La base répond."
    assert corps["services"]["file"]["detail"] == "1 analyse et 0 document en attente."
    ind = corps["indicateurs"]
    assert ind["jours"] == 14 and len(ind["analyses_par_jour"]) == 14
    assert ind["analyses_par_jour"][-1] == {"jour": aujourd_hui.date().isoformat(), "analyses": 4}
    assert (ind["duree_moyenne_ms"], ind["taux_echec"], ind["traitees"], ind["echouees"]) == (2000, 0.3333, 3, 1)


def test_supervision_reservee_a_l_administration(connecte, nouveau_client):
    for role in (PRACTITIONER_ROLE, VIEWER_ROLE):
        c = connecte(f"{role.lower()}.supervision@cabinet.example.org", role)
        assert c.get(f"{BASE}/supervision").status_code == 403
    assert nouveau_client().get(f"{BASE}/supervision").status_code == 401


def test_indicateurs_sans_analyse(db):
    ind = supervision.indicateurs(db)
    assert (ind["duree_moyenne_ms"], ind["taux_echec"], ind["traitees"]) == (None, None, 0)
    assert json.dumps(ind)   # sérialisable tel quel
