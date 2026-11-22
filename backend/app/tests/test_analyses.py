"""Sprint 3 — import anonymisé en deux temps, suppression, stockage."""
import io
import re

import numpy as np
import pytest
from PIL import Image, ImageDraw
from sqlalchemy import select

from app.auth_models import Journal
from app.models import Analysis
from app.routers import analyses as analyses_router
from app.routers import stockage as stockage_router

from .conftest import BASE
from .test_anonymize import TEXTE, boite_texte, octets, panoramique


@pytest.fixture()
def objets(monkeypatch):
    """Stockage objet simulé (dict clé → octets) et modèle factice."""
    stock: dict[str, bytes] = {}
    s = analyses_router.storage
    monkeypatch.setattr(s, "ensure_bucket", lambda: None)
    monkeypatch.setattr(s, "put", lambda k, d, c: stock.__setitem__(k, d))
    monkeypatch.setattr(s, "get", lambda k: stock[k])
    monkeypatch.setattr(s, "delete", lambda k: stock.pop(k, None))
    monkeypatch.setattr(s, "presigned_url", lambda k, expires=3600: f"http://s3/{k}")
    monkeypatch.setattr(stockage_router.storage, "usage", lambda prefixe="": (len(stock), sum(map(len, stock.values()))))

    from app.services import inference_client

    monkeypatch.setattr(inference_client, "infer_sync", lambda png, nom="image.png": {
        "mode": "mock", "model_version": "t-1", "detections": [
            {"label": "caries", "fdi": 36, "confidence": 0.9, "bbox": [10, 20, 30, 40]}]})
    return stock


def _envoyer(client, contenu, chemin="", nom="DUPONT_Jean_1961.png", **champs):
    return client.post(f"{BASE}/analyses{chemin}", files={"fichier": (nom, contenu, "application/octet-stream")}, data=champs)


def _image(stock, cle) -> np.ndarray:
    with Image.open(io.BytesIO(stock[cle])) as img:
        assert img.format == "PNG" and not img.getexif() and not img.info.get("exif")
        return np.asarray(img.convert("L"))


# --- Contrôle du fichier, à l'aperçu comme à la confirmation ------------------------------------

@pytest.mark.parametrize("chemin", ["/apercu", ""], ids=["apercu", "confirmation"])
def test_pdf_gros_fichier_et_petite_image_refuses_avec_leur_message(connecte, objets, chemin):
    praticien = connecte("dr.rabe@cabinet.example.org")
    cas = [
        (b"%PDF-1.7\n" + b"0" * 4000, 415, "format_non_pris_en_charge", "PNG, JPEG ou DICOM"),
        (b"\x89PNG\r\n\x1a\n" + b"0" * (50 * 1024 * 1024), 413, "fichier_trop_volumineux", "20 Mo"),
        (octets(Image.new("L", (400, 300))), 422, "image_trop_petite", "400 × 300"),
    ]
    for contenu, status, code, extrait in cas:
        r = _envoyer(praticien, contenu, chemin)
        assert r.status_code == status and r.json()["code"] == code, r.text
        assert extrait in r.json()["message"]
    assert objets == {}


# --- Aperçu : rien n'est stocké -----------------------------------------------------------------------

def test_apercu_avant_apres_sans_rien_stocker(connecte, objets, db):
    praticien = connecte("dr.rabe@cabinet.example.org")
    r = _envoyer(praticien, octets(panoramique()), "/apercu", masques='[{"x": 0.4, "y": 0.4, "w": 0.1, "h": 0.1}]')
    assert r.status_code == 200, r.text
    apercu = r.json()
    assert (apercu["largeur"], apercu["hauteur"]) == (2000, 1000)
    assert len(apercu["zones_auto"]) == 1 and apercu["zones_auto"][0]["y"] < 0.1
    assert apercu["zones_manuelles"] == [{"x": 0.4, "y": 0.4, "w": 0.1, "h": 0.1}]
    assert apercu["avant"].startswith("data:image/jpeg;base64,") and apercu["apres"] != apercu["avant"]
    # Import abandonné avant confirmation : aucun objet, aucune analyse.
    assert objets == {}
    assert db.scalars(select(Analysis)).all() == []


