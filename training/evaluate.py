"""Évaluation d'un modèle : mesures par classe, matrice de confusion, pires erreurs.

**Le jeu de test ne s'évalue qu'une fois.** Régler quoi que ce soit en regardant
le test le contamine : ses chiffres cessent d'être une mesure indépendante. Les
réglages se font sur la validation (`--split val`, sans limite). Chaque
évaluation sur le test est inscrite dans `evaluations_test.jsonl`, à côté de
`split.json` ; une seconde est refusée, sauf `--forcer "<motif>"`, et le motif
figure alors dans le rapport et dans le registre.

Ce qui est produit, dans `<run>/evaluation_<split>/` :

- `metrics.json` : précision, rappel, mAP@0,50 et mAP@0,50:0,95 **par classe**,
  puis globalement (une moyenne seule masquerait qu'une classe rare est
  ignorée) ; sensibilité et spécificité **par cliché**, au seuil d'exploitation
  (« ce cliché présente-t-il une carie ? ») ; empreinte du découpage et des poids ;
- `confusion.png` / matrice dans `metrics.json` : quelle classe est prise pour
  quelle autre, et ce que le modèle manque ou invente (colonne et ligne « fond ») ;
- `pires_erreurs.jpg` : les clichés qui cumulent le plus de faux positifs et de
  faux négatifs, vérité terrain en vert, détections justes en bleu, fausses en
  rouge ;
- `rapport.md` : le résumé lisible, repris dans le mémoire.

Une détection est juste si sa classe est celle de la vérité terrain et si les
deux boîtes se recouvrent à au moins 0,50 (IoU).

    python training/evaluate.py --weights runs/<nom>/weights/best.pt --split val
    python training/evaluate.py --weights runs/<nom>/weights/best.pt --split test
"""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from config import CLASSES, git_commit  # CLASSES : remplacée par celle du jeu évalué
from train import check_class_order, read_class_names

SEUIL_IOU = 0.50
REGISTRE_TEST = "evaluations_test.jsonl"


def _parse_args(argv=None):
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--weights", type=Path, required=True)
    p.add_argument("--data", type=Path, default=None, help="défaut : celui de run.json")
    p.add_argument("--split", default="val", choices=("train", "val", "test"))
    p.add_argument("--imgsz", type=int, default=None, help="défaut : celui de run.json")
    p.add_argument("--conf", type=float, default=0.25,
                   help="seuil d'exploitation (pires erreurs, mesures par cliché). "
                        "N'affecte PAS la mAP, calculée sur toute la courbe.")
    p.add_argument("--device", default=None)
    p.add_argument("--n-erreurs", type=int, default=12, help="clichés sur la planche")
    p.add_argument("--forcer", default=None, metavar="MOTIF",
                   help="réévaluer le test malgré une évaluation précédente")
    p.add_argument("--out", type=Path, default=None)
    return p.parse_args(argv)


# --- Fonctions pures ---------------------------------------------------------

def iou(a, b) -> float:
    """Recouvrement de deux boîtes (x1, y1, x2, y2)."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def apparier(verite: list, predictions: list, seuil: float = SEUIL_IOU) -> dict:
    """Appariement glouton, classe par classe, par confiance décroissante.

    `verite` : [(classe, boite)] ; `predictions` : [(classe, boite, confiance)].
    Une vérité terrain n'est appariée qu'une fois. Retourne, par classe, les
    vrais positifs, faux positifs et faux négatifs, et les indices concernés.
    """
    resultat = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    prises = set()
    justes = set()
    for i in sorted(range(len(predictions)), key=lambda k: -predictions[k][2]):
        classe, boite, _ = predictions[i]
        meilleur, j_meilleur = seuil, None
        for j, (c, b) in enumerate(verite):
            if c == classe and j not in prises:
                v = iou(boite, b)
                if v >= meilleur:
                    meilleur, j_meilleur = v, j
        if j_meilleur is None:
            resultat[classe]["fp"] += 1
        else:
            prises.add(j_meilleur)
            justes.add(i)
            resultat[classe]["tp"] += 1
    for j, (c, _) in enumerate(verite):
        if j not in prises:
            resultat[c]["fn"] += 1
    return {"par_classe": dict(resultat), "predictions_justes": justes, "verites_trouvees": prises}


def confusion(verite: list, predictions: list, nc: int, seuil: float = SEUIL_IOU) -> list:
    """Matrice (nc + 1) x (nc + 1) d'un cliché ; ligne = prédit, colonne = vrai.

    Appariement **toutes classes confondues** (c'est justement la classe qu'on
    compare) : chaque vérité terrain prend la prédiction libre qui la recouvre
    le plus, au-dessus du seuil. Vérité sans prédiction : ligne « fond » (manquée).
    Prédiction sans vérité : colonne « fond » (inventée).
    """
    m = [[0] * (nc + 1) for _ in range(nc + 1)]
    libres = set(range(len(predictions)))
    paires = sorted(((iou(pb, vb), j, i) for j, (_, vb) in enumerate(verite)
                     for i, (_, pb, _) in enumerate(predictions)), reverse=True)
    appariees = set()
    for valeur, j, i in paires:
        if valeur < seuil:
            break
        if j in appariees or i not in libres:
            continue
        appariees.add(j)
        libres.discard(i)
        m[predictions[i][0]][verite[j][0]] += 1
    for j, (c, _) in enumerate(verite):
        if j not in appariees:
            m[nc][c] += 1
    for i in libres:
        m[predictions[i][0]][nc] += 1
    return m


def _ratio(n: int, d: int):
    """None plutôt que 0 quand le dénominateur est vide : l'absence de mesure
    n'est pas une mesure à zéro."""
    return round(n / d, 4) if d else None


