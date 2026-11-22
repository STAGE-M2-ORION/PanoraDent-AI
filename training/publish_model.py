"""Publication d'une version : une PAIRE de modèles (dents + anomalies).

Le registre de la plateforme (`model_versions`) et le dossier des poids du
service d'inférence reçoivent ensemble :

- les deux fichiers `best.pt`, copiés sous `<poids>/<version>/dents.pt` et
  `anomalies.pt`, avec leur empreinte sha256 — le service d'inférence la
  vérifie au chargement : un fichier remplacé après publication est refusé ;
- l'empreinte du découpage (identique pour les deux modèles, sinon refus :
  un modèle mesuré sur des clichés que l'autre a appris fausserait tout) ;
- les mesures : celles du test interne de chaque modèle, et le test externe
  s'il a été évalué. Un résumé à plat (`map50`, `precision`, `recall`,
  `test_images`, ceux du modèle anomalies) alimente l'écran de performance.

Une version publiée ne change plus : publier deux fois le même nom est
refusé, sauf si les fichiers sont exactement les mêmes (reprise après une
publication interrompue). **La publication n'active rien** : la bascule se
fait depuis l'administration, après chargement vérifié par le service.

    python training/publish_model.py --version dentex-2026.11 \\
        --dents runs/dents-v1 --anomalies runs/anomalies-v1 \\
        --database-url postgresql+psycopg2://panoradent:<mot de passe>@localhost:5433/panoradent
"""
import argparse
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import CLASSES, CLASSES_RANGS, REPO_ROOT

DOSSIER_POIDS = REPO_ROOT / "inference" / "weights"
VERSION_VALIDE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")   # = service d'inférence
ROLES = ("dents", "anomalies")


class PublicationRefusee(SystemExit):
    pass


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", required=True, help="nom de la version (nom de dossier)")
    p.add_argument("--dents", type=Path, required=True, help="dossier du run du modèle dents")
    p.add_argument("--anomalies", type=Path, required=True, help="dossier du run du modèle anomalies")
    p.add_argument("--dataset", default="DENTEX (Hugging Face 7b27ccc), CC BY-NC-SA 4.0")
    p.add_argument("--notes", default="")
    p.add_argument("--partition", choices=("test", "val"), default="test",
                   help="mesures publiées : le test interne (défaut), ou la validation pour un essai")
    p.add_argument("--poids", type=Path, default=DOSSIER_POIDS, help="dossier des poids du service")
    p.add_argument("--sans-base", action="store_true", help="copier les poids sans écrire en base")
    p.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    return p.parse_args(argv)


