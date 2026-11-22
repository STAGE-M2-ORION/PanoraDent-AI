"""Numérotation FDI des dents et rattachement des anomalies (PRD §5.2, sprint 7).

Convention FDI — premier chiffre le quadrant, second le rang depuis la ligne
médiane (1 = incisive centrale … 8 = troisième molaire) :

    droite patient │ gauche patient
    ───────────────┼───────────────
         1x        │      2x          maxillaire
    ───────────────┼───────────────   ← plan d'occlusion
         4x        │      3x          mandibule

Sur une panoramique, l'image est présentée face au patient : sa droite occupe
la moitié GAUCHE des pixels.

**Numérotation hybride (décision du sprint 7).** Le modèle « rangs » donne le
RANG de chaque dent (clé `rang`, 1 à 8) ; la géométrie ne donne que le
QUADRANT. Une règle qui déduisait le rang de l'ordre des dents depuis la
médiane se trompait dès qu'une dent manquait (toutes les suivantes étaient
décalées) : 74,8 % de dents bien numérotées sur la validation, quand le
quadrant, lui, était juste à 98 %. Avec le rang appris, le plafond mesuré sur
la validation (rang parfait) est de 99,2 %.

Repères géométriques :

- **ligne médiane** : centre des incisives (rangs 1 et 2), symétriques autour
  d'elle ; à défaut, le milieu de l'image (99,2 % contre 98,0 % au plafond) ;
- **plan d'occlusion** : 2-moyennes sur les ordonnées des dents, reproductible.

Sans rang (ancien modèle « dents »), l'ancienne règle d'ordre s'applique.

**Incohérences : signalées, jamais corrigées d'office** (plan, sprint 7). Deux
dents au même numéro, des rangs dans le désordre, plus de huit dents dans un
quadrant : les dents concernées sont marquées `douteux` et l'incohérence est
décrite ; aucun numéro n'est déplacé, une correction silencieuse sur un
élément clinique serait plus dangereuse qu'un doute affiché.

**Rattachement.** Une anomalie est rattachée à la dent dont la boîte recouvre
le plus la sienne (part de l'anomalie couverte), si ce recouvrement atteint
0,20 ; en dessous, elle reste non rattachée plutôt que d'être attribuée à une
voisine par défaut. Pour une lésion péri-apicale, la boîte de la dent est
prolongée vers la racine. Réglé sur la validation : 98,4 % de rattachements
justes avec les boîtes de la vérité terrain.
"""
from statistics import mean, median

#: Classe portant la numérotation. Les autres classes en héritent.
TOOTH_LABEL = "tooth"
PERIAPICAL_LABEL = "periapical_lesion"

#: Position maximale dans un quadrant (8 = troisième molaire).
MAX_POSITION = 8

#: Part de l'aire d'une anomalie qui doit tomber dans une dent pour lui être
#: rattachée (plan du sprint 7). En deçà, le FDI reste `None`.
MIN_CONTAINMENT = 0.20

#: Prolongement de la boîte d'une dent vers la racine, en part de sa hauteur,
#: pour rattacher une lésion péri-apicale située sous l'apex.
EXTENSION_APEX = 0.25

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
    qu'une seule arcade dans l'image : l'a priori de cadrage reprend la main.
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


def midline(teeth: list[dict], width: int) -> float:
    """Ligne médiane : centre des incisives (rangs 1 et 2) s'il y en a au
    moins deux, sinon le milieu de l'image."""
    centres = [_centre(t["bbox"])[0] for t in teeth if t.get("rang") in (1, 2)]
    return mean(centres) if len(centres) >= 2 else width / 2.0


def _quadrant(cx: float, cy: float, x_mid: float, y_mid: float) -> int:
    patient_right = cx < x_mid          # droite patient = gauche image
    if cy < y_mid:                      # maxillaire
        return 1 if patient_right else 2
    return 4 if patient_right else 3    # mandibule


def _vers_apex(bbox, quadrant: int) -> list[float]:
    """Boîte de dent prolongée vers la racine : vers le bas à la mandibule,
    vers le haut au maxillaire."""
    x, y, w, h = bbox
    extra = h * EXTENSION_APEX
    if quadrant in (3, 4):
        return [x, y, w, h + extra]
    return [x, y - extra, w, h + extra]


