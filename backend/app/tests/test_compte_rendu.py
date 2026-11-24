"""Sprint 8, lot B — compte rendu PDF reconstruit à la demande.

Le PDF est produit sans compression des pages : son texte se lit dans les
octets, ce qui permet de vérifier ce qu'il contient (et ce qu'il ne contient
pas) sans bibliothèque de lecture.
"""
import io
import re
from datetime import datetime, timezone

from PIL import Image
from sqlalchemy import select

from app import worker
from app.auth_models import Journal
from app.models import Analysis
from app.services import compte_rendu as cr

from .conftest import BASE
from .test_analyses import _envoyer, objets, octets  # noqa: F401
from .test_revue import PRATICIEN, _tout_statuer, _url, _verdict, analyse  # noqa: F401


def poser_image(objets, cle="images/a.png", taille=(2000, 1000)):
    tampon = io.BytesIO()
    Image.new("L", taille, 90).save(tampon, "PNG")
    objets[cle] = tampon.getvalue()


def cloturer(client, analyse, conclusion="Carie 36 à traiter ; contrôle dans 6 mois."):
    _tout_statuer(client, analyse)
    assert client.post(_url(analyse, "/cloturer"), json={"conclusion": conclusion}).status_code == 200


def pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type /Page\b", pdf))