def sha256_de(chemin: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def lire_run(run_dir: Path, partition: str, admises=(CLASSES,)) -> dict:
    """Poids, run.json et mesures d'un run ; refus explicite s'il manque quelque chose."""
    poids = run_dir / "weights" / "best.pt"
    run_json = run_dir / "run.json"
    mesures = run_dir / f"evaluation_{partition}" / "metrics.json"
    for chemin, quoi in ((poids, "les poids"), (run_json, "run.json"), (mesures, "les mesures")):
        if not chemin.is_file():
            raise PublicationRefusee(f"{run_dir} : {quoi} manquent ({chemin}).")
    run = json.loads(run_json.read_text(encoding="utf-8"))
    metrics = json.loads(mesures.read_text(encoding="utf-8"))
    for source, classes in (("run.json", run.get("classes")), ("metrics.json", metrics.get("classes"))):
        if classes not in admises:
            raise PublicationRefusee(
                f"{run_dir} : {source} porte un autre ordre de classes ({classes}) que {' ou '.join(map(str, admises))}.")
    externe = next(run_dir.glob("evaluation_externe_*/metrics.json"), None)
    return {"poids": poids, "run": run, "metrics": metrics,
            "externe": json.loads(externe.read_text(encoding="utf-8")) if externe else None}


def resume(metrics_anomalies: dict) -> dict:
    g = metrics_anomalies["detection"]["global"]
    return {"map50": g["mAP50"], "precision": g["precision"], "recall": g["rappel"],
            "test_images": metrics_anomalies["niveau_image"]["n_images"]}


def preparer(args) -> dict:
    """Vérifications et ligne à écrire ; aucune écriture."""
    if not VERSION_VALIDE.match(args.version):
        raise PublicationRefusee(f"Nom de version invalide : {args.version!r} (lettres, chiffres, . _ -).")
    # Le modèle dents peut être un modèle « rangs » (sprint 7, numérotation hybride).
    admises = {"dents": (CLASSES, CLASSES_RANGS), "anomalies": (CLASSES,)}
    runs = {role: lire_run(getattr(args, role), args.partition, admises[role]) for role in ROLES}
    empreintes = {role: r["run"].get("decoupage", {}).get("empreinte") for role, r in runs.items()}
    if None in empreintes.values() or len(set(empreintes.values())) != 1:
        raise PublicationRefusee(
            f"Les deux modèles n'ont pas été entraînés sur le même découpage : {empreintes}.")
    sha = {role: sha256_de(r["poids"]) for role, r in runs.items()}
    metrics = {
        **resume(runs["anomalies"]["metrics"]),
        "partition": args.partition,
        "dents": runs["dents"]["metrics"],
        "anomalies": runs["anomalies"]["metrics"],
        "externe": runs["anomalies"]["externe"],
        "runs": {role: {"dossier": str(getattr(args, role)), "git_commit": r["run"].get("git_commit"),
                        "hyperparametres": r["run"].get("hyperparametres")} for role, r in runs.items()},
    }
    return {"runs": runs, "sha": sha, "empreinte": empreintes["dents"], "metrics": metrics}


def deposer_poids(args, prep: dict) -> dict:
    """Copie les deux fichiers ; une version existante n'est jamais écrasée."""
    dossier = args.poids / args.version
    chemins = {}
    for role in ROLES:
        cible = dossier / f"{role}.pt"
        if cible.exists():
            if sha256_de(cible) != prep["sha"][role]:
                raise PublicationRefusee(
                    f"{cible} existe avec d'autres poids : une version publiée ne change plus. "
                    "Choisir un autre nom de version.")
        else:
            dossier.mkdir(parents=True, exist_ok=True)
            shutil.copy2(prep["runs"][role]["poids"], cible)
        chemins[role] = f"{args.version}/{role}.pt"
    return chemins


def ecrire_registre(args, prep: dict, chemins: dict) -> None:
    from sqlalchemy import create_engine, text

    if not args.database_url:
        raise PublicationRefusee("--database-url (ou DATABASE_URL) manquant ; --sans-base pour ne copier que les poids.")
    engine = create_engine(args.database_url, pool_pre_ping=True)
    with engine.begin() as cx:
        existante = cx.execute(text(
            "SELECT sha256_dents, sha256_anomalies FROM model_versions WHERE version = :v"),
            {"v": args.version}).first()
        if existante is not None:
            if tuple(existante) != (prep["sha"]["dents"], prep["sha"]["anomalies"]):
                raise PublicationRefusee(f"La version {args.version} est déjà publiée avec d'autres poids.")
            print(f"[base] {args.version} déjà publiée avec ces poids : rien à faire")
            return
        cx.execute(text(
            "INSERT INTO model_versions (id, version, created_at, dataset, metrics_json, notes, "
            "poids_dents, poids_anomalies, sha256_dents, sha256_anomalies, empreinte_decoupage, actif) "
            "VALUES (:id, :version, :created_at, :dataset, :metrics, :notes, :pd, :pa, :sd, :sa, :emp, :actif)"), {
            "id": str(uuid.uuid4()), "version": args.version,
            "created_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "dataset": args.dataset, "metrics": json.dumps(prep["metrics"], ensure_ascii=False),
            "notes": args.notes, "pd": chemins["dents"], "pa": chemins["anomalies"],
            "sd": prep["sha"]["dents"], "sa": prep["sha"]["anomalies"],
            "emp": prep["empreinte"], "actif": False,
        })
    print(f"[base] model_versions <- {args.version} (non active)")


def main(argv=None):
    args = _parse_args(argv)
    prep = preparer(args)
    chemins = deposer_poids(args, prep)
    print(f"[poids] {args.poids / args.version}")
    if args.sans_base:
        print("[base] écriture ignorée (--sans-base)")
    else:
        ecrire_registre(args, prep, chemins)
    r = prep["metrics"]
    print(f"\nModèle anomalies, {args.partition} : mAP@0,50 {r['map50']} · précision {r['precision']} "
          f"· rappel {r['recall']} · {r['test_images']} clichés")
    print("\nÉtape suivante : Administration › Modèles › Activer (motif obligatoire).")


if __name__ == "__main__":
    main()
