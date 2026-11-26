"""Journal d'audit, consultation (sprint 11, lot C) : filtres par action et par
cible, détail d'une entrée, pagination par clé ; et le journal en écriture
seule — aucune route, aucun code ne modifie ni ne supprime une entrée."""
import pathlib
import re
from datetime import datetime, timedelta, timezone

from fastapi.routing import APIRoute
from sqlalchemy import select

from app import journal
from app.auth_models import Journal, Utilisateur
from app.main import app
from app.models import Analysis, Detection, StatutAnalyse, Verdict
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import journal_audit as ja

from .conftest import BASE

URL = f"{BASE}/journal"


def _analyse_avec_verdict(db, admin_id) -> Analysis:
    a = Analysis(reference="PDX-2026-1400", image_key="k", width=10, height=10, statut=StatutAnalyse.TERMINEE,
                 model_version="v1")
    carie = Detection(label="caries", fdi=36, confidence=0.8, x=0.1, y=0.1, w=0.1, h=0.1, model_version="v1")
    a.detections = [carie]
    db.add(a)
    db.flush()
    db.add(Verdict(detection_id=carie.id, numero=1, action="rejeter", label="caries", fdi=36, x=0.1, y=0.1, w=0.1, h=0.1,
                   commentaire="artefact", auteur_id=admin_id))
    journal.inscrire(db, "analyse_traitee", journal.SUCCES, cible=f"analyse:{a.id}",
                     details={"modele": "v1", "detections": 1, "reference": a.reference}, commit=False)
    db.commit()
    return a


def _entrees(corps):
    return [e for g in corps["sessions"] for e in g["entrees"]]


def _admin_id(db):
    return db.scalars(select(Utilisateur)).first().id


# --- Filtres --------------------------------------------------------------------------

def test_filtre_par_action(admin, creer_compte):
    creer_compte("dr.action@cabinet.example.org")
    corps = admin.get(URL, params={"action": "creation_compte"}).json()
    assert {e["action"] for e in _entrees(corps)} == {"creation_compte"}
    assert {"code": "creation_compte", "libelle": "Création d’un compte", "categorie": "Comptes et rôles"} in corps["actions"]


def test_filtre_par_action_de_verdict(admin, db):
    _analyse_avec_verdict(db, _admin_id(db))
    entrees = _entrees(admin.get(URL, params={"action": "verdict_rejeter"}).json())
    assert [(e["action"], e["cible"]) for e in entrees] == [("verdict_rejeter", "Analyse PDX-2026-1400")]


def test_filtre_par_cible(admin, db, creer_compte):
    _analyse_avec_verdict(db, _admin_id(db))
    creer_compte("dr.cible@cabinet.example.org")
    entrees = _entrees(admin.get(URL, params={"cible": "pdx-2026-1400"}).json())
    assert {e["action"] for e in entrees} == {"analyse_traitee", "verdict_rejeter"}
    assert all("PDX-2026-1400" in e["cible"] for e in entrees)


def test_filtres_invalides(admin):
    assert admin.get(URL, params={"action": "effacer_tout"}).status_code == 422
    assert admin.get(URL, params={"avant": "pas une date|x"}).status_code == 422


# --- Pagination par clé ------------------------------------------------------------------

