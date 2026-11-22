"""Sprint 7, lot B — numéros des dents corrigés, anomalies qui suivent leur dent,
incohérences signalées sans correction, dents déclarées absentes."""
import pytest
from sqlalchemy import select

from app import worker
from app.auth_models import Journal
from app.models import Analysis, Detection, StatutAnalyse
from app.permissions import VIEWER_ROLE

from .conftest import BASE
from .test_analyses import objets  # noqa: F401
from .test_file_traitement import _analyse, _importer, modele, reponse  # noqa: F401

PRATICIEN = "dr.numero@cabinet.example.org"


def dent(fdi, x, rang=None):
    """Dent du quadrant de `fdi`, abscisse `x` (fractions de l'image)."""
    y = 0.3 if fdi // 10 in (1, 2) else 0.55
    return Detection(label="tooth", fdi=fdi, rang=rang, confidence=0.95, x=x, y=y, w=0.04, h=0.15,
                     model_version="rangs-1")


@pytest.fixture()
def analyse(db):
    """Quatre dents (11, 21, 36, 37) ; une carie sur la 36, une lésion sur la 37."""
    a = Analysis(reference="PDX-2026-0101", image_key="images/n.png", width=2000, height=1000,
                 statut=StatutAnalyse.TERMINEE, model_version="rangs-1", inference_mode="real")
    d11, d21, d36, d37 = dent(11, 0.46, 1), dent(21, 0.50, 1), dent(36, 0.70, 6), dent(37, 0.76, 7)
    carie = Detection(label="caries", fdi=36, confidence=0.8, x=0.71, y=0.6, w=0.02, h=0.03,
                      model_version="rangs-1", dent=d36)
    lesion = Detection(label="periapical_lesion", fdi=37, confidence=0.6, x=0.77, y=0.68, w=0.02, h=0.03,
                       model_version="rangs-1", dent=d37)
    a.detections = [d11, d21, d36, d37, carie, lesion]
    db.add(a)
    db.commit()
    return {"id": a.id, **{k: d.id for k, d in (("11", d11), ("21", d21), ("36", d36), ("37", d37),
                                                 ("carie", carie), ("lesion", lesion))}}


def url(analyse, suite=""):
    return f"{BASE}/analyses/{analyse['id']}{suite}"


def verdict(client, analyse, cle, action, **champs):
    r = client.post(url(analyse, f"/detections/{analyse[cle]}/verdict"), json={"action": action, **champs})
    assert r.status_code == 200, r.text
    return r


def lire(client, analyse):
    a = client.get(url(analyse)).json()
    return a, {d["id"]: d for d in a["detections"]}


def test_corriger_le_numero_d_une_dent_renumerote_ses_anomalies(connecte, analyse):
    praticien = connecte(PRATICIEN)
    verdict(praticien, analyse, "36", "corriger", fdi=46)
    a, dets = lire(praticien, analyse)
    assert dets[analyse["36"]]["fdi"] == 46 and dets[analyse["36"]]["proposition"]["fdi"] == 36
    assert dets[analyse["carie"]]["fdi"] == 46                     # suit sa dent
    assert dets[analyse["carie"]]["proposition"]["fdi"] == 36       # proposition intacte
    assert dets[analyse["carie"]]["dent_id"] == analyse["36"]
    assert dets[analyse["lesion"]]["fdi"] == 37                     # l'autre dent n'a pas bougé


def test_numero_fixe_par_le_praticien_sur_l_anomalie_fait_foi(connecte, analyse):
    praticien = connecte(PRATICIEN)
    verdict(praticien, analyse, "carie", "corriger", fdi=35)
    verdict(praticien, analyse, "36", "corriger", fdi=46)
    _, dets = lire(praticien, analyse)
    assert dets[analyse["carie"]]["fdi"] == 35


def test_dent_rejetee_l_anomalie_garde_son_propre_numero(connecte, analyse):
    praticien = connecte(PRATICIEN)
    verdict(praticien, analyse, "36", "corriger", fdi=46)
    verdict(praticien, analyse, "36", "rejeter")
    _, dets = lire(praticien, analyse)
    assert dets[analyse["carie"]]["fdi"] == 36


