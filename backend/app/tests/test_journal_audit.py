"""Journal d'audit de l'administration : lecture du journal et des verdicts,
libellés, rattachement aux sessions, filtres, export."""
import ast
import pathlib

import pytest
from sqlalchemy import select

from app import journal
from app.auth_models import Journal
from app.models import Analysis, Detection, StatutAnalyse
from app.services import journal_audit as ja

from .conftest import BASE, connexion_mdp

URL = f"{BASE}/journal"


def actions_journalisees() -> set[str]:
    """Toutes les actions passées au journal par le code (analyse syntaxique)."""
    trouvees = set()
    for f in pathlib.Path(__file__).resolve().parents[1].rglob("*.py"):
        if "tests" in f.parts:
            continue
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.Call) and getattr(n.func, "attr", getattr(n.func, "id", "")) in ("inscrire", "_journaliser"):
                for a in n.args:
                    candidats = [a.body, a.orelse] if isinstance(a, ast.IfExp) else [a]
                    trouvees |= {c.value for c in candidats if isinstance(c, ast.Constant) and isinstance(c.value, str)
                                 and c.value.replace("_", "").isalpha() and c.value.islower()
                                 and c.value not in (journal.SUCCES, journal.REFUS, journal.ECHEC)}
            if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "action" for t in n.targets) \
                    and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
                trouvees.add(n.value.value)
    return trouvees


def test_chaque_action_journalisee_a_un_libelle_et_une_categorie():
    actions = actions_journalisees()
    assert {"connexion", "import_analyse", "compte_rendu_telecharge", "export_journal"} <= actions   # la recherche fonctionne
    sans_libelle = sorted(actions - set(ja.ACTIONS))
    assert not sans_libelle, f"Actions journalisées sans libellé dans services/journal_audit.py : {sans_libelle}"
    assert {cat for _, cat in ja.ACTIONS.values()} == set(ja.CATEGORIES)