def sha256_de(chemin: Path) -> str:
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


# --- Registre du test --------------------------------------------------------

def evaluations_rangees(dossier_runs: Path | None, nom_jeu: str) -> list:
    """Évaluations du test de ce jeu déjà rangées dans les runs (`<run>/evaluation*_test/`).

    Le registre vit dans le dossier des données, recréé à chaque nouvelle
    machine ou session Colab ; les runs, eux, sont conservés (Drive, puis copie
    locale). Les relire garde la règle « une seule fois » d'une machine à l'autre.
    """
    trouvees = []
    if dossier_runs is None or not dossier_runs.is_dir():
        return trouvees
    for chemin in sorted(dossier_runs.glob("*/evaluation*_test/metrics.json")):
        m = json.loads(chemin.read_text(encoding="utf-8"))
        if m.get("split") == "test" and Path(m.get("data_yaml", "")).parent.name == nom_jeu:
            trouvees.append({"date_utc": m.get("date_utc", "?"), "poids": m.get("poids", "?"),
                             "poids_sha256": m.get("poids_sha256", "?"), "rapport": str(chemin)})
    return trouvees


def verifier_test_unique(dossier_jeu: Path, poids_sha: str, forcer: str | None,
                         dossier_runs: Path | None = None) -> list:
    """Refuse une seconde évaluation sur le test, sauf motif explicite."""
    registre = dossier_jeu / REGISTRE_TEST
    precedentes = []
    if registre.exists():
        precedentes = [json.loads(l) for l in registre.read_text(encoding="utf-8").splitlines() if l]
    connues = {e.get("rapport") for e in precedentes}
    precedentes += [e for e in evaluations_rangees(dossier_runs, dossier_jeu.name)
                    if e["rapport"] not in connues]
    if precedentes and not forcer:
        liste = "\n".join(f"  - {e['date_utc']} : {e['poids']} (sha256 {e['poids_sha256'][:12]})"
                          + (f", rapport {e['rapport']}" if e.get("rapport") else "")
                          for e in precedentes)
        raise SystemExit(
            "Le jeu de test de ce découpage a déjà été évalué :\n" + liste + "\n"
            "Une seconde mesure n'est plus indépendante. Évaluer sur la validation "
            "(--split val), ou justifier avec --forcer \"<motif>\".")
    return precedentes


def inscrire_test(dossier_jeu: Path, entree: dict) -> None:
    with (dossier_jeu / REGISTRE_TEST).open("a", encoding="utf-8") as f:
        f.write(json.dumps(entree, ensure_ascii=False) + "\n")


# --- Mesures -----------------------------------------------------------------

# Tranches de taille d'une lésion : côté équivalent (racine de l'aire) en pixels
# de l'image telle que le modèle la VOIT (réduite à imgsz). Sert à vérifier
# l'hypothèse « les petites lésions sont manquées parce que trop réduites ».
TRANCHES_TAILLE = ((0, 16, "< 16 px"), (16, 32, "16–32 px"), (32, 64, "32–64 px"),
                   (64, float("inf"), "≥ 64 px"))


