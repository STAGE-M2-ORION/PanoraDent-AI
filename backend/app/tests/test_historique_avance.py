"""Historique avancé (sprint 12, lot A) : recherche sur la note et la
conclusion, filtres par dent et par compte rendu, tri multi-colonnes avec
pagination par clé, vues enregistrées."""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app import journal
from app.auth_models import Utilisateur
from app.models import Analysis, Detection, EtatDetection, StatutAnalyse, Verdict, VueHistorique
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE

from .conftest import BASE

URL = f"{BASE}/historique"
VUES = f"{BASE}/moi/vues-historique"
T0 = datetime(2026, 11, 1, 9, 0)


def _analyse(db, ref, jours=0, statut=StatutAnalyse.TERMINEE, examen=None, note="", conclusion="", detections=()):
    a = Analysis(reference=ref, image_key="k", width=1, height=1, statut=statut, created_at=T0 + timedelta(days=jours),
                 date_examen=examen, note=note, conclusion=conclusion)
    a.detections = list(detections)
    db.add(a)
    db.flush()
    return a


def _det(label, fdi, etat=EtatDetection.VALIDEE, dent=None):
    return Detection(label=label, fdi=fdi, confidence=0.8, x=0.1, y=0.1, w=0.1, h=0.1, etat=etat, dent=dent)


def _refs(client, **params):
    r = client.get(URL, params={"limite": 100, **params})
    assert r.status_code == 200, r.text
    return [e["reference"] for e in r.json()["elements"]]


@pytest.fixture()
def jeu(db):
    """Cinq analyses aux statuts, dates, textes et anomalies variés."""
    a1 = _analyse(db, "PDX-2026-0101", 0, examen=date(2026, 10, 3), note="contrôle orthodontique",
                  detections=[_det("caries", 36)])
    dent17 = _det("tooth", 17)
    a2 = _analyse(db, "PDX-2026-0102", 1, examen=date(2026, 10, 1), conclusion="Lésion péri-apicale à surveiller",
                  detections=[dent17, _det("periapical_lesion", None, dent=dent17)])
    a3 = _analyse(db, "PDX-2026-0103", 2, statut=StatutAnalyse.EN_FILE)
    carie = _det("caries", 26)
    a4 = _analyse(db, "PDX-2026-0104", 3, examen=date(2026, 10, 2), detections=[carie, _det("deep_caries", 36, etat=EtatDetection.REJETEE)])
    db.flush()
    db.add(Verdict(detection_id=carie.id, numero=1, action="corriger", label="caries", fdi=46, x=0.1, y=0.1, w=0.1, h=0.1))
    a5 = _analyse(db, "PDX-2026-0105", 4, statut=StatutAnalyse.ECHOUEE)
    journal.inscrire(db, "compte_rendu_telecharge", journal.SUCCES, cible=f"analyse:{a1.id}", commit=False)
    db.commit()
    return a1, a2, a3, a4, a5


# --- Recherche et filtres ---------------------------------------------------------------------

def test_recherche_sur_la_reference_la_note_et_la_conclusion(admin, jeu):
    assert _refs(admin, q="0103") == ["PDX-2026-0103"]
    assert _refs(admin, q="orthodontique") == ["PDX-2026-0101"]
    assert _refs(admin, q="péri-apicale") == ["PDX-2026-0102"]


def test_filtre_par_dent_propose_retenu_ou_dent_hote(admin, jeu):
    assert _refs(admin, dent=36) == ["PDX-2026-0101"]          # la carie profonde rejetée de 0104 ne compte pas
    assert _refs(admin, dent=46) == ["PDX-2026-0104"]          # numéro corrigé par un verdict
    assert _refs(admin, dent=17) == ["PDX-2026-0102"]          # lésion rattachée à la dent 17
    r = admin.get(URL, params={"dent": 19})
    assert (r.status_code, r.json()["code"]) == (422, "filtre_invalide")


def test_filtre_par_compte_rendu(admin, jeu):
    assert _refs(admin, compte_rendu="telecharge") == ["PDX-2026-0101"]
    assert "PDX-2026-0101" not in _refs(admin, compte_rendu="non_telecharge")
    assert admin.get(URL, params={"compte_rendu": "peut-etre"}).status_code == 422


def test_filtres_combines(admin, jeu):
    assert _refs(admin, types="caries", dent=46, etat="inprogress") == ["PDX-2026-0104"]
    assert _refs(admin, types="caries", du="2026-11-01", au="2026-11-01") == ["PDX-2026-0101"]


def test_memes_resultats_pour_le_lecteur_et_le_praticien(admin, connecte, jeu):
    for role in (VIEWER_ROLE, PRACTITIONER_ROLE):
        c = connecte(f"{role.lower()}.recherche@cabinet.example.org", role)
        assert _refs(c, q="orthodontique", dent=36) == ["PDX-2026-0101"]


# --- Tri multi-colonnes et pagination par clé ------------------------------------------------