# --- Confirmation ----------------------------------------------------------------------------------------

def test_confirmation_stocke_la_seule_image_masquee(connecte, objets, db):
    praticien = connecte("dr.rabe@cabinet.example.org")
    exif = Image.Exif()
    exif[0x010E] = "Patient DUPONT Jean"
    brut = octets(panoramique().convert("RGB"), "JPEG", quality=95, exif=exif.tobytes())
    r = _envoyer(praticien, brut, masques='[{"x": 0.5, "y": 0.5, "w": 0.05, "h": 0.05}]',
                 date_examen="2026-11-18", note="Contrôle à 6 mois")
    assert r.status_code == 201, r.text
    a = r.json()
    assert re.fullmatch(r"PDX-\d{4}-0001", a["reference"])
    assert a["date_examen"] == "2026-11-18" and a["note"] == "Contrôle à 6 mois"
    assert a["deposant_nom"] and a["zones_masquees"] == {"auto": 1, "manuelles": 1}

    (cle,) = objets  # une seule image : pas de version d'affichage sous 3 000 px
    # Clé tirée au hasard : rien du nom du fichier (qui porte le nom du patient).
    assert re.fullmatch(r"images/[0-9a-f-]{36}\.png", cle)
    assert b"DUPONT" not in objets[cle]
    arr = _image(objets, cle)
    x0, y0, x1, y1 = boite_texte(TEXTE, (40, 30))
    assert arr[y0:y1, x0:x1].max() <= 20          # bandeau masqué dans l'objet stocké
    assert arr[500:550, 1000:1100].max() == 0     # masque manuel appliqué
    assert arr[420:600, 420:1500].max() >= 225    # dents intactes (JPEG : à quelques niveaux près)
    ligne = db.scalars(select(Journal).where(Journal.action == "import_analyse")).one()
    assert ligne.details["reference"] == a["reference"] and ligne.details["zones_auto"] == 1


def test_version_reduite_pour_l_affichage_au_dela_de_3000_px(connecte, objets):
    praticien = connecte("dr.rabe@cabinet.example.org")
    a = _envoyer(praticien, octets(Image.new("L", (3600, 1800), 60))).json()
    pleine = [k for k in objets if not k.endswith("_affichage.png")][0]
    affichage = [k for k in objets if k.endswith("_affichage.png")][0]
    with Image.open(io.BytesIO(objets[pleine])) as img:
        assert img.size == (3600, 1800)               # l'inférence garde la pleine résolution
    with Image.open(io.BytesIO(objets[affichage])) as img:
        assert img.size == (3000, 1500)
    url = praticien.get(f"{BASE}/analyses/{a['id']}/image").json()["url"]
    assert url.endswith("_affichage.png")
    assert praticien.get(f"{BASE}/analyses/{a['id']}/image", params={"taille": "pleine"}).json()["url"].endswith(pleine)


def test_references_successives_et_filtre_mes_analyses(connecte, objets):
    rabe = connecte("dr.rabe@cabinet.example.org")
    autre = connecte("dr.autre@cabinet.example.org")
    refs = [_envoyer(c, octets(panoramique())).json()["reference"] for c in (rabe, autre, rabe)]
    assert [r[-4:] for r in refs] == ["0001", "0002", "0003"]
    tout = rabe.get(f"{BASE}/analyses").json()
    assert [a["reference"] for a in tout] == refs[::-1]       # tout le cabinet, plus récentes d'abord
    miennes = rabe.get(f"{BASE}/analyses", params={"mine": "true"}).json()
    assert [a["reference"] for a in miennes] == [refs[2], refs[0]]
    assert all(a["deposant_nom"] for a in tout)


# --- Suppression ------------------------------------------------------------------------------------------

