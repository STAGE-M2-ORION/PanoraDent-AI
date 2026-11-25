"""Sprint 5 — relecture des détections et clôture de l'analyse."""
import io

import pytest
from fastapi.routing import APIRoute
from PIL import Image
from sqlalchemy import select

from app.auth_models import Journal, Utilisateur
from app.main import app
from app.models import Analysis, Detection, StatutAnalyse, Verdict
from app.permissions import VIEWER_ROLE
from app.routers import analyses as analyses_router

from .conftest import BASE

PRATICIEN = "dr.rabe@cabinet.example.org"
CONFRERE = "dr.soa@cabinet.example.org"


@pytest.fixture()
def analyse(db):
    """Analyse terminée : une dent (repère) et trois anomalies proposées par le modèle."""
    a = Analysis(reference="PDX-2026-0001", image_key="images/a.png", width=2000, height=1000,
                 statut=StatutAnalyse.TERMINEE, model_version="dentex-1.2", inference_mode="real")
    a.detections = [
        Detection(label="tooth", fdi=36, confidence=0.97, x=0.2, y=0.3, w=0.05, h=0.2, model_version="dentex-1.2"),
        Detection(label="caries", fdi=36, confidence=0.81, x=0.21, y=0.32, w=0.02, h=0.04, model_version="dentex-1.2"),
        Detection(label="deep_caries", fdi=37, confidence=0.55, x=0.3, y=0.32, w=0.02, h=0.04, model_version="dentex-1.2"),
        Detection(label="periapical_lesion", fdi=46, confidence=0.34, x=0.4, y=0.7, w=0.03, h=0.03, model_version="dentex-1.2"),
    ]
    db.add(a)
    db.commit()
    return {"id": a.id, "dent": a.detections[0].id, "carie": a.detections[1].id,
            "profonde": a.detections[2].id, "lesion": a.detections[3].id}


def _url(analyse, suite=""):
    return f"{BASE}/analyses/{analyse['id']}{suite}"


def _verdict(client, analyse, det, action, **champs):
    return client.post(_url(analyse, f"/detections/{analyse[det]}/verdict"), json={"action": action, **champs})


def _id(db, email):
    return db.scalar(select(Utilisateur.id).where(Utilisateur.email == email))


def _tout_statuer(client, analyse):
    for det in ("carie", "profonde", "lesion"):
        assert _verdict(client, analyse, det, "valider").status_code == 200


# --- Verdicts ------------------------------------------------------------------------------------

def test_les_quatre_verdicts_avec_leur_auteur_et_leur_date(connecte, analyse, db):
    praticien = connecte(PRATICIEN)
    r = _verdict(praticien, analyse, "carie", "valider", commentaire="Bien visible en distal")
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["etat"], d["commentaire"], d["revu_par_nom"]) == ("validee", "Bien visible en distal", PRATICIEN)
    assert d["revu_le"]

    assert _verdict(praticien, analyse, "profonde", "corriger", label="caries").json()["etat"] == "corrigee"
    assert _verdict(praticien, analyse, "lesion", "rejeter").json()["etat"] == "rejetee"

    r = praticien.post(_url(analyse, f"/detections/{analyse['lesion']}/annuler"))
    assert r.status_code == 200, r.text
    assert r.json()["detection"]["etat"] == "a_revoir"
    assert r.json()["detection"]["revu_le"] is None

    db.expire_all()
    verdicts = db.scalars(select(Verdict)).all()
    assert {v.action for v in verdicts} == {"valider", "corriger", "rejeter"}
    assert all(v.auteur_id == _id(db, PRATICIEN) and v.cree_le for v in verdicts)
    annule = next(v for v in verdicts if v.action == "rejeter")
    assert annule.annule_le and annule.annule_par_id == _id(db, PRATICIEN)
    # L'historique, annulation comprise, reste lisible.
    hist = praticien.get(_url(analyse)).json()["detections"][3]["verdicts"]
    assert [(v["action"], v["annule_le"] is not None) for v in hist] == [("rejeter", True)]


def test_annuler_revient_au_verdict_precedent(connecte, analyse):
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    _verdict(praticien, analyse, "carie", "rejeter")
    r = praticien.post(_url(analyse, f"/detections/{analyse['carie']}/annuler")).json()
    assert r["detection"]["etat"] == "validee"
    praticien.post(_url(analyse, f"/detections/{analyse['carie']}/annuler"))
    r = praticien.post(_url(analyse, f"/detections/{analyse['carie']}/annuler"))
    assert r.status_code == 409 and r.json()["code"] == "rien_a_annuler"