def incoherences(teeth: list[dict], by_quadrant: dict[int, list[tuple[float, dict]]]) -> list[dict]:
    """Doublons, rangs dans le désordre, quadrant surchargé. Marque les dents
    concernées `douteux` ; ne change aucun numéro."""
    signales = []
    for quadrant, entries in by_quadrant.items():
        if len(entries) > MAX_POSITION:
            signales.append({"type": "quadrant_surcharge", "quadrant": quadrant, "nombre": len(entries),
                             "message": f"{len(entries)} dents dans le quadrant {quadrant} (8 au plus)."})
        par_fdi: dict[int, list[dict]] = {}
        for _, tooth in entries:
            par_fdi.setdefault(tooth["fdi"], []).append(tooth)
        for fdi, dents in sorted(par_fdi.items()):
            if len(dents) > 1:
                for d in dents:
                    d["douteux"] = True
                signales.append({"type": "doublon", "fdi": fdi, "nombre": len(dents),
                                 "message": f"{len(dents)} dents portent le numéro {fdi}."})
        rangs = [tooth.get("rang") for _, tooth in entries]       # depuis la médiane
        if all(r is not None for r in rangs):
            for (_, a), (_, b) in zip(entries, entries[1:]):
                if b["rang"] < a["rang"]:
                    a["douteux"] = b["douteux"] = True
                    signales.append({"type": "ordre", "fdi": [a["fdi"], b["fdi"]],
                                     "message": f"La {b['fdi']} est plus loin de la médiane que la {a['fdi']} : "
                                                "numéros à vérifier."})
    return signales


def numeroter(detections: list[dict], width: int, height: int) -> list[dict]:
    """Renseigne `fdi` (et `douteux`, `dent`) de chaque détection, **en place**,
    et renvoie la liste des incohérences.

    Entrée : contrat de `POST /infer` (`label`, `confidence`, `bbox` en pixels),
    plus `rang` (1 à 8) sur les dents quand le modèle est un modèle « rangs ».
    Sortie, sur chaque anomalie : `fdi` hérité de sa dent et `dent`, l'index de
    cette dent dans `detections` (ou `None` si elle n'est pas rattachée).
    """
    teeth = [d for d in detections if d.get("label") == TOOTH_LABEL]
    anomalies = [d for d in detections if d.get("label") != TOOTH_LABEL]
    for tooth in teeth:
        tooth["douteux"] = False

    x_mid = midline(teeth, width)
    y_mid = occlusal_plane(
        [_centre(d["bbox"])[1] for d in teeth],
        [d["bbox"][3] for d in teeth],
        fallback=height / 2.0,
    )

    by_quadrant: dict[int, list[tuple[float, dict]]] = {1: [], 2: [], 3: [], 4: []}
    for tooth in teeth:
        cx, cy = _centre(tooth["bbox"])
        tooth["_quadrant"] = _quadrant(cx, cy, x_mid, y_mid)
        by_quadrant[tooth["_quadrant"]].append((abs(cx - x_mid), tooth))

    for quadrant, entries in by_quadrant.items():
        entries.sort(key=lambda entry: entry[0])   # de la médiane vers l'arrière
        for index, (_, tooth) in enumerate(entries):
            rang = tooth.get("rang")
            if rang is None:                        # ancien modèle : rang par ordre
                rang = min(index + 1, MAX_POSITION)
            tooth["fdi"] = quadrant * 10 + int(rang)

    signales = incoherences(teeth, by_quadrant)

    index_de = {id(d): i for i, d in enumerate(detections)}
    for anomaly in anomalies:
        host, best = None, MIN_CONTAINMENT
        for tooth in teeth:
            boite = tooth["bbox"]
            if anomaly.get("label") == PERIAPICAL_LABEL:
                boite = _vers_apex(boite, tooth["_quadrant"])
            score = _containment(anomaly["bbox"], boite)
            if score >= best:
                host, best = tooth, score
        anomaly["fdi"] = host["fdi"] if host else None
        anomaly["dent"] = index_de[id(host)] if host else None

    for tooth in teeth:
        del tooth["_quadrant"]
    return signales


def assign_fdi(detections: list[dict], width: int, height: int) -> list[dict]:
    """Compatibilité : numérote en place et renvoie les détections."""
    numeroter(detections, width, height)
    return detections
