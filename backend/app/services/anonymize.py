"""Contrôle et anonymisation des radiographies à l'import.

Ce qui est garanti :

1. **Contrôle du fichier** : le type est lu dans les premiers octets (PNG,
   JPEG ou DICOM), jamais dans l'extension ; 20 Mo au plus ; dimensions
   minimales d'une panoramique ; garde-fou contre les « bombes » de
   décompression. Un refus par cas, avec son message.
2. **Métadonnées** : seule la matrice de pixels est conservée (EXIF, en-têtes
   DICOM et champs patient disparaissent) ; l'image est ré-encodée en PNG.
3. **Inscriptions incrustées** (nom, date, cabinet, appareil imprimés dans
   les pixels, à la périphérie du cliché) : détecteur de texte DB d'OpenCV
   (`detecteur_texte.py`, sprint 6) ; s'il est indisponible, l'heuristique du
   sprint 3 prend le relais (seuillage puis composantes connexes sur les bandes
   du haut et du bas, sans OCR). La méthode employée est conservée. Masque
   noir plein par-dessus. Le praticien vérifie l'aperçu et peut ajouter des
   masques à la main ; il ne peut pas retirer un masque automatique.
4. **Rien n'est écrit sur le disque** : tout se fait en mémoire. L'original
   n'est jamais conservé.

Les masques sont exprimés en fractions de la largeur et de la hauteur
(`x`, `y`, `w`, `h` dans [0, 1]) : ils restent justes quelle que soit la taille
d'affichage de l'aperçu.
"""
import io
from dataclasses import dataclass

import logging

import numpy as np
from PIL import Image
from scipy import ndimage

from .detecteur_texte import DetecteurIndisponible, detecteur

logger = logging.getLogger("uvicorn.error")

#: Méthode de détection des inscriptions, conservée avec l'analyse.
METHODE_MODELE = "modele_texte"
METHODE_HEURISTIQUE = "heuristique"

TAILLE_MAX = 20 * 1024 * 1024          # 20 Mo
LARGEUR_MIN, HAUTEUR_MIN = 800, 400     # une panoramique est large et basse
PIXELS_MAX = 120_000_000                # garde-fou de décompression
LARGEUR_AFFICHAGE = 3000                # au-delà : version réduite pour l'affichage
MASQUES_MANUELS_MAX = 50

# Bandes où vivent les inscriptions, en fraction de la hauteur.
BANDE_HAUT, BANDE_BAS = 0.14, 0.14


class FichierRefuse(ValueError):
    """Refus d'un fichier : `status` HTTP, `code` stable, `message` affichable."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class Zone:
    """Rectangle en fractions de l'image (0 ≤ x, y ; x + w, y + h ≤ 1)."""
    x: float
    y: float
    w: float
    h: float

    def pixels(self, largeur: int, hauteur: int) -> tuple[int, int, int, int]:
        x0 = max(0, int(np.floor(self.x * largeur)))
        y0 = max(0, int(np.floor(self.y * hauteur)))
        x1 = min(largeur, int(np.ceil((self.x + self.w) * largeur)))
        y1 = min(hauteur, int(np.ceil((self.y + self.h) * hauteur)))
        return x0, y0, x1, y1

    def en_dict(self) -> dict:
        return {k: round(v, 5) for k, v in (("x", self.x), ("y", self.y), ("w", self.w), ("h", self.h))}


@dataclass
class Resultat:
    image: Image.Image          # anonymisée, niveaux de gris
    png: bytes                  # pleine résolution, sans métadonnées
    zones_auto: list[Zone]
    zones_manuelles: list[Zone]
    methode: str = METHODE_HEURISTIQUE

    @property
    def taille(self) -> tuple[int, int]:
        return self.image.size


# --- 1. Contrôle et lecture ---------------------------------------------------------

def format_reel(raw: bytes) -> str | None:
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if raw[128:132] == b"DICM":
        return "dicom"
    return None


def _dicom_en_image(raw: bytes) -> Image.Image:
    import pydicom

    try:
        ds = pydicom.dcmread(io.BytesIO(raw))
        arr = ds.pixel_array.astype("float32")
    except Exception as exc:  # noqa: BLE001 — DICOM illisible ou compressé non pris en charge
        raise FichierRefuse(422, "image_illisible", "Ce fichier DICOM ne contient pas d'image lisible.") from exc
    if arr.ndim == 3:  # multi-trames ou couleur : première trame, moyenne des canaux
        arr = arr[0] if arr.shape[0] < arr.shape[-1] else arr.mean(axis=-1)
    if getattr(ds, "PhotometricInterpretation", "") == "MONOCHROME1":
        arr = arr.max() - arr  # 0 = blanc dans ce mode : on remet l'os en clair
    etendue = float(arr.max() - arr.min()) or 1.0
    return Image.fromarray(((arr - arr.min()) / etendue * 255.0).astype("uint8"), mode="L")