def test_suppression_reservee_au_deposant_et_a_l_administrateur(admin, connecte, objets, db, session_factory):
    rabe = connecte("dr.rabe@cabinet.example.org")
    autre = connecte("dr.autre@cabinet.example.org")
    a = _envoyer(rabe, octets(Image.new("L", (3600, 1800), 60))).json()
    from app import worker

    assert worker.traiter_une(session_factory)
    assert rabe.post(f"{BASE}/analyses/{a['id']}/report").status_code == 200
    assert len(objets) == 3                                   # image, affichage, compte rendu

    r = autre.delete(f"{BASE}/analyses/{a['id']}")
    assert r.status_code == 403 and "déposé" in r.json()["message"]
    assert len(objets) == 3

    assert rabe.delete(f"{BASE}/analyses/{a['id']}").status_code == 204
    assert objets == {}                                       # la ligne ET tous les objets
    assert rabe.get(f"{BASE}/analyses/{a['id']}").status_code == 404
    ligne = db.scalars(select(Journal).where(Journal.action == "suppression_analyse")).one()
    assert ligne.details == {"reference": a["reference"], "objets": 3}

    b = _envoyer(rabe, octets(panoramique())).json()
    assert admin.delete(f"{BASE}/analyses/{b['id']}").status_code == 204


def test_lecteur_ne_supprime_pas(admin, connecte, objets):
    rabe = connecte("dr.rabe@cabinet.example.org")
    lecteur = connecte("lecteur@cabinet.example.org", "Lecteur")
    a = _envoyer(rabe, octets(panoramique())).json()
    assert lecteur.delete(f"{BASE}/analyses/{a['id']}").status_code == 403
    assert lecteur.get(f"{BASE}/analyses/{a['id']}").status_code == 200


def test_stockage_injoignable_rien_n_est_supprime(connecte, objets, monkeypatch):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = _envoyer(rabe, octets(panoramique())).json()

    def panne(cle):
        raise ConnectionError("MinIO arrêté")

    monkeypatch.setattr(analyses_router.storage, "delete", panne)
    r = rabe.delete(f"{BASE}/analyses/{a['id']}")
    assert r.status_code == 503 and r.json()["code"] == "stockage_indisponible"
    assert rabe.get(f"{BASE}/analyses/{a['id']}").status_code == 200


# --- Stockage surveillé -------------------------------------------------------------------------------

def test_etat_du_stockage_et_alerte(admin, connecte, objets, monkeypatch):
    from app.config import settings

    rabe = connecte("dr.rabe@cabinet.example.org")
    _envoyer(rabe, octets(panoramique()))
    assert rabe.get(f"{BASE}/stockage").status_code == 403
    etat = admin.get(f"{BASE}/stockage").json()
    assert etat["objets"] == 1 and etat["octets"] > 0 and etat["alerte"] is False
    monkeypatch.setattr(settings, "stockage_alerte_go", 0.000001)
    assert admin.get(f"{BASE}/stockage").json()["alerte"] is True


def test_un_import_autorise_n_est_jamais_ecrit_sur_le_disque(connecte, objets, monkeypatch):
    """Jusqu'à 20 Mo, le fichier reçu reste en mémoire : Starlette ne le
    déverse pas dans un fichier temporaire."""
    import tempfile

    from starlette.formparsers import MultiPartParser

    assert MultiPartParser.max_file_size > 20 * 1024 * 1024
    ecrits = []
    origine = tempfile.SpooledTemporaryFile.rollover

    def rollover(self):
        ecrits.append(self)
        return origine(self)

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", rollover)
    gros = octets(Image.fromarray(np.random.default_rng(0).integers(0, 255, (4000, 4200), dtype=np.uint8)))
    assert 15 * 1024 * 1024 < len(gros) < 20 * 1024 * 1024
    rabe = connecte("dr.rabe@cabinet.example.org")
    assert _envoyer(rabe, gros, "/apercu").status_code == 200
    assert ecrits == []
