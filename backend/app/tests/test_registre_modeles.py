"""Sprint 6, lot B — registre des modèles, bascule sans redéploiement.

Le service d'inférence est simulé : `charger` (préchargement avant bascule)
et `infer_sync` (worker).
"""
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import worker
from app.auth_models import Journal
from app.models import Analysis, BasculeModele, ModelVersion
from app.services import inference_client

from .conftest import BASE


def erreur(r):
    return r.json().get("code")
from .test_analyses import objets  # noqa: F401  (fixture du stockage simulé)
from .test_file_traitement import _analyse, _importer, modele, reponse  # noqa: F401

SHA = {v: {"dents": f"{i}d".ljust(64, "0"), "anomalies": f"{i}a".ljust(64, "0")}
       for i, v in enumerate(("v1", "v2", "v3"))}


def publier(db, version, servable=True, actif=False):
    mv = ModelVersion(version=version, dataset="DENTEX", actif=actif)
    if servable:
        mv.poids_dents, mv.poids_anomalies = f"{version}/dents.pt", f"{version}/anomalies.pt"
        mv.sha256_dents, mv.sha256_anomalies = SHA[version]["dents"], SHA[version]["anomalies"]
    db.add(mv)
    db.commit()
    return mv


@pytest.fixture()
def service(monkeypatch):
    """`charges` : versions que le service a accepté de charger ; `refus` : son refus."""
    etat = {"charges": [], "refus": None, "panne": False}

    def charger(version, sha_dents, sha_anomalies):
        if etat["panne"]:
            raise ConnectionError("service arrêté")
        if etat["refus"]:
            raise inference_client.RefusInference(*etat["refus"])
        etat["charges"].append((version, sha_dents, sha_anomalies))
        return {"version": version}

    monkeypatch.setattr(inference_client, "charger", charger)
    return etat


def activer(client, version, motif="Évaluation sur le test interne meilleure"):
    return client.post(f"{BASE}/model/versions/{version}/activer", json={"motif": motif})


def active(db):
    db.expire_all()
    return db.scalar(select(ModelVersion.version).where(ModelVersion.actif.is_(True)))


# --- Bascule -----------------------------------------------------------------

def test_bascule_precharge_puis_active_et_journalise(admin, db, service):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    r = activer(admin, "v2")
    assert r.status_code == 200, r.text
    assert r.json()["version"] == "v2" and r.json()["actif"]
    assert service["charges"] == [("v2", SHA["v2"]["dents"], SHA["v2"]["anomalies"])]
    assert active(db) == "v2"
    [b] = db.scalars(select(BasculeModele)).all()
    assert (b.version_precedente, b.version) == ("v1", "v2") and b.motif.startswith("Évaluation")
    assert db.scalar(select(Journal).where(Journal.action == "bascule_modele")) is not None
    bascules = admin.get(f"{BASE}/model/bascules").json()
    assert bascules[0]["version"] == "v2" and bascules[0]["auteur_nom"]


def test_bascule_refusee_si_le_service_ne_peut_pas_charger(admin, db, service):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    service["refus"] = ("poids_differents", "Le fichier « anomalies » de la version v2 n'est pas celui qui a été publié.")
    r = activer(admin, "v2")
    assert r.status_code == 409 and erreur(r) == "modele_non_chargeable"
    assert "anomalies" in r.json()["message"]
    assert active(db) == "v1"                       # rien n'a changé
    assert db.scalars(select(BasculeModele)).all() == []


def test_bascule_refusee_si_le_service_est_arrete(admin, db, service):
    publier(db, "v2")
    service["panne"] = True
    r = activer(admin, "v2")
    assert r.status_code == 503 and active(db) is None


@pytest.mark.parametrize("cas, attendu", [
    ({"version": "v9"}, (404, "introuvable")),
    ({"version": "v2", "motif": "  "}, (422, "motif_requis")),
    ({"version": "v3"}, (409, "modele_sans_poids")),
    ({"version": "v1"}, (409, "deja_active")),
])
def test_bascules_refusees(admin, db, service, cas, attendu):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    publier(db, "v3", servable=False)
    r = activer(admin, cas["version"], cas.get("motif", "motif"))
    assert (r.status_code, erreur(r)) == attendu
    assert active(db) == "v1" and service["charges"] == []


def test_bascule_reservee_a_model_manage(connecte, db, service):
    publier(db, "v2")
    praticien = connecte("dr.rabe@cabinet.example.org")
    assert praticien.get(f"{BASE}/model/versions").status_code == 200      # model:read
    assert activer(praticien, "v2").status_code == 403


def test_une_seule_version_active_tenue_par_la_base(db):
    publier(db, "v1", actif=True)
    with pytest.raises(IntegrityError):
        publier(db, "v2", actif=True)


def test_liste_des_versions(admin, db):
    publier(db, "v1", actif=True)
    publier(db, "v3", servable=False)
    versions = {v["version"]: v for v in admin.get(f"{BASE}/model/versions").json()}
    assert versions["v1"]["actif"] and versions["v1"]["servable"]
    assert versions["v1"]["sha256"] == SHA["v1"]
    assert not versions["v3"]["actif"] and not versions["v3"]["servable"]