def lire(raw: bytes) -> Image.Image:
    """Contrôle le fichier et renvoie l'image en niveaux de gris, sans métadonnées."""
    if not raw:
        raise FichierRefuse(422, "fichier_vide", "Le fichier est vide.")
    if len(raw) > TAILLE_MAX:
        raise FichierRefuse(413, "fichier_trop_volumineux", "Le fichier dépasse 20 Mo.")
    fmt = format_reel(raw)
    if fmt is None:
        raise FichierRefuse(
            415, "format_non_pris_en_charge",
            "Format non pris en charge : importez une radiographie PNG, JPEG ou DICOM.",
        )
    if fmt == "dicom":
        image = _dicom_en_image(raw)
    else:
        Image.MAX_IMAGE_PIXELS = PIXELS_MAX
        try:
            with Image.open(io.BytesIO(raw)) as source:
                source.load()
                image = source.convert("L")  # perd EXIF, profil couleur, commentaires
        except (Image.DecompressionBombError, OSError, ValueError) as exc:
            raise FichierRefuse(422, "image_illisible", "Ce fichier n'est pas une image lisible.") from exc
    largeur, hauteur = image.size
    if largeur * hauteur > PIXELS_MAX:
        raise FichierRefuse(422, "image_trop_grande", "Image trop grande (120 mégapixels au plus).")
    if largeur < LARGEUR_MIN or hauteur < HAUTEUR_MIN:
        raise FichierRefuse(
            422, "image_trop_petite",
            f"Image trop petite ({largeur} × {hauteur} px) : une panoramique fait au moins "
            f"{LARGEUR_MIN} × {HAUTEUR_MIN} px.",
        )
    return image


# --- 2. Détection des inscriptions -------------------------------------------------------

def _blocs_de_texte(bande: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Blocs de caractères clairs et contrastés dans une bande (coordonnées locales)."""
    h, w = bande.shape
    if h < 4 or w < 4:
        return []
    # Caractères : quasi saturés, nettement au-dessus du fond de la bande.
    seuil = max(200.0, float(np.percentile(bande, 50)) + 90.0)
    clair = bande >= seuil
    if not clair.any():
        return []
    # On soude les lettres d'un même mot / d'une même ligne.
    soude = ndimage.binary_dilation(clair, structure=np.ones((3, max(5, w // 300))), iterations=2)
    etiquettes, n = ndimage.label(soude)
    blocs = []
    for tranche in ndimage.find_objects(etiquettes):
        if tranche is None:
            continue
        ys, xs = tranche
        hb, wb = ys.stop - ys.start, xs.stop - xs.start
        # Une ligne de texte : basse, plutôt large, et pas toute la largeur de l'image.
        if hb < 4 or hb > max(12, h * 0.6) or wb < 8 or wb > w * 0.7:
            continue
        densite = clair[ys, xs].mean()
        if not 0.04 <= densite <= 0.75:
            continue
        # Contraste local : le fond autour du bloc est sombre (le texte est incrusté
        # sur le noir de la bordure, pas sur l'os, qui est gris autour).
        my0, my1 = max(0, ys.start - hb), min(h, ys.stop + hb)
        mx0, mx1 = max(0, xs.start - hb), min(w, xs.stop + hb)
        alentour = bande[my0:my1, mx0:mx1][~clair[my0:my1, mx0:mx1]]
        if alentour.size and float(np.median(alentour)) > 110:
            continue
        blocs.append((xs.start, ys.start, xs.stop, ys.stop))
    return blocs


def _fusionner(rects: list[tuple[int, int, int, int]], mx: int, my: int) -> list[tuple[int, int, int, int]]:
    """Élargit chaque rectangle (plus en largeur : les mots d'une même ligne se
    rejoignent) puis fusionne ceux qui se chevauchent."""
    rects = [(x0 - mx, y0 - my, x1 + mx, y1 + my) for x0, y0, x1, y1 in rects]
    fusion = True
    while fusion:
        fusion = False
        sortie: list[tuple[int, int, int, int]] = []
        for r in rects:
            for i, s in enumerate(sortie):
                if r[0] <= s[2] and s[0] <= r[2] and r[1] <= s[3] and s[1] <= r[3]:
                    sortie[i] = (min(r[0], s[0]), min(r[1], s[1]), max(r[2], s[2]), max(r[3], s[3]))
                    fusion = True
                    break
            else:
                sortie.append(r)
        rects = sortie
    return rects


def _zones(rects, largeur: int, hauteur: int) -> list[Zone]:
    """Rectangles en pixels -> zones en fractions, après fusion des voisins."""
    zones = []
    for x0, y0, x1, y1 in _fusionner(rects, mx=max(12, largeur // 100), my=max(3, hauteur // 200)):
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(largeur, x1), min(hauteur, y1)
        zones.append(Zone(x0 / largeur, y0 / hauteur, (x1 - x0) / largeur, (y1 - y0) / hauteur))
    return zones


def detecter(image: Image.Image) -> tuple[list[Zone], str]:
    """Zones à masquer et méthode employée : le détecteur de texte, ou
    l'heuristique s'il est indisponible (modèle absent, altéré, illisible)."""
    arr = np.asarray(image, dtype=np.uint8)
    hauteur, largeur = arr.shape
    try:
        rects = detecteur().detecter(arr)
    except DetecteurIndisponible as exc:
        logger.warning("Détecteur de texte indisponible (%s) : repli sur l'heuristique.", exc)
        return detecter_inscriptions(image), METHODE_HEURISTIQUE
    return _zones(rects, largeur, hauteur), METHODE_MODELE


def detecter_inscriptions(image: Image.Image) -> list[Zone]:
    """Heuristique du sprint 3, gardée en secours : blocs de caractères clairs
    sur fond sombre, dans les bandes du haut et du bas."""
    arr = np.asarray(image, dtype=np.uint8)
    hauteur, largeur = arr.shape
    rects = []
    haut = int(hauteur * BANDE_HAUT)
    for x0, y0, x1, y1 in _blocs_de_texte(arr[:haut]):
        rects.append((x0, y0, x1, y1))
    debut_bas = hauteur - int(hauteur * BANDE_BAS)
    for x0, y0, x1, y1 in _blocs_de_texte(arr[debut_bas:]):
        rects.append((x0, y0 + debut_bas, x1, y1 + debut_bas))
    return _zones(rects, largeur, hauteur)


# --- 3. Masquage ---------------------------------------------------------------------------

def zones_depuis(donnees: list[dict] | None) -> list[Zone]:
    """Masques manuels reçus du client, validés et bornés à l'image."""
    if not donnees:
        return []
    if len(donnees) > MASQUES_MANUELS_MAX:
        raise FichierRefuse(422, "masques_invalides", f"{MASQUES_MANUELS_MAX} masques au plus.")
    zones = []
    for d in donnees:
        try:
            x, y, w, h = (float(d[k]) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError) as exc:
            raise FichierRefuse(422, "masques_invalides", "Masque invalide : x, y, w et h sont attendus.") from exc
        if not all(np.isfinite(v) for v in (x, y, w, h)) or w <= 0 or h <= 0:
            raise FichierRefuse(422, "masques_invalides", "Masque invalide : dimensions nulles ou négatives.")
        x, y = min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)
        zones.append(Zone(x, y, min(w, 1.0 - x), min(h, 1.0 - y)))
    return [z for z in zones if z.w > 0 and z.h > 0]


