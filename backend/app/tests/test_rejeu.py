"""Sprint 6, lot B — rejouer une ancienne analyse avec le modèle courant, comparer."""
from datetime import datetime

from sqlalchemy import select

from app import worker
from app.auth_models import Journal
from app.models import Analysis
from app.permissions import VIEWER_ROLE
from app.services.comparaison import comparer

from .conftest import BASE
from .test_analyses import objets  # noqa: F401
from .test_file_traitement import _analyse, _importer, modele, reponse  # noqa: F401
from .test_registre_modeles import activer, publier, service  # noqa: F401


def code(r):
    return r.json().get("code")


def analyse_terminee(rabe, db, modele, session_factory, cloturee=True):
    """Analyse faite avec v1, puis v2 devient active."""
    a = _importer(rabe)
    modele["reponse"] = reponse(version="v1")
    worker.traiter_une(session_factory)
    if cloturee:
        _analyse(db, a["id"]).cloturee_le = datetime.utcnow()
        db.commit()
    return a


def test_rejeu_nouvelle_analyse_liee_origine_intacte(
        admin, connecte, db, objets, modele, service, session_factory):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = analyse_terminee(rabe, db, modele, session_factory)
    avant = [(d.id, d.label, d.x) for d in _analyse(db, a["id"]).detections]
    assert activer(admin, "v2").status_code == 200

    r = rabe.post(f"{BASE}/analyses/{a['id']}/rejouer")
    assert r.status_code == 201, r.text
    rejeu = r.json()
    assert rejeu["origine_id"] == a["id"] and rejeu["version_demandee"] == "v2"
    assert rejeu["statut"] == "en_file" and rejeu["reference"] != a["reference"]

    origine = _analyse(db, a["id"])
    assert [(d.id, d.label, d.x) for d in origine.detections] == avant     # rien n'a bougé
    assert origine.cloturee and origine.model_version == "v1"
    copie = _analyse(db, rejeu["id"])
    assert copie.image_key != origine.image_key                            # copie propre
    assert objets[copie.image_key] == objets[origine.image_key]
    assert db.scalar(select(Journal).where(Journal.action == "rejeu_analyse")) is not None

    # Supprimer l'origine ne vide pas le rejeu.
    assert rabe.delete(f"{BASE}/analyses/{a['id']}").status_code == 204
    assert copie.image_key in objets
    db.expire_all()
    assert db.get(Analysis, rejeu["id"]).origine_id is None


def test_rejeu_refuse(admin, connecte, db, objets, modele, service, session_factory):
    rabe = connecte("dr.rabe@cabinet.example.org")
    publier(db, "v1", actif=True)
    a = analyse_terminee(rabe, db, modele, session_factory)
    assert code(rabe.post(f"{BASE}/analyses/{a['id']}/rejouer")) == "meme_modele"

    en_file = _importer(rabe)
    assert code(rabe.post(f"{BASE}/analyses/{en_file['id']}/rejouer")) == "non_terminee"

    lecteur = connecte("lecteur@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.post(f"{BASE}/analyses/{a['id']}/rejouer").status_code == 403


def test_rejeu_sans_modele_actif(connecte, db, objets, modele, session_factory):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = analyse_terminee(rabe, db, modele, session_factory)
    assert code(rabe.post(f"{BASE}/analyses/{a['id']}/rejouer")) == "aucun_modele_actif"


def test_comparaison_des_deux_modeles(admin, connecte, db, objets, modele, service, session_factory):
    publier(db, "v1", actif=True)
    publier(db, "v2")
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = analyse_terminee(rabe, db, modele, session_factory)
    activer(admin, "v2")
    rejeu = rabe.post(f"{BASE}/analyses/{a['id']}/rejouer").json()

    attente = rabe.get(f"{BASE}/analyses/{rejeu['id']}/comparaison").json()
    assert attente["par_classe"] is None and attente["rejeu"]["statut"] == "en_file"

    # v2 voit la même dent, garde une carie, en manque une autre et en trouve une nouvelle.
    modele["reponse"] = reponse(version="v2", detections=[
        {"label": "tooth", "fdi": 36, "confidence": 0.95, "bbox": [400, 300, 100, 200]},
        {"label": "caries", "fdi": 36, "confidence": 0.60, "bbox": [420, 320, 40, 40]},
        {"label": "periapical_lesion", "fdi": 46, "confidence": 0.50, "bbox": [600, 700, 50, 50]},
        {"label": "tooth", "fdi": 18, "confidence": 0.9, "bbox": [1950, 950, 100, 100]},
    ])
    worker.traiter_une(session_factory)
    c = rabe.get(f"{BASE}/analyses/{rejeu['id']}/comparaison?seuil=0.1").json()
    assert c["origine"]["model_version"] == "v1" and c["rejeu"]["model_version"] == "v2"
    pc = c["par_classe"]
    assert pc["tooth"] == {"origine": 2, "rejeu": 2, "communes": 2, "seulement_origine": 0, "seulement_rejeu": 0}
    assert pc["caries"] == {"origine": 2, "rejeu": 1, "communes": 1, "seulement_origine": 1, "seulement_rejeu": 0}
    assert pc["periapical_lesion"]["seulement_rejeu"] == 1
    # Une analyse qui n'est pas un rejeu n'a pas de comparaison.
    assert code(rabe.get(f"{BASE}/analyses/{a['id']}/comparaison")) == "sans_origine"


def test_comparaison_classe_iou_seuil_un_seul_appariement():
    boite = (0.1, 0.1, 0.1, 0.1)
    origine = [("caries", boite, 0.9), ("caries", boite, 0.8), ("tooth", boite, 0.9),
               ("impacted_tooth", (0.5, 0.5, 0.1, 0.1), 0.2)]
    rejeu = [("caries", (0.1, 0.1, 0.1, 0.09), 0.7),      # recoupe une carie
             ("deep_caries", boite, 0.9),                  # même place, autre classe
             ("tooth", (0.17, 0.1, 0.1, 0.1), 0.9)]        # IoU 0,18 : pas la même dent
    r = comparer(origine, rejeu, seuil=0.25)
    assert r["caries"] == {"origine": 2, "rejeu": 1, "communes": 1, "seulement_origine": 1, "seulement_rejeu": 0}
    assert r["deep_caries"]["seulement_rejeu"] == 1
    assert r["tooth"]["communes"] == 0
    assert "impacted_tooth" not in r                       # sous le seuil des deux côtés
