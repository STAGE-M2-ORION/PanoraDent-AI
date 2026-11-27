"""PanoraDent (Bangladesh, CC BY 4.0) : lecture et conversion des annotations.

Logique pure, sans écriture : `prepare_panoradent.py` l'emploie, les tests la
vérifient. Décisions (training/class_mapping.md) :

- **Classes.** Les 7 classes cibles sont gardées ; Periapical Abnormality
  (définition absente du guide), Cyst, Attrition et Periodontal Pocket (trop
  rares, presque toutes du lot A) sont écartées.
- **Convention des boîtes (choix A1).** PanoraDent encadre la *lésion* (carie,
  zone radio-claire péri-apicale) ; DENTEX encadre la *dent atteinte*. Pour le
  jeu combiné, chaque carie et chaque lésion PanoraDent est remplacée par la
  boîte de sa dent, trouvée par le modèle `dents-v1` et la règle de
  rattachement du service (`inference/app/fdi.py` : 20 % de l'anomalie dans la
  dent, boîte prolongée vers l'apex pour une lésion). Plusieurs caries sur une
  même dent donnent une seule boîte, comme dans DENTEX. Une anomalie qui ne se
  rattache à aucune dent écarte son cliché du jeu combiné : on ne mélange pas
  les deux conventions.
- La dent incluse est déjà encadrée sur la dent dans les deux jeux : gardée telle quelle.
"""
import importlib.util
from dataclasses import dataclass, field
from pathlib import Path

from config import CLASSES_COMBINE, CLASSES_PANORADENT, REPO_ROOT

#: Classes du fichier data.yaml de PanoraDent, dans son ordre (index YOLO source).
NOMS_SOURCE = ["Attrition", "Cyst", "Dental Caries", "Endodontically Treated Tooth", "Impacted Third Molar",
               "Missing Tooth", "Periapical Abnormality", "Periapical Lesion", "Periodontal Pocket",
               "Retained Root", "Tooth Fracture"]

#: Classe source → classe du jeu « panoradent » (None : écartée).
CORRESPONDANCE = {
    "Dental Caries": "caries",
    "Periapical Lesion": "periapical_lesion",
    "Impacted Third Molar": "impacted_tooth",
    "Missing Tooth": "missing_tooth",
    "Endodontically Treated Tooth": "endodontic_treatment",
    "Retained Root": "retained_root",
    "Tooth Fracture": "tooth_fracture",
    "Periapical Abnormality": None,
    "Cyst": None,
    "Attrition": None,
    "Periodontal Pocket": None,
}

#: Classes converties en boîte de dent pour le jeu combiné (choix A1).
CONVERTIES = ("caries", "periapical_lesion")

assert set(CORRESPONDANCE) == set(NOMS_SOURCE)
assert {v for v in CORRESPONDANCE.values() if v} == set(CLASSES_PANORADENT)


@dataclass
class Boite:
    """Boîte normalisée (0-1), coin haut-gauche, et sa classe dans le jeu « panoradent »."""
    classe: str
    x: float
    y: float
    w: float
    h: float


@dataclass
class Cliche:
    nom: str                 # OPG_0001.jpg
    image: Path
    largeur: int
    hauteur: int
    lot: str                 # A ou B (= hôpital)
    boites: list[Boite] = field(default_factory=list)
    ecartees: dict[str, int] = field(default_factory=dict)   # classe source → boîtes écartées
    vide_a_la_source: bool = False


def lire_etiquettes(texte: str, largeur: int, hauteur: int) -> tuple[list[Boite], dict[str, int]]:
    """Lignes YOLO source → boîtes gardées, et compte des boîtes écartées par classe."""
    boites, ecartees = [], {}
    for ligne in texte.splitlines():
        if not ligne.strip():
            continue
        c, cx, cy, w, h = ligne.split()
        source = NOMS_SOURCE[int(c)]
        cible = CORRESPONDANCE[source]
        w, h = float(w), float(h)
        if cible is None or w <= 0 or h <= 0:
            ecartees[source] = ecartees.get(source, 0) + 1
            continue
        boites.append(Boite(cible, float(cx) - w / 2, float(cy) - h / 2, w, h))
    return boites, ecartees