def masquer(image: Image.Image, zones: list[Zone]) -> Image.Image:
    arr = np.array(image, dtype=np.uint8)  # copie
    hauteur, largeur = arr.shape
    for zone in zones:
        x0, y0, x1, y1 = zone.pixels(largeur, hauteur)
        arr[y0:y1, x0:x1] = 0  # noir plein : rien ne subsiste dessous
    return Image.fromarray(arr, mode="L")


def png(image: Image.Image) -> bytes:
    sortie = io.BytesIO()
    image.save(sortie, format="PNG", optimize=False)
    return sortie.getvalue()


def anonymiser(raw: bytes, masques_manuels: list[dict] | None = None) -> Resultat:
    """Contrôle, lecture sans métadonnées, détection des inscriptions et masquage."""
    image = lire(raw)
    manuelles = zones_depuis(masques_manuels)
    auto, methode = detecter(image)
    anonyme = masquer(image, auto + manuelles)
    return Resultat(image=anonyme, png=png(anonyme), zones_auto=auto, zones_manuelles=manuelles, methode=methode)


def version_affichage(image: Image.Image) -> bytes | None:
    """Version réduite (3 000 px de large) pour l'affichage, ou None si inutile.
    L'image pleine résolution reste celle de l'inférence."""
    largeur, hauteur = image.size
    if largeur <= LARGEUR_AFFICHAGE:
        return None
    reduite = image.resize((LARGEUR_AFFICHAGE, round(hauteur * LARGEUR_AFFICHAGE / largeur)), Image.LANCZOS)
    return png(reduite)


def apercu_jpeg(image: Image.Image, largeur_max: int = 1600) -> bytes:
    """Aperçu léger (JPEG) pour l'écran d'import ; jamais stocké."""
    largeur, hauteur = image.size
    if largeur > largeur_max:
        image = image.resize((largeur_max, round(hauteur * largeur_max / largeur)), Image.LANCZOS)
    sortie = io.BytesIO()
    image.save(sortie, format="JPEG", quality=82)
    return sortie.getvalue()


def anonymize(raw: bytes, filename: str = "") -> tuple[Image.Image, bytes]:
    """Compatibilité : anonymisation sans masque manuel."""
    r = anonymiser(raw)
    return r.image, r.png
