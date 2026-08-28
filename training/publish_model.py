"""Publication d'un modèle : table `model_versions` + dépôt des poids.

C'est le chaînon manquant entre le travail scientifique et la plateforme. La
table `model_versions` et la route `GET /api/model/versions` existent depuis le
premier jour et **n'ont jamais été alimentées** : rien n'écrivait dedans. Ce
script est ce qui écrit dedans.

    python training/publish_model.py \\
        --version yolov11n-dentex-2026.09 \\
        --dataset "DENTEX disease, split patient 70/15/15, graine 42" \\
        --metrics runs/xxx/weights/metrics.json \\
        --weights runs/xxx/weights/best.pt \\
        --install

`--install` copie les poids dans `inference/weights/model.pt`. Depuis Colab, la
base n'est pas joignable : utiliser `--skip-db` là-bas, puis rejouer le script
en local sur la machine qui héberge la stack.
"""
import argparse
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import CLASSES, WEIGHTS_TARGET

UPSERT = """
INSERT INTO model_versions (id, version, created_at, dataset, metrics_json, notes)
VALUES (:id, :version, :created_at, :dataset, :metrics_json, :notes)
ON CONFLICT (version) DO UPDATE SET
    created_at   = EXCLUDED.created_at,
    dataset      = EXCLUDED.dataset,
    metrics_json = EXCLUDED.metrics_json,
    notes        = EXCLUDED.notes
"""


def _parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", required=True,
                   help="identifiant du modèle, ex. yolov11n-dentex-2026.09. "
                        "Doit être reporté dans MODEL_VERSION du .env.")
    p.add_argument("--dataset", required=True,
                   help="jeu ET découpage utilisés — la traçabilité l'exige")
    p.add_argument("--metrics", type=Path, required=True,
                   help="metrics.json produit par evaluate.py")
    p.add_argument("--weights", type=Path, help="best.pt à installer")
    p.add_argument("--notes", default="", help="commentaire libre")
    p.add_argument("--install", action="store_true",
                   help=f"copie les poids vers {WEIGHTS_TARGET}")
    p.add_argument("--skip-db", action="store_true",
                   help="n'écrit pas en base (ex. depuis Colab)")
    p.add_argument("--database-url",
                   default=os.getenv(
                       "DATABASE_URL",
                       "postgresql+psycopg2://panoradent:panoradent@localhost:5432/panoradent"))
    return p.parse_args()


def load_metrics(path: Path) -> dict:
    metrics = json.loads(path.read_text(encoding="utf-8"))
    classes = metrics.get("classes")
    if classes and classes != CLASSES:
        raise SystemExit(
            "Le fichier de métriques a été produit avec un autre ordre de classes.\n"
            f"  metrics.json : {classes}\n"
            f"  attendu      : {CLASSES}\n"
            "Publier ces chiffres les rattacherait aux mauvaises classes."
        )
    return metrics


def write_db(args, metrics: dict) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(args.database_url, pool_pre_ping=True)
    with engine.begin() as connexion:
        connexion.execute(text(UPSERT), {
            "id": str(uuid.uuid4()),
            "version": args.version,
            "created_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "dataset": args.dataset,
            "metrics_json": json.dumps(metrics, ensure_ascii=False),
            "notes": args.notes,
        })
    print(f"[base] model_versions <- {args.version}")


def install(weights: Path) -> None:
    WEIGHTS_TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(weights, WEIGHTS_TARGET)
    taille = WEIGHTS_TARGET.stat().st_size / 1e6
    print(f"[poids] {weights} -> {WEIGHTS_TARGET} ({taille:.1f} Mo)")


def main():
    args = _parse_args()
    metrics = load_metrics(args.metrics)

    if args.install:
        if not args.weights:
            raise SystemExit("--install exige --weights")
        install(args.weights)

    if args.skip_db:
        print("[base] écriture ignorée (--skip-db)")
    else:
        write_db(args, metrics)

    global_ = metrics.get("detection", {}).get("global", {})
    print(f"\nmAP50 {global_.get('mAP50', '?')} · "
          f"mAP50-95 {global_.get('mAP50_95', '?')}")
    print(f"""
Pour servir ce modèle :
  1. .env       MODEL_VERSION={args.version}
                MODEL_STRICT=1        (refuse de retomber en mock silencieusement)
  2. inference/requirements.txt  décommenter ultralytics
     inference/Dockerfile        décommenter le bloc torch
  3. docker compose up --build inference    (le rebuild est obligatoire)
  4. curl http://localhost:8001/health      -> doit répondre "mode":"real"
     curl http://localhost:8000/api/model/versions""")


if __name__ == "__main__":
    main()
