"""Sprint 4 — file de traitement : worker, statut, relance, reprise."""
import pytest
from sqlalchemy import select

from app import worker
from app.auth_models import Journal
from app.models import Analysis, StatutAnalyse
from app.services import inference_client

from .conftest import BASE
from .test_analyses import _envoyer, objets  # noqa: F401  (fixture du stockage simulé)
from .test_anonymize import octets, panoramique

L, H = 2000, 1000


def reponse(detections=None, mode="real", version="dentex-1.2"):
    return {"mode": mode, "model_version": version, "detections": detections if detections is not None else [
        {"label": "tooth", "fdi": 36, "confidence": 0.95, "bbox": [400, 300, 100, 200]},
        {"label": "caries", "fdi": 36, "confidence": 0.42, "bbox": [420, 320, 40, 40]},
        {"label": "caries", "fdi": 37, "confidence": 0.11, "bbox": [520, 320, 40, 40]},
        {"label": "periapical_lesion", "fdi": 46, "confidence": 0.07, "bbox": [600, 700, 50, 50]},  # < 0,10
        {"label": "tooth", "fdi": 18, "confidence": 0.9, "bbox": [1950, 950, 100, 100]},  # déborde : bornée
    ]}


@pytest.fixture()
def modele(monkeypatch):
    """Service d'inférence simulé ; `etat["panne"] = True` l'arrête."""
    etat = {"panne": False, "appels": 0, "reponse": reponse(), "demandes": []}

    def infer_sync(png, nom="image.png", **demande):
        etat["demandes"].append(demande)
        etat["appels"] += 1
        if etat["panne"]:
            raise ConnectionError("service d'inférence arrêté")
        return etat["reponse"]

    monkeypatch.setattr(inference_client, "infer_sync", infer_sync)
    return etat


def _analyse(db, id_) -> Analysis:
    db.expire_all()
    return db.get(Analysis, id_)


def _importer(client) -> dict:
    r = _envoyer(client, octets(panoramique()))
    assert r.status_code == 201, r.text
    return r.json()


def test_la_confirmation_met_en_file_et_repond_aussitot(connecte, objets, modele):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    assert a["statut"] == "en_file" and a["detections"] == [] and modele["appels"] == 0
    s = rabe.get(f"{BASE}/analyses/{a['id']}/statut").json()
    assert s == {"id": a["id"], "statut": "en_file", "erreur": "", "tentatives": 0, "duree_ms": None, "position": 0}


