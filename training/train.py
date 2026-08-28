"""Entraînement YOLOv11 sur le dataset préparé.

Fin volontairement : ultralytics fait le travail. Ce script n'ajoute que ce qui
manque pour qu'un entraînement soit **défendable** :

- une vérification que l'ordre des classes du `data.yaml` correspond exactement
  à `CLASSES` — un décalage d'un cran rendrait toutes les prédictions fausses
  sans qu'aucune erreur ne se déclenche ;
- une graine fixe et le mode déterministe ;
- un `run.json` qui consigne hyperparamètres, empreinte git et ordre des classes,
  pour que le run soit rejouable et traçable dans `model_versions`.

    python training/train.py --data data/yolo/data.yaml --epochs 100 --device 0
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from config import CLASSES, git_commit


def _parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, required=True, help="data.yaml produit par prepare_dataset.py")
    p.add_argument("--model", default="yolo11n.pt",
                   help="poids de départ. n/s/m/l/x : commencer par n sur un T4.")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--imgsz", type=int, default=640,
                   help="DOIT correspondre à MODEL_IMAGE_SIZE du service d'inférence")
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--patience", type=int, default=20, help="arrêt anticipé")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="0", help="'0' pour GPU, 'cpu' sinon")
    p.add_argument("--project", type=Path, default=Path("runs"))
    p.add_argument("--name", default=None, help="nom du run (défaut : horodaté)")
    return p.parse_args()


def read_class_names(data_yaml: Path) -> list[str]:
    """Lit `names:` sans dépendre de pyyaml — le format est produit par nos soins."""
    for ligne in data_yaml.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("names:"):
            return json.loads(ligne.split("names:", 1)[1].strip())
    raise SystemExit(f"{data_yaml} ne déclare pas de champ 'names:'")


def check_class_order(data_yaml: Path) -> None:
    noms = read_class_names(data_yaml)
    if noms != CLASSES:
        raise SystemExit(
            "ORDRE DES CLASSES INCOHÉRENT — entraînement refusé.\n"
            f"  data.yaml : {noms}\n"
            f"  attendu   : {CLASSES}\n"
            "Le service d'inférence mappe l'index prédit sur sa propre liste : "
            "un décalage produirait des diagnostics faux sans lever d'erreur. "
            "Régénérer le dataset avec prepare_dataset.py."
        )


def main():
    args = _parse_args()
    check_class_order(args.data)

    from ultralytics import YOLO   # import tardif : le contrôle ci-dessus est gratuit

    nom = args.name or f"panoradent-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    modele = YOLO(args.model)
    modele.train(
        data=str(args.data.resolve()),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        seed=args.seed,
        deterministic=True,
        device=args.device,
        project=str(args.project),
        name=nom,
        exist_ok=False,
    )

    run_dir = args.project / nom
    (run_dir / "run.json").write_text(json.dumps({
        "date_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "classes": CLASSES,
        "modele_initial": args.model,
        "hyperparametres": {
            "epochs": args.epochs, "imgsz": args.imgsz, "batch": args.batch,
            "patience": args.patience, "seed": args.seed, "device": args.device,
        },
        "data_yaml": str(args.data.resolve()),
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    poids = run_dir / "weights" / "best.pt"
    print(f"\nPoids : {poids}")
    print(f"Run   : {run_dir / 'run.json'}")
    print(f"\nÉtape suivante :\n"
          f"  python training/evaluate.py --weights {poids} --data {args.data}")


if __name__ == "__main__":
    main()
