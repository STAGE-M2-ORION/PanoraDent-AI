"""Entraînement YOLO11 sur un jeu préparé par prepare_dataset.py.

Ultralytics fait le travail. Ce script ajoute ce qui manque pour qu'un
entraînement soit **défendable** et **reprenable** :

- refus de démarrer si l'ordre des classes du `data.yaml` n'est pas celui du
  contrat (`CLASSES`) ou des rangs (`CLASSES_RANGS`, sprint 7)
  (un décalage d'un cran rendrait toutes les prédictions fausses en silence) ;
- nos augmentations (`augmentations.py`), jamais de retournement vertical ;
- graine fixe et mode déterministe ;
- `run.json` écrit **dès le départ** : hyperparamètres, empreinte git,
  **empreinte du découpage** (lue dans `split.json`), versions, carte utilisée ;
- `journal.jsonl` : une ligne par époque (pertes, mesures de validation, taux
  d'apprentissage, durée) ;
- **reprise** après interruption : `--reprendre runs/<nom>/weights/last.pt`
  repart de l'époque suivante, avec l'optimiseur et la moyenne mobile.

Machine de développement (GTX 1650, 4 Go) — les défauts lui sont réglés :

    python training/train.py --data data/yolo/<jeu>/data.yaml --name <nom>

Reprise après coupure :

    python training/train.py --reprendre runs/<nom>/weights/last.pt
"""
import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import augmentations
from config import CLASSES, LISTES_ADMISES, git_commit

JOURNAL = "journal.jsonl"
RUN = "run.json"


def _parse_args(argv=None):
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, help="data.yaml produit par prepare_dataset.py")
    p.add_argument("--reprendre", type=Path, default=None,
                   help="last.pt d'un entraînement interrompu ; les autres options sont ignorées")
    p.add_argument("--model", default="yolo11s.pt",
                   help="poids de départ (préentraînés COCO) ou fichier .yaml (depuis zéro)")
    p.add_argument("--epochs", type=int, default=150)
    p.add_argument("--imgsz", type=int, default=1024,
                   help="DOIT correspondre à MODEL_IMAGE_SIZE du service d'inférence")
    p.add_argument("--batch", type=int, default=2,
                   help="yolo11s en 1024 px, sans précision mixte : 2 tient dans 4 Go "
                        "(2,45 Go mesurés) ; 4 déborde (5,1 Go) et rend l'époque deux fois "
                        "plus longue")
    p.add_argument("--patience", type=int, default=30, help="arrêt anticipé, en époques")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="0", help="'0' pour la première carte NVIDIA, 'cpu' sinon")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--amp", choices=("auto", "oui", "non"), default="auto",
                   help="précision mixte. 'auto' : coupée sur les cartes connues pour produire "
                        "des pertes NaN (GTX 16xx), activée ailleurs")
    p.add_argument("--contraste", type=float, default=augmentations.CONTRASTE)
    p.add_argument("--plots", action=argparse.BooleanOptionalAction, default=True,
                   help="courbes et matrices d'ultralytics (télécharge une police au premier usage)")
    p.add_argument("--project", type=Path, default=Path("runs"))
    p.add_argument("--name", default=None, help="nom du run (défaut : horodaté)")
    args = p.parse_args(argv)
    if args.reprendre is None and args.data is None:
        p.error("--data est obligatoire, sauf avec --reprendre")
    return args


def read_class_names(data_yaml: Path) -> list[str]:
    """Lit `names:` sans dépendre de pyyaml — le format est produit par nos soins."""
    for ligne in data_yaml.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("names:"):
            return json.loads(ligne.split("names:", 1)[1].strip())
    raise SystemExit(f"{data_yaml} ne déclare pas de champ 'names:'")


def check_class_order(data_yaml: Path) -> None:
    noms = read_class_names(data_yaml)
    if noms not in LISTES_ADMISES:
        raise SystemExit(
            "ORDRE DES CLASSES INCOHÉRENT — entraînement refusé.\n"
            f"  data.yaml : {noms}\n"
            f"  attendu   : {' ou '.join(map(str, LISTES_ADMISES))}\n"
            "Le service d'inférence mappe l'index prédit sur sa propre liste : "
            "un décalage produirait des diagnostics faux sans lever d'erreur. "
            "Régénérer le dataset avec prepare_dataset.py."
        )