def tranche_de(cote: float) -> str:
    return next(nom for bas, haut, nom in TRANCHES_TAILLE if bas <= cote < haut)


def rappel_par_taille(cliches: list, imgsz: int, noms: list, seuil: float = SEUIL_IOU) -> dict:
    """Rappel par classe et par tranche de taille, au seuil d'exploitation.

    `cliches` : [{"taille": (w, h), "verite": [(classe, boite)], "predictions":
    [(classe, boite, confiance)], "trouvees": indices de vérité appariées}].
    `autre_classe` : manquée, mais une détection d'une AUTRE classe la recouvre
    (IoU ≥ seuil) — lésion vue au bon endroit, mal typée, et non pas ignorée.
    """
    compte = defaultdict(lambda: defaultdict(Counter))
    for c in cliches:
        w, h = c["taille"]
        echelle = imgsz / max(w, h)
        for j, (classe, b) in enumerate(c["verite"]):
            cote = ((b[2] - b[0]) * (b[3] - b[1])) ** 0.5 * echelle
            case = compte[classe][tranche_de(cote)]
            case["n"] += 1
            if j in c["trouvees"]:
                case["trouvees"] += 1
            elif any(pc != classe and iou(pb, b) >= seuil for pc, pb, _ in c["predictions"]):
                case["autre_classe"] += 1
    par_classe = {}
    for classe in sorted(compte):
        par_classe[noms[classe]] = [
            {"tranche": nom, "n": k["n"], "trouvees": k["trouvees"],
             "autre_classe": k["autre_classe"], "rappel": _ratio(k["trouvees"], k["n"])}
            for _, _, nom in TRANCHES_TAILLE if (k := compte[classe][nom])["n"]]
    return {"imgsz": imgsz, "tranches": [nom for _, _, nom in TRANCHES_TAILLE],
            "seuil_iou": seuil, "par_classe": par_classe}


def data_root(data_yaml: Path) -> Path:
    for ligne in data_yaml.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("path:"):
            return Path(ligne.split("path:", 1)[1].strip())
    return data_yaml.parent


def instances_par_classe(labels_dir: Path) -> Counter:
    """Nombre de boîtes de vérité terrain par index de classe."""
    compte = Counter()
    for fichier in labels_dir.glob("*.txt"):
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if ligne.strip():
                compte[int(ligne.split()[0])] += 1
    return compte


def mesures_detection(modele, args) -> dict:
    """mAP par classe (toute la courbe).

    La présence d'une classe se lit dans les étiquettes, pas dans les résultats
    d'ultralytics : une classe que le modèle ne détecte jamais n'y figure pas, et
    serait déclarée « absente » au lieu de recevoir les zéros qu'elle mérite.
    """
    resultats = modele.val(data=str(args.data.resolve()), split=args.split, imgsz=args.imgsz,
                           device=args.device, plots=False, verbose=False)
    box = resultats.box
    instances = instances_par_classe(data_root(args.data) / args.split / "labels")
    calculees = {int(c): i for i, c in enumerate(box.ap_class_index)}
    par_classe = {}
    for index, nom in enumerate(CLASSES):
        if not instances[index]:
            par_classe[nom] = None      # aucune vérité terrain : rien à mesurer
            continue
        if index in calculees:
            precision, rappel, ap50, ap = box.class_result(calculees[index])
        else:
            precision = rappel = ap50 = ap = 0.0   # présente, jamais détectée
        par_classe[nom] = {"instances": instances[index],
                           "precision": round(float(precision), 4),
                           "rappel": round(float(rappel), 4),
                           "mAP50": round(float(ap50), 4),
                           "mAP50_95": round(float(ap), 4)}
    return {
        "global": {"precision": round(float(box.mp), 4), "rappel": round(float(box.mr), 4),
                   "mAP50": round(float(box.map50), 4), "mAP50_95": round(float(box.map), 4)},
        "par_classe": par_classe,
    }


def lire_verite(fichier: Path, w: int, h: int) -> list:
    verite = []
    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if ligne.strip():
                c, cx, cy, bw, bh = ligne.split()[:5]
                cx, cy, bw, bh = float(cx) * w, float(cy) * h, float(bw) * w, float(bh) * h
                verite.append((int(c), (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)))
    return verite