@pytest.mark.parametrize("tri, attendu", [
    ("-date", ["0105", "0104", "0103", "0102", "0101"]),
    ("recent", ["0105", "0104", "0103", "0102", "0101"]),
    ("ancien", ["0101", "0102", "0103", "0104", "0105"]),
    ("reference", ["0101", "0102", "0103", "0104", "0105"]),
    # État dans l'ordre du traitement (en file, terminée, échouée), puis date d'examen
    # décroissante (sans date d'examen en dernier), puis date d'import.
    ("statut,-examen,date", ["0103", "0101", "0104", "0102", "0105"]),
])
def test_tri_multi_colonnes(admin, jeu, tri, attendu):
    assert _refs(admin, tri=tri) == [f"PDX-2026-{n}" for n in attendu]


@pytest.mark.parametrize("tri", ["-date", "statut,-examen,date", "-statut,reference"])
def test_pagination_par_cle_suit_le_tri(admin, jeu, db, tri):
    # Davantage de lignes, avec des égalités sur chaque colonne de tri.
    for i in range(7):
        _analyse(db, f"PDX-2026-02{i:02d}", 2, statut=StatutAnalyse.TERMINEE if i % 2 else StatutAnalyse.EN_FILE)
    db.commit()
    complet = _refs(admin, tri=tri)
    vus, apres = [], ""
    while True:
        r = admin.get(URL, params={"tri": tri, "limite": 3, **({"apres": apres} if apres else {})}).json()
        vus += [e["reference"] for e in r["elements"]]
        apres = r["suivant"]
        if not apres:
            break
    assert vus == complet and len(set(vus)) == len(vus) == 12


@pytest.mark.parametrize("tri", ["prix", "date,date", "date,reference,statut,examen"])
def test_tri_invalide(admin, tri):
    assert admin.get(URL, params={"tri": tri}).status_code == 422


def test_export_csv_suit_les_filtres_et_le_tri(admin, jeu):
    lignes = admin.get(f"{URL}.csv", params={"types": "caries", "tri": "reference"}).content.decode("utf-8-sig").strip().split("\r\n")
    assert [l.split(";")[1] for l in lignes[1:]] == ["PDX-2026-0101", "PDX-2026-0104"]


# --- Vues enregistrées ------------------------------------------------------------------------

def test_vues_enregistrees_propres_a_leur_auteur(admin, connecte, jeu, db):
    filtres = {"q": "", "types": ["caries"], "dent": 46, "tri": "statut,-date"}
    r = admin.post(VUES, json={"nom": "  Caries de la 46 ", "filtres": filtres})
    assert r.status_code == 201
    vue = r.json()
    assert vue["nom"] == "Caries de la 46" and vue["filtres"] == {"types": ["caries"], "dent": 46, "tri": "statut,-date"}
    assert [v["nom"] for v in admin.get(VUES).json()] == ["Caries de la 46"]
    # La vue rejouée donne la sélection voulue.
    assert _refs(admin, **{k: v for k, v in vue["filtres"].items()}) == ["PDX-2026-0104"]

    # Un autre compte ne la voit pas et ne peut pas la supprimer.
    lecteur = connecte("lecteur.vues@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.get(VUES).json() == []
    assert lecteur.delete(f"{VUES}/{vue['id']}").status_code == 404
    assert lecteur.post(VUES, json={"nom": "Mes clôturées", "filtres": {"etat": "closed"}}).status_code == 201

    # Même nom : mise à jour plutôt que doublon ; suppression par son auteur.
    assert admin.post(VUES, json={"nom": "Caries de la 46", "filtres": {"dent": 36}}).json()["filtres"] == {"dent": 36}
    assert db.query(VueHistorique).count() == 2
    assert admin.delete(f"{VUES}/{vue['id']}").status_code == 204
    assert admin.get(VUES).json() == []


@pytest.mark.parametrize("filtres", [{"inconnu": 1}, {"etat": "perdu"}, {"dent": 99}, {"tri": "prix"},
                                     {"types": ["tooth"]}, {"du": "pas une date"}, {"periode": "hier"}])
def test_vue_aux_filtres_invalides_refusee(admin, filtres):
    r = admin.post(VUES, json={"nom": "Vue", "filtres": filtres})
    assert (r.status_code, r.json()["code"]) == (422, "filtre_invalide")


def test_vue_a_periode_relative(admin):
    """« 7 derniers jours » reste relatif : la vue ne fige pas de dates."""
    r = admin.post(VUES, json={"nom": "Semaine", "filtres": {"periode": "7", "deposant": "moi"}})
    assert r.status_code == 201 and r.json()["filtres"] == {"periode": "7", "deposant": "moi"}


def test_nombre_de_vues_borne(admin):
    for i in range(20):
        assert admin.post(VUES, json={"nom": f"Vue {i}", "filtres": {}}).status_code == 201
    r = admin.post(VUES, json={"nom": "Vue 21", "filtres": {}})
    assert (r.status_code, r.json()["code"]) == (409, "trop_de_vues")


def test_vues_supprimees_avec_le_compte(admin, db):
    admin.post(VUES, json={"nom": "Vue", "filtres": {}})
    u = db.scalars(select(Utilisateur).where(Utilisateur.email == "admin@cabinet.example.org")).one()
    assert db.query(VueHistorique).filter(VueHistorique.utilisateur_id == u.id).count() == 1