def test_une_correction_laisse_intacte_la_proposition_d_origine(connecte, analyse, db):
    praticien = connecte(PRATICIEN)
    r = _verdict(praticien, analyse, "profonde", "corriger", label="caries", fdi=36,
                 cadre={"x": 0.29, "y": 0.31, "w": 0.03, "h": 0.05})
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["label"], d["fdi"], d["x"], d["w"]) == ("caries", 36, 0.29, 0.03)          # retenu
    assert d["proposition"] == {"label": "deep_caries", "fdi": 37, "x": 0.3, "y": 0.32, "w": 0.02, "h": 0.04}
    assert d["confidence"] == 0.55 and d["source"] == "model"
    db.expire_all()
    origine = db.get(Detection, analyse["profonde"])
    assert (origine.label, origine.fdi, origine.x, origine.w) == ("deep_caries", 37, 0.3, 0.02)


def test_correction_vide_ou_valeurs_invalides_refusees(connecte, analyse):
    praticien = connecte(PRATICIEN)
    cas = [
        ({"action": "corriger"}, "correction_vide"),
        ({"action": "corriger", "label": "deep_caries", "fdi": 37}, "correction_vide"),
        ({"action": "corriger", "label": "fracture"}, "type_invalide"),
        ({"action": "corriger", "fdi": 19}, "dent_invalide"),
        ({"action": "corriger", "cadre": {"x": 0.9, "y": 0.1, "w": 0.2, "h": 0.1}}, "cadre_hors_image"),
        ({"action": "corriger", "cadre": {"x": 0.1, "y": 0.1, "w": 0.0001, "h": 0.1}}, "cadre_trop_petit"),
        ({"action": "supprimer"}, "action_invalide"),
    ]
    for corps, code in cas:
        r = praticien.post(_url(analyse, f"/detections/{analyse['profonde']}/verdict"), json=corps)
        assert r.status_code == 422 and r.json()["code"] == code, (corps, r.text)


def test_un_lecteur_ne_peut_pas_statuer(connecte, analyse):
    lecteur = connecte("lecteur@cabinet.example.org", VIEWER_ROLE)
    assert _verdict(lecteur, analyse, "carie", "valider").status_code == 403
    assert lecteur.get(_url(analyse)).status_code == 200


def test_un_confrere_peut_reprendre_la_relecture(connecte, analyse):
    """Tout praticien du cabinet relit ; chaque verdict garde son auteur."""
    praticien, confrere = connecte(PRATICIEN), connecte(CONFRERE)
    _verdict(praticien, analyse, "carie", "valider")
    assert _verdict(confrere, analyse, "profonde", "rejeter").status_code == 200
    noms = {d["id"]: d["revu_par_nom"] for d in confrere.get(_url(analyse)).json()["detections"]}
    assert noms[analyse["carie"]] == PRATICIEN and noms[analyse["profonde"]] == CONFRERE


# --- Ajout manuel --------------------------------------------------------------------------------