def test_pagination_par_cle_sans_doublon_ni_trou(db):
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    for i in range(23):
        db.add(Journal(action="export_journal", resultat=journal.SUCCES, details={"lignes": i},
                       horodatage=base + timedelta(seconds=i // 2)))   # dates en double : la clé départage
    db.commit()
    depuis = (base - timedelta(days=1)).replace(tzinfo=None)
    pages, curseur = [], None
    while True:
        lu = ja.lire(db, depuis=depuis, action="export_journal", avant=curseur, limite=5)
        pages.append(sorted(((e["date"], e["id"]) for g in lu["sessions"] for e in g["entrees"]), reverse=True))
        curseur = lu["suivant"]
        if curseur is None:
            break
    vus = [cle for page in pages for cle in page]
    assert [len(p) for p in pages] == [5, 5, 5, 5, 3]                # pas de page vide de trop
    assert len(set(vus)) == 23                                       # tout, une seule fois
    # Chaque page est entièrement plus récente que la suivante.
    assert all(min(a) > max(b) for a, b in zip(pages, pages[1:]))


def test_page_suivante_par_la_route(admin, creer_compte):
    for i in range(3):
        creer_compte(f"dr.page{i}@cabinet.example.org")
    complet = admin.get(URL, params={"action": "creation_compte"}).json()
    assert complet["suivant"] is None and len(_entrees(complet)) == 3
    (plus_ancienne,) = [e for e in _entrees(complet) if e["date"] == min(x["date"] for x in _entrees(complet))]
    curseur = f"{plus_ancienne['date']}|{plus_ancienne['id']}"
    assert _entrees(admin.get(URL, params={"action": "creation_compte", "avant": curseur}).json()) == []


# --- Détail d'une entrée -----------------------------------------------------------------

def test_detail_d_une_entree_du_journal(admin, db):
    a = _analyse_avec_verdict(db, _admin_id(db))
    (traitee,) = [e for e in _entrees(admin.get(URL, params={"action": "analyse_traitee"}).json())]
    d = admin.get(f"{URL}/entrees/{traitee['id']}").json()
    assert d["source"] == "journal" and d["libelle"] == "Analyse par le modèle terminée"
    assert d["cible"] == "Analyse PDX-2026-1400" and d["cible_brute"] == f"analyse:{a.id}"
    assert d["details"] == {"modele": "v1", "detections": 1, "reference": "PDX-2026-1400"}


def test_detail_d_une_connexion_avec_sa_session(admin):
    (connexion,) = [e for e in _entrees(admin.get(URL, params={"action": "connexion"}).json())][:1]
    d = admin.get(f"{URL}/entrees/{connexion['id']}").json()
    assert d["auteur"]["email"] == "admin@cabinet.example.org"
    assert d["session"]["poste"] == "Poste inconnu" and d["session"]["ouverte_le"]
    assert "mot_de_passe" not in str(d["details"]) and "jeton" not in str(d["details"])


def test_detail_d_un_verdict(admin, db):
    _analyse_avec_verdict(db, _admin_id(db))
    (v,) = _entrees(admin.get(URL, params={"action": "verdict_rejeter"}).json())
    d = admin.get(f"{URL}/entrees/{v['id']}").json()
    assert (d["source"], d["precision"]) == ("verdict", "carie, dent 36")
    assert d["details"]["commentaire"] == "artefact" and d["details"]["cadre"] == {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1}


def test_detail_introuvable_ou_refuse(admin, connecte):
    assert admin.get(f"{URL}/entrees/j:00000000-0000-0000-0000-000000000000").status_code == 404
    assert admin.get(f"{URL}/entrees/n'importe-quoi").status_code == 404
    for role in (PRACTITIONER_ROLE, VIEWER_ROLE):
        c = connecte(f"{role.lower()}.detail@cabinet.example.org", role)
        assert c.get(f"{URL}/entrees/j:00000000-0000-0000-0000-000000000000").status_code == 403


# --- Écriture seule ---------------------------------------------------------------------

def test_aucune_route_ne_modifie_ni_ne_supprime_une_entree():
    ecritures = sorted((m, r.path) for r in app.routes if isinstance(r, APIRoute) and "/journal" in r.path
                       for m in r.methods if m in {"POST", "PUT", "PATCH", "DELETE"})
    assert ecritures == [], f"Route d'écriture sur le journal : {ecritures}"


# Seul endroit où des entrées peuvent disparaître : la purge par rétention (lot D),
# bornée et elle-même journalisée.
PURGE_AUTORISEE: set[str] = set()


def test_aucun_code_ne_modifie_ni_ne_supprime_une_entree():
    racine = pathlib.Path(__file__).resolve().parents[1]
    motif = re.compile(r"(delete|update)\(\s*Journal\b|query\(\s*Journal\s*\)[^\n]*\.(delete|update)\(")
    fautifs = []
    for fichier in racine.rglob("*.py"):
        relatif = fichier.relative_to(racine).as_posix()
        if relatif.startswith("tests/") or relatif in PURGE_AUTORISEE:
            continue
        if motif.search(fichier.read_text(encoding="utf-8")):
            fautifs.append(relatif)
    assert not fautifs, f"Code qui modifie ou supprime des entrées du journal : {fautifs}"
