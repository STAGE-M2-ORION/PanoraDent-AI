"""Seuils d'exploitation par classe : publiés avec la version, recopiés sur
l'analyse au traitement ; seules les anomalies au-dessus du seuil de leur
classe attendent un verdict ; les autres restent visibles, sans l'exiger."""
import pytest

from app import worker
from app.models import Analysis, Detection, StatutAnalyse
from app.services import revue

from .conftest import BASE
from .test_analyses import objets  # noqa: F401
from .test_file_traitement import _analyse, _importer, modele, reponse  # noqa: F401
from .test_registre_modeles import publier

PRATICIEN = "dr.seuil@cabinet.example.org"
SEUILS = {"caries": 0.5, "periapical_lesion": 0.3}


def creer(db, seuils):
    """Une carie à 0,8 (au-dessus de 0,5), une lésion à 0,2 (sous 0,3)."""
    a = Analysis(reference="PDX-2026-0201", image_key="images/s.png", width=2000, height=1000,
                 statut=StatutAnalyse.TERMINEE, model_version="v1", inference_mode="real", seuils=seuils)
    carie = Detection(label="caries", fdi=36, confidence=0.8, x=0.7, y=0.6, w=0.02, h=0.03, model_version="v1")
    lesion = Detection(label="periapical_lesion", fdi=37, confidence=0.2, x=0.77, y=0.68, w=0.02, h=0.03,
                       model_version="v1")
    a.detections = [carie, lesion]
    db.add(a)
    db.commit()
    return {"id": a.id, "carie": carie.id, "lesion": lesion.id}


def url(a, suite=""):
    return f"{BASE}/analyses/{a['id']}{suite}"


def test_sous_le_seuil_visible_mais_non_exige(connecte, db):
    a = creer(db, SEUILS)
    praticien = connecte(PRATICIEN)
    lue = praticien.get(url(a)).json()
    assert lue["seuils"] == SEUILS
    assert {d["id"] for d in lue["detections"]} == {a["carie"], a["lesion"]}   # rien n'est caché
    assert lue["avancement"] == {"revues": 0, "total": 1}

    r = praticien.post(url(a, f"/detections/{a['carie']}/verdict"), json={"action": "valider"})
    assert r.status_code == 200, r.text
    assert praticien.post(url(a, "/cloturer"), json={}).status_code == 200


def test_verdict_sous_le_seuil_compte_et_entre_au_compte_rendu(connecte, db):
    a = creer(db, SEUILS)
    praticien = connecte(PRATICIEN)
    r = praticien.post(url(a, f"/detections/{a['lesion']}/verdict"), json={"action": "valider"})
    assert r.status_code == 200, r.text
    assert praticien.get(url(a)).json()["avancement"] == {"revues": 1, "total": 2}
    analyse = _analyse(db, a["id"])
    assert all(revue.au_compte_rendu(analyse, d) for d in analyse.detections)


def test_compte_rendu_sans_les_detections_jamais_proposees(db):
    a = creer(db, SEUILS)
    analyse = _analyse(db, a["id"])
    retenues = {d.id for d in analyse.detections if revue.au_compte_rendu(analyse, d)}
    assert retenues == {a["carie"]}


def test_sans_seuils_toute_anomalie_attend_un_verdict(connecte, db):
    """Versions antérieures (seuils NULL) : comportement inchangé."""
    a = creer(db, None)
    praticien = connecte(PRATICIEN)
    assert praticien.get(url(a)).json()["avancement"] == {"revues": 0, "total": 2}
    praticien.post(url(a, f"/detections/{a['carie']}/verdict"), json={"action": "valider"})
    r = praticien.post(url(a, "/cloturer"), json={})
    assert r.status_code == 409 and r.json()["code"] == "detections_a_revoir"


@pytest.mark.parametrize("seuils_version, attendus", [(SEUILS, SEUILS), (None, None)])
def test_le_worker_recopie_les_seuils_de_la_version(connecte, db, objets, modele, session_factory,
                                                     seuils_version, attendus):
    mv = publier(db, "v1", actif=True)
    mv.seuils = seuils_version
    db.commit()
    a = _importer(connecte(PRATICIEN))
    modele["reponse"] = reponse(version="v1")
    worker.traiter_une(session_factory)
    analyse = _analyse(db, a["id"])
    assert analyse.statut == "terminee" and analyse.seuils == attendus

    # La version change ensuite : l'analyse garde ses règles.
    mv.seuils = {"caries": 0.9}
    db.commit()
    assert _analyse(db, a["id"]).seuils == attendus


def test_seuils_visibles_dans_le_registre(admin, db):
    publier(db, "v1").seuils = SEUILS
    db.commit()
    versions = admin.get(f"{BASE}/model/versions").json()
    assert versions[0]["seuils"] == SEUILS