def test_mesures_rendues_telles_qu_ecrites_au_registre(admin, db):
    """Page Performances (sprint 10) : la route rend les mesures du registre à
    l'identique — rien de retiré, rien de recalculé à la lecture."""
    import json

    mesures = {
        "map50": 0.5097, "precision": 0.5424, "recall": 0.5166, "test_images": 109, "partition": "test",
        "anomalies": {"detection": {"par_classe": {"caries": {"instances": 332, "mAP50": 0.493}},
                                    "confusion": {"etiquettes": ["caries", "fond"], "matrice": [[134, 130], [180, 0]]}}},
        "seuils_exploitation": {"par_classe": {"caries": {"seuil": 0.1, "rappel": 0.597}},
                                "courbes": {"caries": [[0.05, 0.71, 0.318], [0.1, 0.597, 0.37]]}},
    }
    mv = publier(db, "v1", actif=True)
    mv.metrics_json = json.dumps(mesures)
    mv.empreinte_decoupage = "f" * 64
    db.commit()
    (v,) = admin.get(f"{BASE}/model/versions").json()
    assert v["metrics"] == mesures and v["empreinte_decoupage"] == "f" * 64


# --- Épinglage : une analyse garde la version reçue à sa mise en file --------

def test_analyse_en_file_garde_sa_version_apres_une_bascule(
        admin, connecte, db, service, objets, modele, session_factory):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    rabe = connecte("dr.rabe@cabinet.example.org")
    a1 = _importer(rabe)
    assert a1["version_demandee"] == "v1"

    assert activer(admin, "v2").status_code == 200   # bascule pendant que a1 attend
    a2 = _importer(rabe)
    assert a2["version_demandee"] == "v2"

    modele["reponse"] = reponse(version="v1")
    assert worker.traiter_une(session_factory)
    modele["reponse"] = reponse(version="v2")
    assert worker.traiter_une(session_factory)
    assert modele["demandes"] == [
        {"version": "v1", "sha_dents": SHA["v1"]["dents"], "sha_anomalies": SHA["v1"]["anomalies"]},
        {"version": "v2", "sha_dents": SHA["v2"]["dents"], "sha_anomalies": SHA["v2"]["anomalies"]},
    ]
    assert _analyse(db, a1["id"]).model_version == "v1"
    assert {d.model_version for d in _analyse(db, a1["id"]).detections} == {"v1"}
    assert _analyse(db, a2["id"]).model_version == "v2"


def test_reponse_d_une_autre_version_refusee(connecte, db, objets, modele, session_factory):
    publier(db, "v1", actif=True)
    a = _importer(connecte("dr.rabe@cabinet.example.org"))
    modele["reponse"] = reponse(version="v2")
    worker.traiter_une(session_factory)
    analyse = _analyse(db, a["id"])
    assert analyse.statut == "echouee" and "au lieu de v1" in analyse.erreur
    assert analyse.detections == []


def test_poids_refuses_par_le_service_echec_lisible(connecte, db, objets, modele, session_factory, monkeypatch):
    publier(db, "v1", actif=True)
    a = _importer(connecte("dr.rabe@cabinet.example.org"))

    def refuse(png, nom="image.png", **demande):
        raise inference_client.RefusInference("modele_introuvable",
                                              "Le modèle « dents » de la version v1 n'est pas installé.")

    monkeypatch.setattr(inference_client, "infer_sync", refuse)
    worker.traiter_une(session_factory)
    analyse = _analyse(db, a["id"])
    assert analyse.statut == "echouee" and "n'est pas installé" in analyse.erreur


def test_relance_prend_la_version_active(admin, connecte, db, service, objets, modele, session_factory):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _importer(rabe)
    modele["panne"] = True
    worker.traiter_une(session_factory)
    assert activer(admin, "v2").status_code == 200
    rabe.post(f"{BASE}/analyses/{a['id']}/lancer")
    assert _analyse(db, a["id"]).version_demandee == "v2"


def test_sans_version_active_mode_historique(connecte, db, objets, modele, session_factory):
    a = _importer(connecte("dr.rabe@cabinet.example.org"))
    assert a["version_demandee"] is None
    worker.traiter_une(session_factory)
    assert modele["demandes"] == [{}]


def test_publication_factice_reservee_aux_tests(client, db):
    """Route du parcours Playwright : APP_ENV=test seulement (les tests tournent ainsi)."""
    corps = {"version": "e2e-v1", "sha_dents": "a" * 64, "sha_anomalies": "b" * 64, "map50": 0.5}
    assert client.post(f"{BASE}/test/modeles", json=corps).status_code == 201
    assert client.post(f"{BASE}/test/modeles", json=corps).status_code == 409
    mv = db.scalar(select(ModelVersion).where(ModelVersion.version == "e2e-v1"))
    assert mv.servable and not mv.actif
    from app import main
    assert any(getattr(r, "path", "") == "/api/v1/test/modeles" for r in main.app.routes)
