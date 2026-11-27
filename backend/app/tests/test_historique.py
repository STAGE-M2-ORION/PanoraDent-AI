"""Sprint 8, lot D — historique filtré et paginé par clé, export CSV, fiche d'une analyse."""
from datetime import datetime, timedelta

import pytest
from PIL import Image
from sqlalchemy import select

from app import worker
from app.auth_models import Journal, Utilisateur
from app.models import Analysis, Detection, StatutAnalyse

from .conftest import BASE
from .test_analyses import _envoyer, objets, octets  # noqa: F401

RABE = "dr.rabe.histo@cabinet.example.org"
AUTRE = "dr.autre.histo@cabinet.example.org"
DEBUT = datetime(2026, 11, 1, 8, 0)


def _id(db, email):
    return db.scalar(select(Utilisateur.id).where(Utilisateur.email == email))


@pytest.fixture()
def cabinet(connecte, db):
    """25 analyses sur 25 jours ; Rabe en dépose les impaires. États variés."""
    rabe, autre = connecte(RABE), connecte(AUTRE)
    ids = {"rabe_id": _id(db, RABE), "autre_id": _id(db, AUTRE)}
    for i in range(1, 26):
        a = Analysis(reference=f"PDX-2026-{i:04d}", image_key=f"images/{i}.png", width=100, height=100,
                     created_at=DEBUT + timedelta(days=i - 1), utilisateur_id=ids["rabe_id" if i % 2 else "autre_id"],
                     statut=StatutAnalyse.TERMINEE, model_version="v1", inference_mode="real")
        if i == 3:
            a.statut = StatutAnalyse.ECHOUEE
        if i == 4:
            a.statut = StatutAnalyse.EN_FILE
        carie = Detection(label="caries", fdi=36, confidence=0.8, x=0.1, y=0.1, w=0.1, h=0.1, model_version="v1")
        a.detections = [Detection(label="tooth", fdi=36, confidence=0.9, x=0.1, y=0.1, w=0.1, h=0.1, model_version="v1"), carie]
        if i == 5:                       # relecture commencée
            carie.etat = "validee"
        if i in (6, 7):                  # clôturées
            carie.etat = "validee"
            a.cloturee_le = DEBUT + timedelta(days=i)
        if i == 8:                       # carie rejetée, et une lésion retenue
            carie.etat = "rejetee"
            a.detections.append(Detection(label="periapical_lesion", fdi=46, confidence=0.7, x=0.5, y=0.5, w=0.1, h=0.1,
                                          model_version="v1"))
        db.add(a)
    db.commit()
    return {"rabe": rabe, "autre": autre, **ids}


