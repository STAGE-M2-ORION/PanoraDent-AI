"""Sprint 8, lot A — paramètres du cabinet (en-tête des comptes rendus)."""
import io

from PIL import Image
from sqlalchemy import select

from app.auth_models import Journal
from app.permissions import ADMIN_ROLE, CABINET_MANAGE, PRACTITIONER_ROLE, SYSTEM_ROLES, VIEWER_ROLE

from .conftest import BASE
from .test_analyses import objets  # noqa: F401  (stockage objet simulé)

URL = f"{BASE}/cabinet"
PRATICIEN = "dr.cabinet@cabinet.example.org"


def image(fmt="PNG", taille=(1200, 900), mode="RGB") -> bytes:
    sortie = io.BytesIO()
    Image.new(mode, taille, (20, 120, 160)).save(sortie, format=fmt)
    return sortie.getvalue()


def envoyer_logo(client, contenu, nom="logo.png"):
    return client.put(f"{URL}/logo", files={"fichier": (nom, contenu, "application/octet-stream")})


def test_seul_l_administrateur_gere_le_cabinet():
    assert CABINET_MANAGE in SYSTEM_ROLES[ADMIN_ROLE]
    assert CABINET_MANAGE not in SYSTEM_ROLES[PRACTITIONER_ROLE] | SYSTEM_ROLES[VIEWER_ROLE]


def test_lecture_vide_puis_modification_journalisee(admin, db):
    assert admin.get(URL).json() == {"nom": "", "adresse": "", "mentions": "", "logo": False,
                                     "logo_version": None, "maj_le": None, "maj_par_nom": None,
                                     "retention_jours": 365}
    r = admin.put(URL, json={"nom": "  Cabinet du Lac  ", "adresse": "Rue 12\n301 Fianarantsoa",
                             "mentions": "Document destiné au dossier du patient."})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["nom"] == "Cabinet du Lac" and c["adresse"].startswith("Rue 12") and c["maj_le"]
    entree = db.scalars(select(Journal).where(Journal.action == "cabinet_parametres")).all()[-1]
    assert entree.details == {"champs": ["adresse", "mentions", "nom"]}

    # Rien de changé : pas d'entrée de plus au journal.
    admin.put(URL, json={"nom": "Cabinet du Lac", "adresse": "Rue 12\n301 Fianarantsoa",
                         "mentions": "Document destiné au dossier du patient."})
    assert len(db.scalars(select(Journal).where(Journal.action == "cabinet_parametres")).all()) == 1


def test_nom_obligatoire_et_longueurs_bornees(admin):
    assert admin.put(URL, json={"nom": "   "}).json()["code"] == "nom_requis"
    assert admin.put(URL, json={"nom": "x" * 121}).status_code == 422
    assert admin.put(URL, json={"nom": "Cabinet", "mentions": "m" * 1001}).status_code == 422


def test_un_praticien_lit_sans_modifier(connecte, admin):
    admin.put(URL, json={"nom": "Cabinet du Lac"})
    praticien = connecte(PRATICIEN)
    assert praticien.get(URL).json()["nom"] == "Cabinet du Lac"
    assert praticien.put(URL, json={"nom": "Autre"}).status_code == 403
    assert envoyer_logo(praticien, image()).status_code == 403
    assert praticien.delete(f"{URL}/logo").status_code == 403


def test_lecture_exige_une_session(client):
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/logo").status_code == 401


def test_logo_reencode_en_png_dans_son_cadre_proportions_gardees(admin, objets, db):
    r = envoyer_logo(admin, image("JPEG", (1200, 900)), nom="logo.jpg")
    assert r.status_code == 200, r.text
    assert r.json()["logo"] and r.json()["logo_version"]
    servi = admin.get(f"{URL}/logo")
    assert servi.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(servi.content)) as logo:
        assert logo.format == "PNG" and logo.size == (400, 300)   # 1200 × 900 réduit dans 800 × 300
    assert db.scalars(select(Journal).where(Journal.action == "cabinet_logo")).all()[-1].details == {"logo": "importe"}


def test_petit_logo_transparent_garde_tel_quel(admin, objets):
    envoyer_logo(admin, image("PNG", (120, 60), mode="RGBA"))
    with Image.open(io.BytesIO(admin.get(f"{URL}/logo").content)) as logo:
        assert logo.size == (120, 60) and logo.mode == "RGBA"


def test_remplacer_puis_retirer_le_logo(admin, objets):
    premier = envoyer_logo(admin, image()).json()["logo_version"]
    second = envoyer_logo(admin, image("WEBP", (300, 100))).json()["logo_version"]
    assert premier != second and len(objets) == 1          # l'ancien est supprimé du stockage
    assert admin.delete(f"{URL}/logo").status_code == 204
    assert admin.get(f"{URL}/logo").status_code == 404 and not objets
    assert admin.get(URL).json()["logo"] is False


def test_logo_refuse_s_il_n_est_pas_une_image_ou_trop_lourd(admin, objets):
    r = envoyer_logo(admin, b"%PDF-1.4 pas une image", nom="logo.png")
    assert r.status_code == 415 and r.json()["code"] == "format_non_pris_en_charge"
    assert envoyer_logo(admin, b"").json()["code"] == "image_invalide"
    r = envoyer_logo(admin, b"\x89PNG" + b"0" * (1024 * 1024 + 10))
    assert r.status_code == 413
    assert not objets