@pytest.mark.parametrize("agent, attendu", [
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Chrome · Windows"),
    ("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Edge · Windows"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", "Safari · macOS"),
    ("Mozilla/5.0 (Linux; Android 14) Firefox/131.0", "Firefox · Android"),
    ("testclient", "Poste inconnu"),
    (None, "Poste inconnu"),
])
def test_poste_lisible(agent, attendu):
    assert ja.poste(agent) == attendu


def test_la_connexion_est_journalisee_avec_sa_session(client, compte_mdp, db):
    compte_mdp("dr.session@cabinet.example.org")
    assert connexion_mdp(client, "dr.session@cabinet.example.org").status_code == 200
    entree = db.scalars(select(Journal).where(Journal.action == "connexion")).all()[-1]
    assert entree.cible.startswith("session:")


def lire(client, **params):
    r = client.get(URL, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def groupe(journal_lu, nom_ou_titre):
    return next(g for g in journal_lu["sessions"]
                if g["utilisateur"]["nom"] == nom_ou_titre or g["titre"] == nom_ou_titre)


def test_actions_groupees_par_session_avec_etat_et_methode(admin, creer_compte, client, compte_mdp, nouveau_client):
    creer_compte("dr.audit@cabinet.example.org")
    compte_mdp("dr.mdp@cabinet.example.org", prenom="Hery", nom="Mdp")
    praticien = nouveau_client()
    assert connexion_mdp(praticien, "dr.mdp@cabinet.example.org").status_code == 200
    assert praticien.post(f"{BASE}/auth/deconnexion").status_code == 204

    lu = lire(admin)
    g_admin = next(g for g in lu["sessions"] if any(e["action"] == "creation_compte" for e in g["entrees"]))
    assert g_admin["id"].startswith("session:") and g_admin["etat"] == "active"
    assert [e["action"] for e in g_admin["entrees"]][:2] == ["connexion", "creation_compte"]   # chronologique
    creation = next(e for e in g_admin["entrees"] if e["action"] == "creation_compte")
    assert creation["libelle"] == "Création d’un compte" and creation["cible"].startswith("Compte ")

    g_prat = groupe(lu, "Hery Mdp")
    assert g_prat["etat"] == "closed" and g_prat["methode"] == "mot_de_passe"
    assert [e["action"] for e in g_prat["entrees"]] == ["connexion", "deconnexion"]
    assert g_prat["entrees"][0]["precision"] == "Par e-mail et mot de passe"


def test_a_horodatage_egal_la_connexion_ouvre_la_session(admin, creer_compte, db):
    """Horloge grossière : la connexion et l'action qui suit peuvent porter la
    même date. La connexion reste en tête de sa session."""
    creer_compte("dr.egal@cabinet.example.org")
    lignes = db.scalars(select(Journal).where(Journal.action.in_(("connexion", "creation_compte")))).all()
    date = max(l.horodatage for l in lignes)
    for l in lignes:
        l.horodatage = date
    db.commit()
    g = next(g for g in lire(admin)["sessions"] if any(e["action"] == "creation_compte" for e in g["entrees"]))
    assert [e["action"] for e in g["entrees"]][:2] == ["connexion", "creation_compte"]


def test_connexion_refusee_dans_les_tentatives_et_filtre_des_echecs(admin, compte_mdp, nouveau_client):
    compte_mdp("dr.oubli@cabinet.example.org", prenom="Fara", nom="Oubli")
    assert connexion_mdp(nouveau_client(), "dr.oubli@cabinet.example.org", "mauvais mot de passe").status_code == 401
    echecs = lire(admin, resultat="echec")
    assert echecs["total"] >= 1 and all(not e["ok"] for g in echecs["sessions"] for e in g["entrees"])
    tentatives = groupe(echecs, "Fara Oubli")
    assert tentatives["id"].startswith("tentatives:") and tentatives["titre"] == "Tentatives de connexion"
    assert tentatives["etat"] == "none"
    refus = tentatives["entrees"][-1]
    assert refus["precision"] == "Par e-mail et mot de passe · mot de passe incorrect"   # motif traduit


def test_verdicts_traitements_et_filtres_par_categorie_et_auteur(admin, connecte, db):
    a = Analysis(reference="PDX-2026-0500", image_key="images/j.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="v1", inference_mode="real")
    carie = Detection(label="caries", fdi=36, confidence=0.8, x=0.1, y=0.1, w=0.1, h=0.1, model_version="v1")
    a.detections = [carie]
    db.add(a)
    db.commit()
    journal.inscrire(db, "analyse_traitee", journal.SUCCES, cible=f"analyse:{a.id}",
                     details={"modele": "v1", "detections": 1})
    praticien = connecte("dr.verdict@cabinet.example.org")
    r = praticien.post(f"{BASE}/analyses/{a.id}/detections/{carie.id}/verdict", json={"action": "rejeter", "commentaire": "Artéfact"})
    assert r.status_code == 200, r.text

    relecture = lire(admin, categorie="Relecture")
    verdict = next(e for g in relecture["sessions"] for e in g["entrees"] if e["action"] == "verdict_rejeter")
    assert verdict["cible"] == "Analyse PDX-2026-0500" and verdict["precision"] == "carie, dent 36 — « Artéfact »"
    assert all(e["categorie"] == "Relecture" for g in relecture["sessions"] for e in g["entrees"])

    plateforme = groupe(lire(admin, categorie="Analyses"), "Traitements de la plateforme")
    assert plateforme["entrees"][0]["precision"] == "Modèle v1 · 1 détections"

    praticien_id = next(x["id"] for x in lire(admin)["auteurs"] if x["nom"] == "dr.verdict@cabinet.example.org")
    les_siens = lire(admin, auteur=praticien_id)
    assert {g["utilisateur"]["id"] for g in les_siens["sessions"]} == {praticien_id}


def test_reserve_a_la_gestion_des_comptes_et_filtres_valides(admin, connecte):
    assert connecte("dr.curieux@cabinet.example.org").get(URL).status_code == 403
    for params in ({"categorie": "Inconnue"}, {"resultat": "peut-etre"}, {"auteur": "x"}, {"jours": 0}, {"jours": 400}):
        assert admin.get(URL, params=params).status_code == 422, params


def test_export_csv_journalise(admin, db):
    r = admin.get(f"{URL}.csv", params={"jours": 30})
    assert r.status_code == 200 and r.headers["content-disposition"].startswith('attachment; filename="journal-audit-')
    texte = r.content.decode("utf-8")
    assert texte.startswith("﻿Date (UTC);Auteur;Action;Catégorie;")
    assert "Connexion" in texte
    entree = db.scalars(select(Journal).where(Journal.action == "export_journal")).one()
    assert entree.details["jours"] == 30 and entree.details["lignes"] >= 1
    # L'export lui-même apparaît ensuite dans le journal, avec son libellé.
    assert any(e["libelle"] == "Export du journal d’audit (CSV)" for g in lire(admin)["sessions"] for e in g["entrees"])


def test_motifs_de_refus_traduits():
    assert ja.motif_lisible("adresse_inconnue adresse=x@y.org") == "adresse inconnue"
    assert ja.motif_lisible("lien_expire") == "lien expiré"
    assert ja.motif_lisible("motif_nouveau") == "motif nouveau"
