"""Attribution de la numérotation FDI aux détections (PRD §5.2).

Un détecteur à boîtes renvoie une classe et des coordonnées, jamais un numéro
de dent : la numérotation FDI est une propriété **géométrique** de la denture,
pas une classe apprise. Elle est donc dérivée ici, après l'inférence, à partir
de la position relative des boîtes.

Convention FDI — premier chiffre le quadrant, second la position depuis la
ligne médiane (1 = incisive centrale … 8 = troisième molaire) :

    droite patient │ gauche patient
    ───────────────┼───────────────
      maxillaire   │
         1x        │      2x
    ───────────────┼───────────────   ← plan d'occlusion
         4x        │      3x
       mandibule   │

Sur une panoramique, l'image est présentée **face au patient** : la droite du
patient occupe donc la moitié *gauche* des pixels. Les quadrants 1 et 4 sont à
gauche de l'image, les quadrants 2 et 3 à droite.

Deux repères sont nécessaires :

- **Ligne médiane verticale** — le protocole d'acquisition centre le plan
  médio-sagittal du patient : `width / 2` est un a priori fiable.
- **Plan d'occlusion horizontal** — il ne se trouve *pas* à mi-hauteur de
  l'image, sa position dépend du cadrage. Il est donc déduit des détections
  elles-mêmes par un 2-moyennes à une dimension sur les ordonnées.

Les anomalies (carie, lésion…) n'ont pas de FDI propre : elles **héritent** du
numéro de la dent qu'elles recouvrent. C'est la formulation clinique — « carie
sur la 36 » — et elle reproduit le comportement du mode mock.
"""
from statistics import median

#: Classe portant la numérotation. Les autres classes en héritent.
TOOTH_LABEL = "tooth"

#: Position maximale dans un quadrant (8 = troisième molaire).
MAX_POSITION = 8

#: Fraction de l'aire d'une anomalie qui doit tomber dans une dent pour lui
#: être rattachée. En deçà, le FDI reste `None` plutôt que d'être inventé.
MIN_CONTAINMENT = 0.5

_KMEANS_MAX_ITER = 20
_EPSILON = 1e-6


def _centre(bbox) -> tuple[float, float]:
    x, y, w, h = bbox
    return x + w / 2.0, y + h / 2.0


def _intersection_area(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    overlap_w = min(ax + aw, bx + bw) - max(ax, bx)
    overlap_h = min(ay + ah, by + bh) - max(ay, by)
    if overlap_w <= 0 or overlap_h <= 0:
        return 0.0
    return float(overlap_w * overlap_h)


def _containment(inner, outer) -> float:
    """Part de `inner` couverte par `outer`, dans [0, 1].

    Volontairement asymétrique : une carie est bien plus petite que la dent qui
    la porte, une IoU classique la rejetterait.
    """
    area = float(inner[2] * inner[3])
    if area <= 0:
        return 0.0
    return _intersection_area(inner, outer) / area


def occlusal_plane(y_centres: list[float], heights: list[float],
                   fallback: float) -> float:
    """Ordonnée séparant maxillaire et mandibule.

    2-moyennes à une dimension, initialisé sur les extrêmes : aucune graine
    aléatoire, le résultat est **reproductible**. Si les deux groupes obtenus
    sont plus proches que la hauteur médiane d'une dent, c'est qu'il n'y a
    qu'une seule arcade dans l'image : le partitionnement n'a alors aucun sens
    et l'a priori de cadrage reprend la main.
    """
    if len(y_centres) < 2:
        return fallback
    lo, hi = min(y_centres), max(y_centres)
    if hi - lo < _EPSILON:
        return fallback

    for _ in range(_KMEANS_MAX_ITER):
        upper = [v for v in y_centres if abs(v - lo) <= abs(v - hi)]
        lower = [v for v in y_centres if abs(v - lo) > abs(v - hi)]
        if not upper or not lower:
            return fallback
        new_lo = sum(upper) / len(upper)
        new_hi = sum(lower) / len(lower)
        if abs(new_lo - lo) < _EPSILON and abs(new_hi - hi) < _EPSILON:
            lo, hi = new_lo, new_hi
            break
        lo, hi = new_lo, new_hi

    if heights and (hi - lo) < median(heights):
        return fallback          # une seule arcade : rien à séparer
    return (lo + hi) / 2.0


def _quadrant(cx: float, cy: float, x_mid: float, y_mid: float) -> int:
    patient_right = cx < x_mid          # droite patient = gauche image
    if cy < y_mid:                      # maxillaire
        return 1 if patient_right else 2
    return 4 if patient_right else 3    # mandibule


def assign_fdi(detections: list[dict], width: int, height: int) -> list[dict]:
    """Renseigne la clé `fdi` de chaque détection, **en place**.

    `detections` suit le contrat de `POST /infer` : `label`, `confidence`,
    `bbox = [x, y, largeur, hauteur]` en pixels. La liste est retournée pour
    permettre le chaînage.

    Limites assumées : une dent surnuméraire ou un faux positif au-delà de la
    huitième position d'un quadrant est écrêté à 8 — deux détections peuvent
    donc porter le même numéro. Le rattachement reste géométrique : il ne
    remplace pas la lecture du praticien.
    """
    teeth = [d for d in detections if d.get("label") == TOOTH_LABEL]
    anomalies = [d for d in detections if d.get("label") != TOOTH_LABEL]

    x_mid = width / 2.0
    y_mid = occlusal_plane(
        [_centre(d["bbox"])[1] for d in teeth],
        [d["bbox"][3] for d in teeth],
        fallback=height / 2.0,
    )

    by_quadrant: dict[int, list[tuple[float, dict]]] = {1: [], 2: [], 3: [], 4: []}
    for tooth in teeth:
        cx, cy = _centre(tooth["bbox"])
        by_quadrant[_quadrant(cx, cy, x_mid, y_mid)].append((abs(cx - x_mid), tooth))

    for quadrant, entries in by_quadrant.items():
        entries.sort(key=lambda entry: entry[0])   # de la médiane vers l'arrière
        for index, (_, tooth) in enumerate(entries):
            tooth["fdi"] = quadrant * 10 + min(index + 1, MAX_POSITION)

    for anomaly in anomalies:
        host, best = None, MIN_CONTAINMENT
        for tooth in teeth:
            score = _containment(anomaly["bbox"], tooth["bbox"])
            if score >= best:
                host, best = tooth, score
        anomaly["fdi"] = host["fdi"] if host else None

    return detections