def page(client, **params):
    r = client.get(f"{BASE}/historique", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def refs(p):
    return [e["reference"] for e in p["elements"]]


def test_pagination_par_cle_sans_doublon_ni_oubli(cabinet):
    vues, apres = [], ""
    for _ in range(3):
        p = page(cabinet["rabe"], limite=10, apres=apres)
        assert p["total"] == 25
        vues += refs(p)
        apres = p["suivant"]
        if not apres:
            break
    assert vues == [f"PDX-2026-{i:04d}" for i in range(25, 0, -1)]   # plus récentes d'abord, toutes, une fois
    assert apres is None


def test_numero_tri_et_colonnes_resumees(cabinet):
    p = page(cabinet["rabe"], limite=3, tri="ancien")
    assert [(e["numero"], e["reference"]) for e in p["elements"]] == [(1, "PDX-2026-0001"), (2, "PDX-2026-0002"), (3, "PDX-2026-0003")]
    huit = page(cabinet["rabe"], q="0008")["elements"][0]
    assert huit["anomalies_retenues"] == 1 and huit["n_detections"] == 3    # la carie rejetée n'est pas retenue
    sept = page(cabinet["rabe"], q="PDX-2026-0007")["elements"][0]
    assert sept["cloturee"] and sept["cloturee_le"].startswith("2026-11-08")


@pytest.mark.parametrize("filtres, attendues", [
    ({"q": "0012"}, ["PDX-2026-0012"]),
    ({"q": "12"}, ["PDX-2026-0012"]),                       # n° d'analyse 12 (et référence qui contient « 12 »)
    ({"q": "pdx-2026-002"}, [f"PDX-2026-{i:04d}" for i in range(25, 19, -1)]),
    ({"etat": "failed"}, ["PDX-2026-0003"]),
    ({"etat": "queued"}, ["PDX-2026-0004"]),
    ({"etat": "inprogress"}, ["PDX-2026-0008", "PDX-2026-0005"]),
    ({"etat": "closed"}, ["PDX-2026-0007", "PDX-2026-0006"]),
    ({"types": ["periapical_lesion"]}, ["PDX-2026-0008"]),
    ({"du": "2026-11-10", "au": "2026-11-12"}, ["PDX-2026-0012", "PDX-2026-0011", "PDX-2026-0010"]),
])
def test_recherche_et_filtres(cabinet, filtres, attendues):
    p = page(cabinet["rabe"], limite=50, **filtres)
    assert refs(p) == attendues and p["total"] == len(attendues)


def test_filtre_par_deposant_et_liste_des_deposants(cabinet):
    miennes = page(cabinet["rabe"], deposant="moi", limite=50)
    assert miennes["total"] == 13 and all(e["deposant_id"] == str(cabinet["rabe_id"]) for e in miennes["elements"])
    autres = page(cabinet["rabe"], deposant=str(cabinet["autre_id"]), limite=50)
    assert autres["total"] == 12
    assert {d["id"] for d in miennes["deposants"]} == {str(cabinet["rabe_id"]), str(cabinet["autre_id"])}
    # Les filtres se cumulent avec la pagination par clé.
    p1 = page(cabinet["rabe"], deposant="moi", limite=5)
    p2 = page(cabinet["rabe"], deposant="moi", limite=5, apres=p1["suivant"])
    assert not set(refs(p1)) & set(refs(p2)) and len(refs(p2)) == 5


def test_filtres_invalides_refuses(cabinet):
    for params in ({"etat": "perdu"}, {"tri": "alpha"}, {"deposant": "pas-un-uuid"}, {"types": ["tooth"]}, {"apres": "%%%"}):
        r = cabinet["rabe"].get(f"{BASE}/historique", params=params)
        assert r.status_code == 422, params


def test_le_lecteur_consulte_l_historique(cabinet, connecte, confier, db):
    """Le lecteur ne voit dans l'historique que les analyses qui lui sont confiées."""
    lecteur = connecte("lecteur.histo@cabinet.example.org", "Lecteur")
    assert page(lecteur)["total"] == 0
    for ref in ("PDX-2026-0002", "PDX-2026-0007"):
        confier(db.scalar(select(Analysis.id).where(Analysis.reference == ref)), "lecteur.histo@cabinet.example.org")
    p = page(lecteur)
    assert p["total"] == 2 and sorted(refs(p)) == ["PDX-2026-0002", "PDX-2026-0007"]
    # Les déposants proposés au filtre : ceux des analyses visibles seulement.
    assert {d["id"] for d in p["deposants"]} == {str(cabinet["rabe_id"]), str(cabinet["autre_id"])}


def test_export_csv_filtre_et_journalise(cabinet, db):
    r = cabinet["rabe"].get(f"{BASE}/historique.csv", params={"etat": "closed"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"].startswith('attachment; filename="historique-analyses-')
    texte = r.content.decode("utf-8")
    assert texte.startswith("﻿N°;Référence;")
    lignes = texte.strip("﻿").strip().split("\r\n")
    assert len(lignes) == 3 and lignes[1].split(";")[:2] == ["7", "PDX-2026-0007"]
    assert lignes[1].split(";")[4] == "Clôturée"
    entree = db.scalars(select(Journal).where(Journal.action == "export_historique")).one()
    assert entree.details == {"lignes": 2, "filtres": {"etat": "closed", "tri": "recent"}}


def test_fiche_d_une_analyse_lue_dans_le_journal_et_les_verdicts(connecte, objets, session_factory, db):
    praticien = connecte(RABE)
    a = _envoyer(praticien, octets(Image.new("L", (3600, 1800), 60))).json()
    assert worker.traiter_une(session_factory)
    analyse = db.get(Analysis, a["id"])
    db.refresh(analyse)
    anomalie = next(d for d in analyse.detections if d.label != "tooth")
    url = f"{BASE}/analyses/{a['id']}"
    assert praticien.post(f"{url}/detections/{anomalie.id}/verdict", json={"action": "rejeter", "commentaire": "Artéfact"}).status_code == 200
    for d in analyse.detections:
        if d.label != "tooth" and d.id != anomalie.id:
            praticien.post(f"{url}/detections/{d.id}/verdict", json={"action": "valider"})
    assert praticien.post(f"{url}/cloturer", json={}).status_code == 200
    assert praticien.get(f"{url}/compte-rendu", params={"telecharger": "true", "image": "false"}).status_code == 200

    fiche = praticien.get(f"{url}/historique").json()
    actions = [e["action"] for e in fiche["evenements"]]
    assert actions[:2] == ["import_analyse", "analyse_traitee"]
    assert "verdict_rejeter" in actions and actions[-2:] == ["cloture_analyse", "compte_rendu_telecharge"]
    rejet = next(e for e in fiche["evenements"] if e["action"] == "verdict_rejeter")
    assert rejet["libelle"] == "Détection rejetée" and "« Artéfact »" in rejet["precision"] and rejet["auteur"]
    traitee = fiche["evenements"][1]
    assert traitee["libelle"] == "Analyse par le modèle terminée" and traitee["precision"].startswith("Modèle ")
    assert fiche["evenements"][-1]["precision"] == "avec commentaires"      # image=false, commentaires par défaut


def test_fiche_retrouve_un_import_journalise_avant_le_sprint_8(cabinet, db):
    """Ancien bogue : l'import était journalisé sous « analyse:None » ; la référence le rattache."""
    from app import journal

    journal.inscrire(db, "import_analyse", journal.SUCCES, cible="analyse:None", details={"reference": "PDX-2026-0009"})
    journal.inscrire(db, "import_analyse", journal.SUCCES, cible="analyse:None", details={"reference": "PDX-2026-0010"})
    neuf = db.scalar(select(Analysis.id).where(Analysis.reference == "PDX-2026-0009"))
    fiche = cabinet["rabe"].get(f"{BASE}/analyses/{neuf}/historique").json()
    assert [e["action"] for e in fiche["evenements"]] == ["import_analyse"]