def test_refuse_avant_la_cloture_sauf_brouillon_affiche(connecte, analyse, objets):
    poser_image(objets)
    praticien = connecte(PRATICIEN)
    r = praticien.get(_url(analyse, "/compte-rendu"))
    assert r.status_code == 409 and r.json()["code"] == "analyse_non_cloturee"

    r = praticien.get(_url(analyse, "/compte-rendu"), params={"brouillon": "true"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert b"BROUILLON" in r.content and r.headers["content-disposition"].startswith("inline")

    r = praticien.get(_url(analyse, "/compte-rendu"), params={"brouillon": "true", "telecharger": "true"})
    assert r.status_code == 409 and r.json()["code"] == "brouillon_non_telechargeable"


def test_compte_rendu_definitif_journalise_affichage_et_telechargement(connecte, analyse, objets, db):
    poser_image(objets)
    praticien = connecte(PRATICIEN)
    cloturer(praticien, analyse)

    r = praticien.get(_url(analyse, "/compte-rendu"))
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert b"BROUILLON" not in r.content
    assert r.headers["cache-control"] == "no-store"
    r = praticien.get(_url(analyse, "/compte-rendu"), params={"telecharger": "true", "image": "false"})
    assert r.headers["content-disposition"] == 'attachment; filename="compte-rendu-PDX-2026-0001.pdf"'

    entrees = db.scalars(select(Journal).where(Journal.action.like("compte_rendu_%")).order_by(Journal.horodatage)).all()
    assert [e.action for e in entrees] == ["compte_rendu_genere", "compte_rendu_telecharge"]
    assert entrees[1].cible == f"analyse:{analyse['id']}" and entrees[1].utilisateur_id is not None
    assert entrees[1].details == {"reference": "PDX-2026-0001", "brouillon": False, "image": False,
                                  "rejetees": False, "commentaires": True}
    assert not any(k.startswith("reports/") for k in objets)      # rien n'est stocké


def test_rejetees_seulement_sur_demande_dans_une_section_separee(connecte, analyse, objets):
    poser_image(objets)
    praticien = connecte(PRATICIEN)
    _verdict(praticien, analyse, "carie", "valider")
    _verdict(praticien, analyse, "profonde", "valider")
    _verdict(praticien, analyse, "lesion", "rejeter")
    praticien.post(_url(analyse, "/cloturer"), json={})

    sans = praticien.get(_url(analyse, "/compte-rendu")).content
    avec = praticien.get(_url(analyse, "/compte-rendu"), params={"rejetees": "true"}).content
    assert b"Propositions rejet" not in sans and b"Propositions rejet" in avec
    assert b"Anomalies retenues \\(2\\)" in sans          # parenthèses échappées dans le PDF


def test_donnees_retenues_rejetees_schema_et_seuils(db, analyse):
    a = db.get(Analysis, analyse["id"])
    a.detections[3].etat = "rejetee"            # la lésion de la 46
    a.seuils = {"caries": 0.1, "deep_caries": 0.5}
    cabinet = type("C", (), {"nom": "Cabinet du Lac", "adresse": "Rue 12\n\n301 Fianarantsoa", "mentions": " ", "logo_cle": None})()
    d = cr.donnees(a, cabinet, cr.Options(rejetees=True))
    assert [(l["fdi"], l["abbr"]) for l in d["retenues"]] == [(36, "C"), (37, "CP")]
    assert [(l["fdi"], l["statut"]) for l in d["rejetees"]] == [(46, "Rejetée")]
    assert d["schema"]["presentes"] == {36} and set(d["schema"]["anomalies"]) == {36, 37}
    assert d["seuils"] == {"Carie": 0.1, "Carie profonde": 0.5}
    assert d["cabinet"] == {"nom": "Cabinet du Lac", "adresse": ["Rue 12", "301 Fianarantsoa"], "mentions": ""}
    assert d["examen"] == "non renseignée" and d["cloture"] is None
    assert cr.donnees(a, cabinet, cr.Options())["rejetees"] == []


def contenu_long(n=70) -> dict:
    """Assez d'anomalies pour tenir sur plusieurs pages."""
    lignes = [{"fdi": 11 + (i % 8), "label": "caries", "type": "Carie", "abbr": "C", "couleur": "#F0E442", "forme": "rond",
               "confiance": 0.5, "statut": "Validée", "commentaire": "Radio-clarté distale.", "cadre": (0.1, 0.1, 0.05, 0.05)}
              for i in range(n)]
    return {"reference": "PDX-2026-0042", "cabinet": {"nom": "Cabinet du Lac", "adresse": ["Rue 12"], "mentions": "Dossier patient."},
            "examen": "12/11/2026", "importee": "12/11/2026 à 09:00", "cloture": {"le": "12/11/2026 à 10:00", "par": {"nom": "Dr Rabe", "details": []}},
            "modele": "dentex-2026.11", "seuils": None, "retenues": lignes, "rejetees": [], "conclusion": "Ligne 1\nLigne 2",
            "schema": {"presentes": {11, 12}, "absentes": {18}, "anomalies": {11: lignes[:2]}}, "options": cr.Options()}


def test_mention_non_certifiee_et_reference_sur_chaque_page():
    pdf = cr.rendre(contenu_long(), Image.new("L", (1200, 600), 80), None, datetime(2026, 11, 23, 8, 0, tzinfo=timezone.utc))
    n = pages(pdf)
    assert n >= 2
    assert len(re.findall(rb"prototype de recherche non certifi", pdf)) == n
    assert len(re.findall(rb"R\\351f\. PDX-2026-0042", pdf)) == n          # « Réf. » (é en octal)
    assert all(f"page {i} / {n}".encode() in pdf for i in range(1, n + 1))
    assert len(re.findall(rb"Dossier patient\.", pdf)) == n               # mentions du cabinet


def test_deux_generations_donnent_le_meme_document_date_mise_a_part():
    image = Image.new("L", (1200, 600), 80)
    t1 = datetime(2026, 11, 23, 8, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 12, 1, 17, 45, tzinfo=timezone.utc)
    a, b = (cr.rendre(contenu_long(10), image, None, t) for t in (t1, t2))
    assert a != b

    def neutre(pdf, t):
        """Date de génération telle qu'écrite dans le PDF (accents en octal), remplacée par un repère."""
        texte = f"Généré le {cr._heure(t.replace(tzinfo=None))}".encode("cp1252")
        litteral = b"".join(bytes([o]) if o < 128 else b"\\%03o" % o for o in texte)
        assert litteral in pdf
        return pdf.replace(litteral, b"<DATE>")

    assert neutre(a, t1) == neutre(b, t2)


def test_aucune_donnee_identifiante_sur_le_document(connecte, objets, session_factory, db):
    """Le nom du fichier importé (souvent le nom du patient) n'apparaît nulle part."""
    praticien = connecte(PRATICIEN)
    a = _envoyer(praticien, octets(Image.new("L", (3600, 1800), 60)), nom="RAKOTO_Jean_1961.png").json()
    assert worker.traiter_une(session_factory)
    r = praticien.get(f"{BASE}/analyses/{a['id']}/compte-rendu", params={"brouillon": "true"})
    assert r.status_code == 200, r.text
    for fragment in (b"RAKOTO", b"Jean", b"1961"):
        assert fragment not in r.content
    assert a["reference"].encode() in r.content


def test_lecteur_et_analyse_inconnue_refuses(connecte, analyse):
    from app.permissions import VIEWER_ROLE

    lecteur = connecte("lecteur.cr@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.get(_url(analyse, "/compte-rendu"), params={"brouillon": "true"}).status_code == 403
    assert connecte(PRATICIEN).get(f"{BASE}/analyses/inconnue/compte-rendu").status_code == 404