def parcourir_cliches(modele, args) -> tuple[dict, list, dict]:
    """Mesures par cliché, erreurs et matrice de confusion, au seuil d'exploitation."""
    racine = data_root(args.data)
    images_dir, labels_dir = racine / args.split / "images", racine / args.split / "labels"
    if not images_dir.is_dir():
        raise SystemExit(f"partition introuvable : {images_dir}")

    nc = len(CLASSES)
    matrice = [[0] * (nc + 1) for _ in range(nc + 1)]
    presence = defaultdict(Counter)
    cliches = []
    for r in modele.predict(source=str(images_dir), imgsz=args.imgsz, conf=args.conf,
                            device=args.device, verbose=False, stream=True):
        chemin = Path(r.path)
        h, w = r.orig_shape
        verite = lire_verite(labels_dir / f"{chemin.stem}.txt", w, h)
        predictions = [(int(c), tuple(b), float(s)) for c, b, s in
                       zip(r.boxes.cls.tolist(), r.boxes.xyxy.tolist(), r.boxes.conf.tolist())]
        appariement = apparier(verite, predictions)
        for i, ligne in enumerate(confusion(verite, predictions, nc)):
            for j, v in enumerate(ligne):
                matrice[i][j] += v
        erreurs =sum(v["fp"] + v["fn"] for v in appariement["par_classe"].values())
        cliches.append({"image": str(chemin), "erreurs": erreurs, "verite": verite,
                        "predictions": predictions, "taille": (w, h),
                        "trouvees": appariement["verites_trouvees"],
                        "justes": sorted(appariement["predictions_justes"]),
                        "detail": {CLASSES[c]: v for c, v in appariement["par_classe"].items()}})

        annotees = {c for c, _ in verite}
        predites = {c for c, _, _ in predictions}
        for index, nom in enumerate(CLASSES):
            attendu, obtenu = index in annotees, index in predites
            presence[nom]["tp" if attendu and obtenu else "fn" if attendu else
                          "fp" if obtenu else "tn"] += 1

    niveau_image = {
        "n_images": len(cliches),
        "seuil_confiance": args.conf,
        "par_classe": {nom: {**c, "sensibilite": _ratio(c["tp"], c["tp"] + c["fn"]),
                             "specificite": _ratio(c["tn"], c["tn"] + c["fp"])}
                       for nom, c in presence.items()},
    }
    matrice_confusion = {"etiquettes": CLASSES + ["fond"], "matrice": matrice,
                         "lecture": "ligne = prédit, colonne = vrai ; fond = manqué ou inventé",
                         "seuil_confiance": args.conf, "seuil_iou": SEUIL_IOU}
    return niveau_image, cliches, matrice_confusion


# --- Sorties visuelles -------------------------------------------------------

def dessiner_confusion(confusion: dict, sortie: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    m = np.array(confusion["matrice"], dtype=float)
    # Normalisée par colonne : part de chaque vraie classe prédite comme...
    totaux = m.sum(axis=0, keepdims=True)
    norm = np.divide(m, totaux, out=np.zeros_like(m), where=totaux > 0)
    etiquettes = confusion["etiquettes"]
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(etiquettes)), etiquettes, rotation=40, ha="right")
    ax.set_yticks(range(len(etiquettes)), etiquettes)
    ax.set_xlabel("vraie classe")
    ax.set_ylabel("classe prédite")
    for i in range(len(etiquettes)):
        for j in range(len(etiquettes)):
            if m[i, j]:
                ax.text(j, i, f"{int(m[i, j])}", ha="center", va="center",
                        color="white" if norm[i, j] > 0.5 else "black", fontsize=8)
    ax.set_title(f"Matrice de confusion, confiance ≥ {confusion['seuil_confiance']}\n"
                 "(effectifs ; couleur : part de la colonne)")
    fig.tight_layout()
    fig.savefig(sortie, dpi=150)
    plt.close(fig)