def test_ajout_du_praticien_origine_et_etat_valide(connecte, analyse, db):
    praticien = connecte(PRATICIEN)
    r = praticien.post(_url(analyse, "/detections"), json={
        "label": "impacted_tooth", "fdi": 48, "cadre": {"x": 0.8, "y": 0.6, "w": 0.06, "h": 0.1},
        "commentaire": "Non vue par le modèle"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert (d["source"], d["etat"], d["confidence"], d["model_version"]) == ("human", "validee", None, "")
    assert d["verdicts"][0]["action"] == "ajouter" and d["commentaire"] == "Non vue par le modèle"
    assert praticien.get(_url(analyse)).json()["avancement"] == {"revues": 1, "total": 4}

    # Annuler l'ajout le retire.
    r = praticien.post(_url(analyse, f"/detections/{d['id']}/annuler"))
    assert r.json() == {"detection": None, "retiree_id": d["id"]}
    db.expire_all()
    assert db.get(Detection, d["id"]) is None


def test_ajout_hors_image_refuse(connecte, analyse):
    praticien = connecte(PRATICIEN)
    r = praticien.post(_url(analyse, "/detections"), json={"label": "caries", "cadre": {"x": -0.2, "y": 0, "w": 0.1, "h": 0.1}})
    assert r.status_code == 422 and r.json()["code"] == "cadre_hors_image"


# --- Clôture ---------------------------------------------------------------------------------------

def test_cloture_refusee_tant_qu_une_detection_reste_a_revoir(connecte, analyse, db):
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    r = praticien.post(_url(analyse, "/cloturer"), json={})
    assert r.status_code == 409 and r.json()["code"] == "detections_a_revoir"
    assert r.json()["message"].startswith("2 détections sans verdict")
    assert r.json()["details"] == {"a_revoir": 2}

    _verdict(praticien, analyse, "profonde", "rejeter")
    r = praticien.post(_url(analyse, "/cloturer"), json={})
    assert r.json()["message"].startswith("1 détection sans verdict")

    # La dent (repère de numérotation) n'exige pas de verdict.
    _verdict(praticien, analyse, "lesion", "valider")
    r = praticien.post(_url(analyse, "/cloturer"), json={"conclusion": "Carie 36 à traiter ; contrôle à 6 mois."})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["cloturee"] and a["cloturee_par_nom"] == PRATICIEN and a["cloturee_le"]
    assert a["conclusion"] == "Carie 36 à traiter ; contrôle à 6 mois."
    assert db.scalar(select(Journal).where(Journal.action == "cloture_analyse")).cible == f"analyse:{analyse['id']}"
    resume = next(x for x in praticien.get(f"{BASE}/analyses").json() if x["id"] == analyse["id"])
    assert (resume["cloturee"], resume["a_revoir"]) == (True, 0)


def test_conclusion_enregistree_en_brouillon(connecte, analyse):
    praticien = connecte(PRATICIEN)
    r = praticien.put(_url(analyse, "/conclusion"), json={"conclusion": "  Brouillon  "})
    assert r.status_code == 200 and r.json()["conclusion"] == "Brouillon"
    assert praticien.put(_url(analyse, "/conclusion"), json={"conclusion": "x" * 4001}).status_code == 422


def test_relecture_reprise_apres_fermeture_du_navigateur(connecte, nouveau_client, analyse):
    """Les verdicts sont au serveur : une nouvelle session retrouve l'avancement."""
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    _verdict(praticien, analyse, "profonde", "corriger", fdi=36)
    praticien.close()
    from .conftest import connexion, erreur
    reprise = nouveau_client()
    assert erreur(connexion(reprise, PRATICIEN)) is None
    a = reprise.get(_url(analyse)).json()
    assert a["avancement"] == {"revues": 2, "total": 3}
    etats = {d["id"]: (d["etat"], d["fdi"]) for d in a["detections"]}
    assert etats[analyse["profonde"]] == ("corrigee", 36) and etats[analyse["lesion"]] == ("a_revoir", 46)


def test_analyse_non_terminee_rien_a_relire(connecte, analyse, db):
    a = db.get(Analysis, analyse["id"])
    a.statut = StatutAnalyse.EN_COURS
    db.commit()
    r = _verdict(connecte(PRATICIEN), analyse, "carie", "valider")
    assert r.status_code == 409 and r.json()["code"] == "analyse_non_terminee"


# --- Verrouillage après clôture ---------------------------------------------------------------------

# Routes d'écriture sur une analyse qui N'ONT PAS à être verrouillées par la clôture.
HORS_VERROU = {
    ("POST", "/api/v1/analyses/{analysis_id}/rouvrir"),    # c'est elle qui lève le verrou
    ("POST", "/api/v1/analyses/{analysis_id}/lancer"),     # seulement une analyse échouée, jamais clôturée
    ("POST", "/api/v1/analyses/{analysis_id}/rejouer"),    # crée une autre analyse ; l'origine n'est pas touchée
    ("DELETE", "/api/v1/analyses/{analysis_id}"),          # suppression : déposant ou administrateur
}

# Requête minimale valide pour chaque route verrouillée.
CORPS = {
    ("POST", "/api/v1/analyses/{analysis_id}/detections/{detection_id}/verdict"): {"action": "valider"},
    ("POST", "/api/v1/analyses/{analysis_id}/detections/{detection_id}/annuler"): None,
    ("POST", "/api/v1/analyses/{analysis_id}/detections"): {"label": "caries", "cadre": {"x": 0.1, "y": 0.1, "w": 0.05, "h": 0.05}},
    ("PUT", "/api/v1/analyses/{analysis_id}/conclusion"): {"conclusion": "modifiée"},
    ("POST", "/api/v1/analyses/{analysis_id}/cloturer"): {},
    ("POST", "/api/v1/analyses/{analysis_id}/dents/{fdi}/absente"): None,     # sprint 7
    ("DELETE", "/api/v1/analyses/{analysis_id}/dents/{fdi}/absente"): None,   # sprint 7
    ("POST", "/api/v1/analyses/{analysis_id}/conversation/messages"): {"question": "Une question ?"},  # sprint 10
    ("DELETE", "/api/v1/analyses/{analysis_id}/conversation"): None,                                   # sprint 10
}


def _routes_d_ecriture_sur_une_analyse():
    routes = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/v1/analyses/{analysis_id}"):
            routes |= {(m, route.path) for m in route.methods if m in {"POST", "PUT", "PATCH", "DELETE"}}
    return routes


def test_toute_route_d_ecriture_est_verrouillee_ou_exemptee_explicitement():
    """Une nouvelle route d'écriture doit être ajoutée à CORPS (et donc testée) ou à HORS_VERROU."""
    assert _routes_d_ecriture_sur_une_analyse() == set(CORPS) | HORS_VERROU


@pytest.mark.parametrize("methode, chemin", sorted(CORPS), ids=[f"{m} {c.rsplit('/', 1)[-1]}" for m, c in sorted(CORPS)])
def test_ecriture_refusee_sur_une_analyse_cloturee(connecte, analyse, methode, chemin):
    praticien = connecte(PRATICIEN)
    _tout_statuer(praticien, analyse)
    assert praticien.post(_url(analyse, "/cloturer"), json={}).status_code == 200
    url = chemin.replace("/api/v1", BASE).replace("{analysis_id}", analyse["id"]).replace("{detection_id}", analyse["carie"]).replace("{fdi}", "18")
    corps = CORPS[(methode, chemin)]
    r = praticien.request(methode, url, json=corps) if corps is not None else praticien.request(methode, url)
    assert r.status_code == 409 and r.json()["code"] == "analyse_cloturee", r.text


# --- Réouverture ---------------------------------------------------------------------------------

def test_reouverture_par_l_administrateur_journalisee_refusee_aux_autres(connecte, admin, analyse, db):
    praticien = connecte(PRATICIEN)
    _tout_statuer(praticien, analyse)
    praticien.post(_url(analyse, "/cloturer"), json={})

    r = praticien.post(_url(analyse, "/rouvrir"), json={"motif": "Erreur de dent"})
    assert r.status_code == 403
    r = admin.post(_url(analyse, "/rouvrir"), json={"motif": ""})
    assert r.status_code == 422 and r.json()["code"] == "motif_requis"

    r = admin.post(_url(analyse, "/rouvrir"), json={"motif": "Compléter la relecture de la 46"})
    assert r.status_code == 200, r.text
    assert r.json()["cloturee"] is False
    ligne = db.scalar(select(Journal).where(Journal.action == "reouverture_analyse"))
    assert ligne.details["motif"] == "Compléter la relecture de la 46" and ligne.cible == f"analyse:{analyse['id']}"
    # Rouverte : les verdicts redeviennent possibles ; les anciens sont conservés.
    assert _verdict(praticien, analyse, "lesion", "rejeter").status_code == 200
    assert admin.post(_url(analyse, "/rouvrir"), json={"motif": "encore une fois"}).json()["code"] == "analyse_non_cloturee"


# --- Compte rendu -----------------------------------------------------------------------------------

def test_compte_rendu_avec_les_valeurs_retenues_sans_les_rejets(connecte, analyse, monkeypatch):
    stock = {"images/a.png": io.BytesIO()}
    Image.new("L", (2000, 1000)).save(stock["images/a.png"], "PNG")
    s = analyses_router.storage
    monkeypatch.setattr(s, "get", lambda k: stock[k].getvalue())
    vu = {}
    from app.routers import compte_rendu as compte_rendu_router

    monkeypatch.setattr(compte_rendu_router.compte_rendu, "rendre",
                        lambda contenu, image, logo, genere_le: vu.setdefault("contenu", contenu) and b"%PDF")

    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    _verdict(praticien, analyse, "profonde", "corriger", label="caries", fdi=36)
    _verdict(praticien, analyse, "lesion", "rejeter")
    praticien.post(_url(analyse, "/detections"), json={"label": "impacted_tooth", "fdi": 48, "cadre": {"x": 0.8, "y": 0.6, "w": 0.05, "h": 0.1}})
    assert praticien.get(_url(analyse, "/compte-rendu"), params={"brouillon": "true"}).status_code == 200
    resume = sorted((d["label"], d["fdi"], d["confiance"]) for d in vu["contenu"]["retenues"])
    assert resume == [("caries", 36, 0.55), ("caries", 36, 0.81), ("impacted_tooth", 48, None)]


def test_correction_reconfirmee_pour_changer_son_commentaire(connecte, analyse):
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "profonde", "corriger", label="caries")
    r = _verdict(praticien, analyse, "profonde", "corriger", commentaire="Atteinte limitée à l'émail")
    assert r.status_code == 200, r.text
    assert (r.json()["etat"], r.json()["label"], r.json()["commentaire"]) == ("corrigee", "caries", "Atteinte limitée à l'émail")


def test_liste_avancement_de_la_relecture(connecte, analyse):
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    resume = next(x for x in praticien.get(f"{BASE}/analyses").json() if x["id"] == analyse["id"])
    assert (resume["revues"], resume["a_revoir"], resume["cloturee"]) == (1, 2, False)