def test_doublon_signale_puis_disparait_quand_le_praticien_corrige(connecte, analyse):
    praticien = connecte(PRATICIEN)
    verdict(praticien, analyse, "37", "corriger", fdi=36)            # deux « 36 »
    a, dets = lire(praticien, analyse)
    assert [i["type"] for i in a["incoherences"]] == ["doublon"]
    assert a["incoherences"][0]["fdi"] == [36]
    assert dets[analyse["36"]]["douteux"] and dets[analyse["37"]]["douteux"]
    assert not dets[analyse["11"]]["douteux"]
    assert dets[analyse["36"]]["fdi"] == 36                          # rien n'est corrigé d'office
    verdict(praticien, analyse, "37", "corriger", fdi=37)
    a, dets = lire(praticien, analyse)
    assert a["incoherences"] == [] and not dets[analyse["36"]]["douteux"]


def test_rangs_dans_le_desordre_signales(connecte, analyse):
    praticien = connecte(PRATICIEN)
    verdict(praticien, analyse, "36", "corriger", fdi=38)            # 38 plus près de la médiane que 37
    a, _ = lire(praticien, analyse)
    assert [i["type"] for i in a["incoherences"]] == ["ordre"]
    assert a["incoherences"][0]["fdi"] == [38, 37]


def test_dent_declaree_absente(connecte, analyse, db):
    praticien = connecte(PRATICIEN)
    r = praticien.post(url(analyse, "/dents/18/absente"))
    assert r.status_code == 200 and [x["fdi"] for x in r.json()["dents_absentes"]] == [18]
    assert r.json()["dents_absentes"][0]["auteur_nom"]
    assert praticien.post(url(analyse, "/dents/18/absente")).status_code == 200        # idempotent
    # Une dent détectée ne peut pas être déclarée absente…
    r = praticien.post(url(analyse, "/dents/36/absente"))
    assert r.status_code == 409 and r.json()["code"] == "dent_detectee"
    # … sauf après avoir rejeté la détection.
    verdict(praticien, analyse, "36", "rejeter")
    assert praticien.post(url(analyse, "/dents/36/absente")).status_code == 200
    r = praticien.delete(url(analyse, "/dents/18/absente"))
    assert [x["fdi"] for x in r.json()["dents_absentes"]] == [36]
    assert praticien.post(url(analyse, "/dents/19/absente")).json()["code"] == "dent_invalide"
    actions = {j.action for j in db.scalars(select(Journal))}
    assert {"dent_absente", "dent_absente_retiree"} <= actions


def test_absente_puis_detectee_signale(connecte, analyse):
    praticien = connecte(PRATICIEN)
    praticien.post(url(analyse, "/dents/38/absente"))
    verdict(praticien, analyse, "37", "corriger", fdi=38)
    a, _ = lire(praticien, analyse)
    assert "absente_detectee" in [i["type"] for i in a["incoherences"]]


def test_lecteur_ne_declare_rien(connecte, analyse):
    lecteur = connecte("lecteur.numero@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.post(url(analyse, "/dents/18/absente")).status_code == 403
    assert lecteur.get(url(analyse)).status_code == 200


def test_le_worker_garde_le_rang_et_le_rattachement(connecte, db, objets, modele, session_factory):
    rabe = connecte(PRATICIEN)
    a = _importer(rabe)
    modele["reponse"] = reponse(version="rangs-1", detections=[
        {"label": "tooth", "rang": 6, "fdi": 36, "confidence": 0.95, "bbox": [400, 300, 100, 200]},
        {"label": "tooth", "rang": 7, "fdi": 37, "confidence": 0.05, "bbox": [520, 300, 100, 200]},   # < 0,10
        {"label": "caries", "fdi": 36, "dent": 0, "confidence": 0.6, "bbox": [420, 320, 40, 40]},
        {"label": "caries", "fdi": 37, "dent": 1, "confidence": 0.5, "bbox": [540, 320, 40, 40]},
    ])
    worker.traiter_une(session_factory)
    analyse = _analyse(db, a["id"])
    dents = [d for d in analyse.detections if d.label == "tooth"]
    caries = sorted((d for d in analyse.detections if d.label == "caries"), key=lambda d: d.fdi)
    assert [d.rang for d in dents] == [6]
    assert caries[0].dent_id == dents[0].id
    assert caries[1].dent_id is None              # sa dent n'a pas été gardée (sous 0,10)
