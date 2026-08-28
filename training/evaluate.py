"""Évaluation sur le jeu de test gelé — produit `metrics.json`.

Deux familles de chiffres, qui ne répondent pas à la même question :

**Métriques de détection, par classe** (mAP@0.5, mAP@0.5:0.95, précision,
rappel). Elles mesurent la localisation. Elles sont calculées à seuil de
confiance quasi nul — c'est la définition de la mAP, qui intègre toute la courbe
précision/rappel. Rapportées **par classe** : une moyenne globale masquerait
qu'une classe rare est ignorée par le modèle.

**Sensibilité et spécificité au niveau image**, au seuil d'exploitation réel.
La spécificité n'a pas de sens en détection pure — il n'existe pas de « vrai
négatif » sur une boîte qui n'a pas été proposée. Elle en a un dès qu'on pose la
question clinique : *ce cliché présente-t-il au moins une carie ?* On compare
alors présence prédite et présence annotée, cliché par cliché. C'est la lecture
qui intéresse un praticien, et la seule qui rende « spécificité » calculable.

    python training/evaluate.py --weights runs/xxx/weights/best.pt \\
                                --data data/yolo/data.yaml
"""
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from config import CLASSES, git_commit
from train import check_class_order


def _parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--weights", type=Path, required=True)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--split", default="test", choices=("train", "val", "test"),
                   help="test par défaut — le jeu gelé, à n'utiliser qu'une fois")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--conf", type=float, default=0.25,
                   help="seuil d'exploitation pour la sensibilité/spécificité "
                        "image. N'affecte PAS la mAP, calculée sur toute la courbe.")
    p.add_argument("--out", type=Path, default=None,
                   help="défaut : metrics.json à côté des poids")
    return p.parse_args()


def data_root(data_yaml: Path) -> Path:
    for ligne in data_yaml.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("path:"):
            return Path(ligne.split("path:", 1)[1].strip())
    return data_yaml.parent


def _ratio(numerateur: int, denominateur: int):
    """None plutôt que 0 quand le dénominateur est vide : l'absence de mesure
    n'est pas une mesure à zéro."""
    return round(numerateur / denominateur, 4) if denominateur else None


def detection_metrics(modele, args) -> dict:
    """mAP par classe. Aucun seuil de confiance imposé : c'est la définition."""
    resultats = modele.val(data=str(args.data.resolve()), split=args.split,
                           imgsz=args.imgsz, verbose=False)
    box = resultats.box
    presentes = {int(c): i for i, c in enumerate(box.ap_class_index)}

    par_classe = {}
    for index, nom in enumerate(CLASSES):
        if index not in presentes:
            par_classe[nom] = None      # classe absente du jeu de test
            continue
        precision, rappel, ap50, ap = box.class_result(presentes[index])
        par_classe[nom] = {
            "precision": round(float(precision), 4),
            "rappel": round(float(rappel), 4),
            "mAP50": round(float(ap50), 4),
            "mAP50_95": round(float(ap), 4),
        }
    return {
        "global": {
            "precision": round(float(box.mp), 4),
            "rappel": round(float(box.mr), 4),
            "mAP50": round(float(box.map50), 4),
            "mAP50_95": round(float(box.map), 4),
        },
        "par_classe": par_classe,
    }


def image_level_metrics(modele, args) -> dict:
    """Présence prédite vs présence annotée, un cliché à la fois."""
    racine = data_root(args.data)
    images_dir = racine / args.split / "images"
    labels_dir = racine / args.split / "labels"
    if not images_dir.is_dir():
        raise SystemExit(f"partition introuvable : {images_dir}")

    compteurs = defaultdict(lambda: {"tp": 0, "fp": 0, "tn": 0, "fn": 0})
    n_images = 0

    for resultat in modele.predict(source=str(images_dir), imgsz=args.imgsz,
                                   conf=args.conf, verbose=False, stream=True):
        n_images += 1
        chemin = Path(resultat.path)
        fichier_label = labels_dir / f"{chemin.stem}.txt"
        annotees = set()
        if fichier_label.exists():
            annotees = {int(l.split()[0]) for l in
                        fichier_label.read_text(encoding="utf-8").splitlines() if l.strip()}
        predites = {int(c) for c in resultat.boxes.cls.tolist()}

        for index, nom in enumerate(CLASSES):
            attendu, obtenu = index in annotees, index in predites
            cle = "tp" if (attendu and obtenu) else \
                  "fn" if attendu else \
                  "fp" if obtenu else "tn"
            compteurs[nom][cle] += 1

    return {
        "n_images": n_images,
        "seuil_confiance": args.conf,
        "par_classe": {
            nom: {**c,
                  "sensibilite": _ratio(c["tp"], c["tp"] + c["fn"]),
                  "specificite": _ratio(c["tn"], c["tn"] + c["fp"])}
            for nom, c in compteurs.items()
        },
    }


def report(metrics: dict) -> None:
    largeur = max(len(c) for c in CLASSES)
    detection = metrics["detection"]["par_classe"]
    image = metrics["niveau_image"]["par_classe"]

    entete = ("classe".ljust(largeur) + "   mAP50 mAP50-95  precis.  rappel"
              "   sensib.  specif.")
    print("\n" + entete)
    print("-" * len(entete))
    for nom in CLASSES:
        d, i = detection.get(nom), image.get(nom, {})
        if d is None:
            print(nom.ljust(largeur) + "   ABSENTE DU JEU DE TEST")
            continue
        def f(v):
            return "   -   " if v is None else f"{v:>7.3f}"
        print(nom.ljust(largeur) + " " + " ".join(f(v) for v in (
            d["mAP50"], d["mAP50_95"], d["precision"], d["rappel"],
            i.get("sensibilite"), i.get("specificite"))))
    print("-" * len(entete))
    g = metrics["detection"]["global"]
    print(f"{'GLOBAL'.ljust(largeur)} {g['mAP50']:>7.3f} {g['mAP50_95']:>7.3f} "
          f"{g['precision']:>7.3f} {g['rappel']:>7.3f}")

    absentes = [n for n, d in detection.items() if d is None]
    if absentes:
        print(f"\n[!] Classes absentes du jeu de test : {', '.join(absentes)}. "
              "Aucune conclusion ne peut être tirée à leur sujet.")


def main():
    args = _parse_args()
    check_class_order(args.data)

    from ultralytics import YOLO

    modele = YOLO(str(args.weights))
    metrics = {
        "date_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "poids": str(args.weights),
        "data_yaml": str(args.data.resolve()),
        "split": args.split,
        "imgsz": args.imgsz,
        "classes": CLASSES,
        "detection": detection_metrics(modele, args),
        "niveau_image": image_level_metrics(modele, args),
    }

    sortie = args.out or args.weights.parent / "metrics.json"
    sortie.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    report(metrics)
    print(f"\n-> {sortie}")
    print(f"\nÉtape suivante :\n"
          f"  python training/publish_model.py --version <nom> --dataset <jeu> "
          f"--metrics {sortie} --weights {args.weights} --install")


if __name__ == "__main__":
    main()
