"""Lecture des annotations DENTEX, ramenées à une seule représentation.

DENTEX arrive sous deux formats :

- **COCO hiérarchique** (entraînement, validation) : chaque boîte porte jusqu'à
  trois catégories — `category_id_1` le quadrant, `category_id_2` le rang de la
  dent dans le quadrant, `category_id_3` le diagnostic. Les **identifiants**
  commencent à 0 ; ce sont les **noms** des catégories qui portent le numéro
  (`id 0 → "1"`). On lit donc toujours le nom, jamais l'identifiant ;
- **LabelMe** (test officiel) : un fichier par cliché, des polygones, et un
  libellé `code-nom-FDI` en turc (`1-çürük-35` : carie sur la 35).

Les deux deviennent des `Cliche`, avec des boîtes en fractions de l'image
(coin haut gauche, comme le reste de la plateforme), le numéro FDI et le
diagnostic dans le vocabulaire de `CLASSES` (ou `None` : dent sans diagnostic).
"""
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

#: Diagnostic COCO (nom de catégorie) -> classe PanoraDent.
DIAGNOSTICS_COCO = {
    "Caries": "caries",
    "Deep Caries": "deep_caries",
    "Periapical Lesion": "periapical_lesion",
    "Impacted": "impacted_tooth",
}

#: Code LabelMe du test officiel -> (libellé turc, classe PanoraDent ou None).
#: None : le code existe mais n'est pas dans notre périmètre (dent saine, soin
#: canalaire, extraction, fracture). « küretaj » (curetage) est exclu
#: (décision S6-1) : sa correspondance avec « carie profonde » est plausible
#: mais non documentée, et une hypothèse ne doit pas fabriquer une mesure.
CODES_LABELME = {
    "0": ("sağlam", None),
    "1": ("çürük", "caries"),
    "2": ("küretaj", None),
    "3": ("kanal", None),
    "5": ("çekim", None),
    "6": ("gömülü", "impacted_tooth"),
    "7": ("lezyon", "periapical_lesion"),
    "8": ("kırık", None),
}


class FormatInattendu(ValueError):
    """Annotation qui ne suit pas le format attendu : jamais ignorée en silence."""


@dataclass
class Boite:
    x: float
    y: float
    w: float
    h: float
    fdi: int | None = None
    diagnostic: str | None = None


@dataclass
class Cliche:
    source: str            # sous-ensemble d'origine, ex. "quadrant_enumeration"
    nom: str               # nom du fichier image
    image: Path
    largeur: int
    hauteur: int
    boites: list[Boite] = field(default_factory=list)

    @property
    def identifiant(self) -> str:
        return f"{self.source}/{self.nom}"


def _fractions(x, y, w, h, largeur, hauteur) -> tuple[float, float, float, float]:
    """Boîte en pixels -> fractions, rognée aux bords de l'image."""
    x1, y1 = max(0.0, x), max(0.0, y)
    x2, y2 = min(float(largeur), x + w), min(float(hauteur), y + h)
    return (round(x1 / largeur, 6), round(y1 / hauteur, 6),
            round(max(0.0, x2 - x1) / largeur, 6), round(max(0.0, y2 - y1) / hauteur, 6))


def _noms(coco: dict, cle: str) -> dict:
    return {c["id"]: c["name"] for c in coco.get(cle, [])}


def fdi_de(quadrant: str | None, rang: str | None) -> int | None:
    if quadrant is None or rang is None:
        return None
    q, r = int(quadrant), int(rang)
    if not (1 <= q <= 4 and 1 <= r <= 8):
        raise FormatInattendu(f"quadrant {quadrant} / rang {rang} hors de la denture permanente")
    return q * 10 + r


def lire_coco(json_path: Path, images_dir: Path, source: str) -> list[Cliche]:
    """Sous-ensemble COCO hiérarchique -> clichés. Toute anomalie lève une erreur."""
    coco = json.loads(json_path.read_text(encoding="utf-8"))
    quadrants, rangs, diagnostics = (_noms(coco, f"categories_{k}") for k in (1, 2, 3))
    if not quadrants:
        raise FormatInattendu(f"{json_path} : pas de categories_1, format non hiérarchique")
    inconnus = set(diagnostics.values()) - set(DIAGNOSTICS_COCO)
    if inconnus:
        raise FormatInattendu(f"{json_path} : diagnostics inconnus {sorted(inconnus)}")

    cliches = {}
    for img in coco["images"]:
        chemin = images_dir / Path(img["file_name"]).name
        cliches[img["id"]] = Cliche(source, chemin.name, chemin, img["width"], img["height"])

    for ann in coco["annotations"]:
        c = cliches[ann["image_id"]]
        q = quadrants.get(ann.get("category_id_1")) if "category_id_1" in ann else None
        r = rangs.get(ann.get("category_id_2")) if "category_id_2" in ann else None
        d = diagnostics.get(ann.get("category_id_3")) if "category_id_3" in ann else None
        if "category_id_3" in ann and d is None:
            raise FormatInattendu(f"{json_path} : category_id_3={ann['category_id_3']} inconnu")
        c.boites.append(Boite(*_fractions(*ann["bbox"], c.largeur, c.hauteur),
                              fdi=fdi_de(q, r),
                              diagnostic=DIAGNOSTICS_COCO[d] if d else None))
    return list(cliches.values())


def lire_labelme(dossier_labels: Path, dossier_images: Path, source: str = "test") -> list[Cliche]:
    """Test officiel (LabelMe) -> clichés. Polygone -> cadre englobant."""
    cliches = []
    for fichier in sorted(dossier_labels.glob("*.json")):
        d = json.loads(fichier.read_text(encoding="utf-8"))
        c = Cliche(source, d["imagePath"], dossier_images / d["imagePath"],
                   d["imageWidth"], d["imageHeight"])
        for forme in d["shapes"]:
            morceaux = forme["label"].split("-")
            if len(morceaux) != 3 or morceaux[0] not in CODES_LABELME:
                raise FormatInattendu(f"{fichier.name} : libellé inattendu {forme['label']!r}")
            code, _, dent = morceaux
            xs = [p[0] for p in forme["points"]]
            ys = [p[1] for p in forme["points"]]
            x, y = min(xs), min(ys)
            c.boites.append(Boite(*_fractions(x, y, max(xs) - x, max(ys) - y, c.largeur, c.hauteur),
                                  fdi=fdi_de(dent[0], dent[1]) if len(dent) == 2 else None,
                                  diagnostic=CODES_LABELME[code][1]))
        cliches.append(c)
    return cliches


def empreinte_pixels(chemin: Path) -> str:
    """Empreinte du contenu décodé : deux exports du même cliché la partagent,
    même si les fichiers diffèrent (métadonnées, compression)."""
    import cv2
    img = cv2.imread(str(chemin), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FormatInattendu(f"{chemin} : image illisible")
    return hashlib.sha256(img.tobytes() + str(img.shape).encode()).hexdigest()