def lire(racine: Path, metadonnees: dict[str, dict]) -> list[Cliche]:
    """Tous les clichés du dossier `PanoraDent/` (images, labels, métadonnées)."""
    cliches = []
    for image in sorted((racine / "images").glob("*.jpg")):
        meta = metadonnees[image.name]
        larg, haut = int(meta["width"]), int(meta["height"])
        lab = racine / "labels" / f"{image.stem}.txt"
        texte = lab.read_text(encoding="utf-8") if lab.exists() else ""
        boites, ecartees = lire_etiquettes(texte, larg, haut)
        cliches.append(Cliche(image.name, image, larg, haut, meta["annotation_batch"], boites, ecartees,
                              vide_a_la_source=not texte.strip()))
    return cliches


# --- Conversion A1 : la lésion devient la dent atteinte ----------------------

def _fdi():
    """Règle de rattachement du service, lue à sa source (pas de copie divergente)."""
    chemin = REPO_ROOT / "inference" / "app" / "fdi.py"
    spec = importlib.util.spec_from_file_location("_panoradent_fdi", chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FDI = _fdi()


def iou(a, b) -> float:
    """IoU de deux boîtes [x, y, w, h] (mêmes unités)."""
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Conversion:
    boites: list[Boite]                       # boîtes du jeu combiné (classes CLASSES_COMBINE)
    non_rattachees: dict[str, int]            # classe → anomalies sans dent hôte
    fusionnees: dict[str, int]                # classe → anomalies réunies sur une dent déjà comptée


def convertir(c: Cliche, dents_px: list[list[float]]) -> Conversion:
    """Boîtes du jeu combiné pour un cliché, à partir des dents détectées
    (`dents_px` : [x, y, w, h] en pixels). Caries et lésions → boîte de leur
    dent ; dent incluse gardée ; classes absentes de DENTEX ignorées."""
    L, H = c.largeur, c.hauteur
    dets = [{"label": "tooth", "confidence": 1.0, "bbox": list(b)} for b in dents_px]
    anomalies = []
    for b in c.boites:
        if b.classe in CONVERTIES:
            d = {"label": b.classe, "confidence": 1.0, "bbox": [b.x * L, b.y * H, b.w * L, b.h * H]}
            anomalies.append(d)
    FDI.numeroter(dets + anomalies, L, H)
    # Index `dent` relatif à la liste passée : les dents en tête, donc direct.
    sorties, deja = [], set()
    non_rattachees, fusionnees = {}, {}
    for a in anomalies:
        if a["dent"] is None:
            non_rattachees[a["label"]] = non_rattachees.get(a["label"], 0) + 1
            continue
        cle = (a["label"], a["dent"])
        if cle in deja:
            fusionnees[a["label"]] = fusionnees.get(a["label"], 0) + 1
            continue
        deja.add(cle)
        x, y, w, h = dents_px[a["dent"]]
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(float(L), x + w), min(float(H), y + h)
        sorties.append(Boite(a["label"], x0 / L, y0 / H, (x1 - x0) / L, (y1 - y0) / H))
    for b in c.boites:
        if b.classe == "impacted_tooth":
            sorties.append(b)
    assert all(b.classe in CLASSES_COMBINE for b in sorties)
    return Conversion(sorties, non_rattachees, fusionnees)


def ligne_yolo(index: int, b: Boite) -> str:
    return f"{index} {b.x + b.w / 2:.6f} {b.y + b.h / 2:.6f} {b.w:.6f} {b.h:.6f}"


#: DENTEX (jeu « anomalies », classes du contrat) → jeu combiné. Carie
#: profonde fusionnée dans carie ; `tooth` absent du jeu anomalies.
DENTEX_VERS_COMBINE = {"caries": "caries", "deep_caries": "caries",
                       "periapical_lesion": "periapical_lesion", "impacted_tooth": "impacted_tooth"}