def test_detections_en_fractions_avec_la_version_du_modele(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    assert worker.traiter_une(session_factory) is True
    r = rabe.get(f"{BASE}/analyses/{a['id']}").json()
    assert r["statut"] == "terminee" and r["model_version"] == "dentex-1.2" and r["inference_mode"] == "real"
    assert r["duree_ms"] is not None and r["tentatives"] == 1
    # Tout ce qui est au-dessus de 0,10 est gardé (0,07 écartée), chacune avec sa version.
    assert sorted(d["confidence"] for d in r["detections"]) == [0.11, 0.42, 0.9, 0.95]
    assert {d["model_version"] for d in r["detections"]} == {"dentex-1.2"}
    dent = next(d for d in r["detections"] if d["fdi"] == 36 and d["label"] == "tooth")
    assert (dent["x"], dent["y"], dent["w"], dent["h"]) == (0.2, 0.3, 0.05, 0.2)
    bord = next(d for d in r["detections"] if d["fdi"] == 18)
    assert bord["x"] + bord["w"] <= 1 and bord["y"] + bord["h"] <= 1  # bornée à l'image


def test_analyse_lancee_deux_fois_une_seule_tache(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    for _ in range(2):
        r = rabe.post(f"{BASE}/analyses/{a['id']}/lancer")
        assert r.status_code == 200 and r.json()["statut"] == "en_file"
    assert db.scalars(select(Analysis)).all().__len__() == 1
    assert worker.traiter_une(session_factory) is True
    assert worker.traiter_une(session_factory) is False   # plus rien en file
    assert modele["appels"] == 1
    r = rabe.post(f"{BASE}/analyses/{a['id']}/lancer")
    assert r.status_code == 409 and r.json()["code"] == "deja_terminee"


def test_service_d_inference_arrete_echec_puis_relance(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    modele["panne"] = True
    worker.traiter_une(session_factory)
    s = rabe.get(f"{BASE}/analyses/{a['id']}/statut").json()
    assert s["statut"] == "echouee" and "ne répond pas" in s["erreur"] and s["tentatives"] == 1
    assert objets  # l'image anonymisée est gardée : on peut relancer sans réimporter

    modele["panne"] = False
    r = rabe.post(f"{BASE}/analyses/{a['id']}/lancer")
    assert r.json()["statut"] == "en_file" and r.json()["erreur"] == ""
    worker.traiter_une(session_factory)
    assert _analyse(db, a["id"]).statut == StatutAnalyse.TERMINEE
    assert _analyse(db, a["id"]).tentatives == 2
    assert db.scalars(select(Journal).where(Journal.action == "relance_analyse")).one()


def test_redemarrage_pendant_un_traitement_la_tache_repart(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    with session_factory() as s:
        assert worker.prendre_une_tache(s).id == a["id"]       # le worker la prend…
    assert _analyse(db, a["id"]).statut == StatutAnalyse.EN_COURS  # … et meurt avant de finir
    assert worker.traiter_une(session_factory) is False         # rien en file : elle serait bloquée

    with session_factory() as s:                                  # redémarrage du worker
        assert worker.reprendre_les_taches_interrompues(s) == 1
    assert _analyse(db, a["id"]).statut == StatutAnalyse.EN_FILE
    assert worker.traiter_une(session_factory) is True
    assert _analyse(db, a["id"]).statut == StatutAnalyse.TERMINEE


def test_position_dans_la_file(connecte, objets, modele):
    rabe = connecte("dr.rabe@cabinet.example.org")
    premiere, seconde = _importer(rabe), _importer(rabe)
    assert rabe.get(f"{BASE}/analyses/{seconde['id']}/statut").json()["position"] == 1
    assert rabe.get(f"{BASE}/analyses/{premiere['id']}/statut").json()["position"] == 0


def test_modele_de_remplacement_refuse_en_production(connecte, objets, modele, session_factory, monkeypatch, db):
    from app.config import settings

    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    modele["reponse"] = reponse(mode="mock", version="mock-0.0.0")
    monkeypatch.setattr(settings, "app_env", "production")
    worker.traiter_une(session_factory)
    analyse = _analyse(db, a["id"])
    assert analyse.statut == StatutAnalyse.ECHOUEE and "sans modèle entraîné" in analyse.erreur
    assert analyse.detections == []


def test_analyse_supprimee_pendant_le_traitement(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    with session_factory() as s:
        tache = worker.prendre_une_tache(s)
        assert rabe.delete(f"{BASE}/analyses/{a['id']}").status_code == 204
        worker.traiter(s, tache)  # ne plante pas, ne recrée rien
    assert _analyse(db, a["id"]) is None


def test_pas_de_compte_rendu_avant_la_fin(connecte, objets, modele):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    r = rabe.get(f"{BASE}/analyses/{a['id']}/compte-rendu", params={"brouillon": "true"})
    assert r.status_code == 409 and r.json()["code"] == "analyse_non_terminee"


def test_liste_avec_statut(connecte, objets, modele, session_factory):
    rabe = connecte("dr.rabe@cabinet.example.org")
    _importer(rabe)
    assert [x["statut"] for x in rabe.get(f"{BASE}/analyses").json()] == ["en_file"]
    worker.traiter_une(session_factory)
    assert [x["statut"] for x in rabe.get(f"{BASE}/analyses").json()] == ["terminee"]