def lire_decoupage(data_yaml: Path) -> dict:
    """Empreinte et graine du découpage, conservées avec le modèle."""
    chemin = data_yaml.parent / "split.json"
    if not chemin.exists():
        raise SystemExit(f"{chemin} introuvable : sans lui, le découpage n'est pas traçable.")
    split = json.loads(chemin.read_text(encoding="utf-8"))
    if not split.get("empreinte"):
        raise SystemExit(f"{chemin} ne porte pas d'empreinte : régénérer avec prepare_dataset.py.")
    return {"empreinte": split["empreinte"], "graine": split.get("graine"),
            "fichier": str(chemin.resolve())}


def _versions(device: str) -> dict:
    import torch
    import ultralytics
    carte = None
    if device != "cpu" and torch.cuda.is_available():
        carte = torch.cuda.get_device_name(0)
    return {"ultralytics": ultralytics.__version__, "torch": torch.__version__,
            "cuda": torch.version.cuda, "carte": carte}


#: Cartes sur lesquelles la précision mixte produit des pertes NaN, alors que
#: le test d'AMP d'ultralytics passe (constaté sur GTX 1650, 2026-11-22).
CARTES_SANS_AMP = ("GTX 16",)


class PerteNonFinie(RuntimeError):
    """Perte NaN ou infinie : l'entraînement ne mènerait à rien."""


def resoudre_amp(choix: str, carte: str | None) -> bool:
    if choix != "auto":
        return choix == "oui"
    return not (carte and any(motif in carte for motif in CARTES_SANS_AMP))


def _nombre(v, chiffres: int):
    """Arrondi, ou None si la valeur n'est pas finie (NaN n'est pas du JSON)."""
    v = float(v)
    return round(v, chiffres) if math.isfinite(v) else None


def _ligne_journal(trainer) -> dict:
    pertes = trainer.label_loss_items(trainer.tloss, prefix="train")
    return {
        "epoque": trainer.epoch + 1,
        "epoques": trainer.epochs,
        "horodatage_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duree_s": round(float(getattr(trainer, "epoch_time", 0) or 0), 1),
        "pertes": {k: _nombre(v, 5) for k, v in pertes.items()},
        "mesures": {k: _nombre(v, 5) for k, v in (trainer.metrics or {}).items()},
        "lr": {k: _nombre(v, 7) for k, v in (trainer.lr or {}).items()},
        "fitness": None if trainer.fitness is None else _nombre(trainer.fitness, 5),
    }


def ajouter_garde_nan(modele) -> None:
    """Arrête l'entraînement au premier lot dont la perte n'est pas finie."""
    def verifier(trainer):
        if trainer.tloss is not None and not bool(trainer.tloss.isfinite().all()):
            raise PerteNonFinie(
                f"perte non finie à l'époque {trainer.epoch + 1} : entraînement arrêté. "
                f"Relancer avec --amp non (précision mixte instable sur cette carte).")
    modele.add_callback("on_train_batch_end", verifier)


def _derniere_epoque(journal: Path) -> int:
    if not journal.exists():
        return 0
    lignes = journal.read_text(encoding="utf-8").splitlines()
    return json.loads(lignes[-1])["epoque"] if lignes else 0


def ajouter_journal(modele) -> None:
    """Une ligne JSON par époque terminée, ajoutée (jamais réécrite).

    En fin d'entraînement, ultralytics réévalue `best.pt` sur la validation et
    redéclenche le même événement pour une époque déjà journalisée : ces mesures
    sont celles du modèle retenu, elles vont dans `run.json`
    (`validation_meilleur`) et non dans le journal.
    """
    def ecrire(trainer):
        run_dir = Path(trainer.save_dir)
        journal = run_dir / JOURNAL
        ligne = _ligne_journal(trainer)
        if ligne["epoque"] <= _derniere_epoque(journal):
            meta = json.loads((run_dir / RUN).read_text(encoding="utf-8"))
            meta["validation_meilleur"] = ligne["mesures"]
            (run_dir / RUN).write_text(json.dumps(meta, indent=2, ensure_ascii=False),
                                       encoding="utf-8")
            return
        with journal.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    modele.add_callback("on_fit_epoch_end", ecrire)


