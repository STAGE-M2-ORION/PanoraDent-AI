"""Sprint 6, lot C — masquage des inscriptions par le détecteur de texte (OpenCV DNN).

Clichés portant du texte incrusté sous trois formes : blanc sur la bordure
noire (le cas de l'heuristique), gris sur fond gris (que l'heuristique ne voit
pas) et vertical sur le bord. Le centre du cliché ne doit jamais être masqué.
"""
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.services import anonymize as anon
from app.services import detecteur_texte as dt

from .test_anonymize import H, L, TEXTE, boite_texte, octets, panoramique, police

GRIS = "Dr RABE - Cabinet Ivato"
POS_GRIS = (1450, 925)
VERTICAL = "PLANMECA ProMax"


def cliche_avec_inscriptions() -> Image.Image:
    img = panoramique(texte_haut=TEXTE)
    d = ImageDraw.Draw(img)
    d.rectangle((1400, 900, L - 10, H - 10), fill=110)          # fond gris dans la bande du bas
    d.text(POS_GRIS, GRIS, fill=175, font=police(30))           # gris sur gris
    bande = Image.new("L", (420, 40), 0)
    ImageDraw.Draw(bande).text((4, 2), VERTICAL, fill=210, font=police(30))
    img.paste(bande.rotate(90, expand=True), (8, 300))           # vertical, bord gauche
    return img


def couverte(zones, boite, largeur=L, hauteur=H) -> bool:
    """La boîte (pixels) est entièrement sous une zone masquée."""
    x0, y0, x1, y1 = boite
    for z in zones:
        zx0, zy0, zx1, zy1 = z.pixels(largeur, hauteur)
        if zx0 <= x0 and zy0 <= y0 and zx1 >= x1 and zy1 >= y1:
            return True
    return False


def centre_intact(zones, largeur=L, hauteur=H) -> bool:
    """Aucune zone ne mord sur le centre (hors bandes périphériques)."""
    cx0, cx1 = largeur * dt.BANDE_COTE, largeur * (1 - dt.BANDE_COTE)
    cy0, cy1 = hauteur * dt.BANDE_HAUT, hauteur * (1 - dt.BANDE_BAS)
    for z in zones:
        x0, y0, x1, y1 = z.pixels(largeur, hauteur)
        if x0 < cx1 and x1 > cx0 and y0 < cy1 and y1 > cy0:
            return False
    return True


def test_les_trois_formes_d_inscription_sont_masquees():
    img = cliche_avec_inscriptions()
    zones, methode = anon.detecter(img)
    assert methode == anon.METHODE_MODELE
    assert couverte(zones, boite_texte(TEXTE, (40, 30)))
    assert couverte(zones, boite_texte(GRIS, POS_GRIS, taille=30))
    vertical = np.asarray(img)[300:720, 8:48] > 150
    ys, xs = np.nonzero(vertical)
    assert couverte(zones, (8 + xs.min(), 300 + ys.min(), 8 + xs.max(), 300 + ys.max()))
    assert centre_intact(zones)


def test_l_heuristique_seule_ne_voyait_pas_le_gris_sur_gris():
    """Ce que le modèle apporte : l'heuristique du sprint 3 rate ces inscriptions."""
    zones = anon.detecter_inscriptions(cliche_avec_inscriptions())
    assert couverte(zones, boite_texte(TEXTE, (40, 30)))
    assert not couverte(zones, boite_texte(GRIS, POS_GRIS, taille=30))


def test_image_stockee_sans_inscription_et_dents_intactes():
    r = anon.anonymiser(octets(cliche_avec_inscriptions()))
    arr = np.asarray(r.image)
    x0, y0, x1, y1 = boite_texte(GRIS, POS_GRIS, taille=30)
    assert arr[y0:y1, x0:x1].max() == 0
    assert arr[420:600, 420:1500].max() >= 230                  # dents non touchées
    assert r.methode == anon.METHODE_MODELE


def test_cliche_sans_inscription_rien_de_masque():
    zones, _ = anon.detecter(panoramique(texte_haut=None, mandibule=True))
    assert zones == []


@pytest.mark.parametrize("probleme", ["absent", "altere"])
def test_modele_indisponible_repli_sur_l_heuristique(tmp_path, monkeypatch, probleme):
    chemin = tmp_path / "modele.onnx"
    if probleme == "altere":
        chemin.write_bytes(dt.MODELE.read_bytes()[:-10] + b"0123456789")
    monkeypatch.setattr(dt, "_detecteur", dt.DetecteurTexte(chemin))
    zones, methode = anon.detecter(cliche_avec_inscriptions())
    assert methode == anon.METHODE_HEURISTIQUE
    assert couverte(zones, boite_texte(TEXTE, (40, 30)))       # le secours masque le cas simple


def test_modele_versionne_conforme_a_son_empreinte():
    import hashlib
    assert hashlib.sha256(dt.MODELE.read_bytes()).hexdigest() == dt.SHA256
    assert (dt.MODELE.parent / "LICENSE").read_text(encoding="utf-8").find("Apache License") >= 0


@pytest.mark.parametrize("largeur, hauteur, tache", [
    (400, 40, False),    # ligne horizontale
    (40, 400, False),    # ligne verticale
    (30, 25, False),     # lettre isolée (« R »), fine
    (110, 100, True),    # tache trapue et épaisse (condyle) : écartée
    (300, 100, False),   # épaisse mais allongée : gros titre, gardé
])
def test_regle_des_taches(largeur, hauteur, tache):
    assert dt.est_tache(largeur, hauteur, 1000) is tache


# --- Vrais panoramiques (DENTEX), si les données sont présentes --------------

DENTEX = Path(__file__).resolve().parents[3] / "data/dentex/training_data/quadrant_enumeration/xrays"


@pytest.mark.skipif(not DENTEX.is_dir(), reason="DENTEX absent (data/ n'est pas versionné)")
def test_lot_de_vrais_panoramiques_avec_inscriptions():
    """20 panoramiques DENTEX, nom en haut, cabinet en gris en bas, appareil à la
    verticale : tout est masqué, jamais le centre."""
    from PIL import ImageFont

    for chemin in sorted(DENTEX.glob("*.png"))[:20]:
        img = Image.open(chemin).convert("L")
        w, h = img.size
        d = ImageDraw.Draw(img)
        haut = (int(w * 0.03), int(h * 0.03))
        bas = (int(w * 0.62), int(h * 0.93))
        d.text(haut, "DUPONT Jean 12/03/1961", fill=255, font=ImageFont.load_default(size=int(h * 0.03)))
        d.text(bas, "Dr RABE - Cabinet Ivato", fill=150, font=ImageFont.load_default(size=int(h * 0.025)))
        zones, methode = anon.detecter(img)
        assert methode == anon.METHODE_MODELE
        for texte, pos, taille in (("DUPONT Jean 12/03/1961", haut, int(h * 0.03)),
                                   ("Dr RABE - Cabinet Ivato", bas, int(h * 0.025))):
            boite = Image.new("L", (w, h), 0)
            ImageDraw.Draw(boite).text(pos, texte, fill=255, font=ImageFont.load_default(size=taille))
            assert couverte(zones, boite.getbbox(), w, h), f"{chemin.name} : « {texte} » non masqué"
        assert centre_intact(zones, w, h), f"{chemin.name} : le centre est masqué"