def dessiner_pires_erreurs(cliches: list, n: int, sortie: Path, largeur: int = 800) -> list:
    import cv2
    import numpy as np

    pires = sorted(cliches, key=lambda c: (-c["erreurs"], c["image"]))[:n]
    pires = [c for c in pires if c["erreurs"] > 0]
    if not pires:
        return []
    vignettes = []
    for c in pires:
        img = cv2.imread(c["image"])
        echelle = largeur / img.shape[1]
        img = cv2.resize(img, (largeur, int(img.shape[0] * echelle)))

        def cadre(boite, couleur, epaisseur, texte=None):
            x1, y1, x2, y2 = (int(v * echelle) for v in boite)
            cv2.rectangle(img, (x1, y1), (x2, y2), couleur, epaisseur)
            if texte:
                cv2.putText(img, texte, (x1, max(12, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX,
                            0.4, couleur, 1, cv2.LINE_AA)

        for classe, boite in c["verite"]:
            cadre(boite, (60, 200, 60), 2)
        for k, (classe, boite, conf) in enumerate(c["predictions"]):
            juste = k in c["justes"]
            cadre(boite, (230, 120, 30) if juste else (40, 40, 230), 1,
                  f"{CLASSES[classe]} {conf:.2f}")
        cv2.putText(img, f"{Path(c['image']).name} : {c['erreurs']} erreurs", (8, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        vignettes.append(img)

    hauteur = max(v.shape[0] for v in vignettes)
    colonnes = 2
    lignes = -(-len(vignettes) // colonnes)
    toile = np.full((lignes * hauteur, colonnes * largeur, 3), 255, np.uint8)
    for k, v in enumerate(vignettes):
        r, col = divmod(k, colonnes)
        toile[r * hauteur:r * hauteur + v.shape[0], col * largeur:(col + 1) * largeur] = v
    cv2.imwrite(str(sortie), toile)
    return [{"image": Path(c["image"]).name, "erreurs": c["erreurs"], "detail": c["detail"]}
            for c in pires]


def rapport_markdown(metrics: dict) -> str:
    def f(v):
        return "—" if v is None else f"{v:.3f}"
    lignes = [
        f"# Évaluation — partition `{metrics['split']}`", "",
        f"- Poids : `{metrics['poids']}` (sha256 `{metrics['poids_sha256'][:12]}`)",
        f"- Découpage : empreinte `{(metrics['decoupage'] or {}).get('empreinte', '?')[:12]}`",
        f"- Taille d'image : {metrics['imgsz']} px ; seuil d'exploitation : {metrics['seuil_confiance']}",
        f"- Date : {metrics['date_utc']} ; commit `{metrics['git_commit']}`",
    ]
    if metrics.get("motif_reevaluation"):
        lignes.append(f"- **Réévaluation du test** — motif : {metrics['motif_reevaluation']}")
    lignes += ["", "## Détection, par classe (IoU ≥ 0,50 pour la précision et le rappel)", "",
               "| classe | instances | précision | rappel | mAP@0,50 | mAP@0,50:0,95 | sensibilité (cliché) | spécificité (cliché) |",
               "|---|---|---|---|---|---|---|---|"]
    image = metrics["niveau_image"]["par_classe"]
    for nom in CLASSES:
        d = metrics["detection"]["par_classe"].get(nom)
        i = image.get(nom, {})
        if d is None:
            lignes.append(f"| {nom} | 0 | absente de la partition | | | | | |")
            continue
        lignes.append(f"| {nom} | {d['instances']} | {f(d['precision'])} | {f(d['rappel'])} | "
                      f"{f(d['mAP50'])} | {f(d['mAP50_95'])} | {f(i.get('sensibilite'))} | "
                      f"{f(i.get('specificite'))} |")
    g = metrics["detection"]["global"]
    lignes += [f"| **global** | | {f(g['precision'])} | {f(g['rappel'])} | {f(g['mAP50'])} | "
               f"{f(g['mAP50_95'])} | | |", ""]
    taille = metrics["detection"].get("rappel_par_taille")
    if taille and taille["par_classe"]:
        lignes += [f"## Rappel selon la taille (côté de la boîte, en pixels à {taille['imgsz']} px)", "",
                   "Une lésion « mal typée » est manquée, mais recouverte par une détection d'une "
                   "autre classe : vue au bon endroit.", "",
                   "| classe | " + " | ".join(taille["tranches"]) + " |",
                   "|---|" + "---|" * len(taille["tranches"])]
        for nom, cases in taille["par_classe"].items():
            par_tranche = {c["tranche"]: c for c in cases}
            cellules = []
            for t in taille["tranches"]:
                c = par_tranche.get(t)
                cellules.append("—" if c is None else
                                f"{f(c['rappel'])} ({c['trouvees']}/{c['n']}"
                                + (f", {c['autre_classe']} mal typée{'s' if c['autre_classe'] > 1 else ''}"
                                   if c["autre_classe"] else "") + ")")
            lignes.append(f"| {nom} | " + " | ".join(cellules) + " |")
        lignes.append("")
    lignes += ["Matrice de confusion : `confusion.png`. Pires erreurs : `pires_erreurs.jpg`.", ""]
    return "\n".join(lignes)


# --- Programme ---------------------------------------------------------------

def dossier_evaluation(data: Path, data_du_run: Path | None, split: str) -> str:
    """`evaluation_<partition>` sur le jeu d'entraînement ; `evaluation_<jeu>_<partition>`
    sur un autre (le test externe ne doit pas écraser le test interne). Le jeu
    se reconnaît à son NOM de dossier : préparé sur Colab (`/content/...`) puis
    copié en local, `anomalies` reste le même jeu."""
    if data_du_run is None or data.resolve().parent.name == data_du_run.parent.name:
        return f"evaluation_{split}"
    return f"evaluation_{data.resolve().parent.name}_{split}"


def lire_run(poids: Path) -> dict:
    chemin = poids.parent.parent / "run.json"
    return json.loads(chemin.read_text(encoding="utf-8")) if chemin.exists() else {}


def evaluer(args) -> Path:
    run = lire_run(args.weights)
    data_du_run = Path(run["data_yaml"]) if run.get("data_yaml") else None
    args.data = args.data or data_du_run
    if args.data is None:
        raise SystemExit("--data manquant, et aucun run.json à côté des poids.")
    args.imgsz = args.imgsz or run.get("hyperparametres", {}).get("imgsz") or 640
    check_class_order(args.data)
    # Les classes du JEU évalué (contrat ou rangs) : toutes les fonctions de ce
    # module les lisent ici, au moment de l'appel.
    global CLASSES
    CLASSES = read_class_names(args.data)

    dossier_jeu = args.data.parent
    poids_sha = sha256_de(args.weights)
    if args.split == "test":
        # <runs>/<run>/weights/best.pt -> <runs>
        verifier_test_unique(dossier_jeu, poids_sha, args.forcer, args.weights.resolve().parent.parent.parent)

    from ultralytics import YOLO
    modele = YOLO(str(args.weights))

    sortie = args.out or args.weights.parent.parent / dossier_evaluation(args.data, data_du_run, args.split)
    sortie.mkdir(parents=True, exist_ok=True)

    decoupage = None
    if (dossier_jeu / "split.json").exists():
        split = json.loads((dossier_jeu / "split.json").read_text(encoding="utf-8"))
        decoupage = {"empreinte": split.get("empreinte"), "graine": split.get("graine")}

    detection = mesures_detection(modele, args)
    niveau_image, cliches, detection["confusion"] = parcourir_cliches(modele, args)
    detection["rappel_par_taille"] = rappel_par_taille(cliches, args.imgsz, CLASSES)
    metrics = {
        "date_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "poids": str(args.weights), "poids_sha256": poids_sha,
        "data_yaml": str(args.data.resolve()), "split": args.split, "decoupage": decoupage,
        "imgsz": args.imgsz, "seuil_confiance": args.conf, "seuil_iou": SEUIL_IOU,
        "classes": CLASSES, "motif_reevaluation": args.forcer if args.split == "test" else None,
        "detection": detection, "niveau_image": niveau_image,
    }
    dessiner_confusion(detection["confusion"], sortie / "confusion.png")
    metrics["pires_erreurs"] = dessiner_pires_erreurs(cliches, args.n_erreurs,
                                                      sortie / "pires_erreurs.jpg")
    (sortie / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False),
                                         encoding="utf-8")
    (sortie / "rapport.md").write_text(rapport_markdown(metrics), encoding="utf-8")

    if args.split == "test":
        inscrire_test(dossier_jeu, {"date_utc": metrics["date_utc"], "poids": str(args.weights),
                                    "poids_sha256": poids_sha, "motif": args.forcer,
                                    "rapport": str(sortie / "metrics.json")})
    return sortie


def main(argv=None):
    args = _parse_args(argv)
    sortie = evaluer(args)
    print((sortie / "rapport.md").read_text(encoding="utf-8"))
    print(f"-> {sortie}")


if __name__ == "__main__":
    main()