def entrainer(args, rappels: dict | None = None) -> Path:
    """Lance ou reprend l'entraînement ; renvoie le dossier du run.

    `rappels` : {événement ultralytics: fonction}, ajoutés après le journal
    (les tests s'en servent pour simuler une coupure).
    """
    from ultralytics import YOLO

    from entraineur import EntraineurPanoradent

    augmentations.CONTRASTE = args.contraste
    augmentations.verifier_hyperparametres(augmentations.HYPERPARAMETRES)

    if args.reprendre:
        if not args.reprendre.exists():
            raise SystemExit(f"{args.reprendre} introuvable")
        run_dir = args.reprendre.parent.parent
        meta = json.loads((run_dir / RUN).read_text(encoding="utf-8"))
        augmentations.CONTRASTE = meta["hyperparametres"].get("contraste", augmentations.CONTRASTE)
        meta.setdefault("reprises", []).append(
            datetime.now(timezone.utc).isoformat(timespec="seconds"))
        (run_dir / RUN).write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        modele = YOLO(str(args.reprendre))
        ajouter_journal(modele)
        ajouter_garde_nan(modele)
        for evenement, fonction in (rappels or {}).items():
            modele.add_callback(evenement, fonction)
        debut = time.time()
        modele.train(resume=True, trainer=EntraineurPanoradent)
        _terminer(run_dir, debut)
        return run_dir

    check_class_order(args.data)
    decoupage = lire_decoupage(args.data)
    nom = args.name or f"panoradent-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    run_dir = (args.project / nom).resolve()
    if run_dir.exists():
        raise SystemExit(f"{run_dir} existe déjà : choisir un autre --name, ou --reprendre.")

    versions = _versions(args.device)
    amp = resoudre_amp(args.amp, versions["carte"])
    hyp = {"epochs": args.epochs, "imgsz": args.imgsz, "batch": args.batch,
           "patience": args.patience, "seed": args.seed, "device": args.device,
           "amp": amp, "amp_demande": args.amp, "contraste": args.contraste,
           "augmentations": augmentations.HYPERPARAMETRES}
    run_dir.mkdir(parents=True)
    (run_dir / RUN).write_text(json.dumps({
        "debut_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "classes": read_class_names(args.data),
        "modele_initial": args.model,
        "data_yaml": str(args.data.resolve()),
        "decoupage": decoupage,
        "hyperparametres": hyp,
        "versions": versions,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    if args.amp == "auto" and not amp and versions["carte"]:
        print(f"Précision mixte coupée sur {versions['carte']} (pertes NaN connues). "
              f"--amp oui pour la forcer.")

    modele = YOLO(args.model)
    ajouter_journal(modele)
    ajouter_garde_nan(modele)
    for evenement, fonction in (rappels or {}).items():
        modele.add_callback(evenement, fonction)

    debut = time.time()
    modele.train(
        trainer=EntraineurPanoradent,
        data=str(args.data.resolve()),
        epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, patience=args.patience,
        seed=args.seed, deterministic=True, device=args.device, workers=args.workers,
        amp=amp, plots=args.plots,
        project=str(run_dir.parent), name=run_dir.name, exist_ok=True,
        **augmentations.HYPERPARAMETRES,
    )
    _terminer(run_dir, debut)
    return run_dir


def _terminer(run_dir: Path, debut: float) -> None:
    meta = json.loads((run_dir / RUN).read_text(encoding="utf-8"))
    meta["fin_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["duree_derniere_session_s"] = round(time.time() - debut)
    (run_dir / RUN).write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")


def main(argv=None):
    args = _parse_args(argv)
    run_dir = entrainer(args)
    poids = run_dir / "weights" / "best.pt"
    print(f"\nPoids   : {poids}")
    print(f"Run     : {run_dir / RUN}")
    print(f"Journal : {run_dir / JOURNAL}")
    print("\nÉtape suivante (validation pendant les réglages, le test UNE fois à la fin) :\n"
          f"  python training/evaluate.py --weights {poids} --split val")


if __name__ == "__main__":
    main()
