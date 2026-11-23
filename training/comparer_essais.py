"""Tableau comparatif des essais d'entraînement, sur la VALIDATION seulement.

Le modèle retenu se choisit ici, sur la validation : le test n'est évalué
qu'ensuite, une fois, pour le seul modèle retenu (evaluate.py --split test).
Ce script refuse donc de lire une évaluation du test.

Pour chaque run : réglages (modèle de départ, taille d'image, rééquilibrage),
durée d'entraînement, mAP@0,50 et rappel par classe, rappel des petites lésions
(< 32 px à l'entrée du modèle), et, avec --temps-cpu N, le temps médian
d'analyse d'un cliché sur le processeur (ce que vivra le serveur du cabinet).

    python training/evaluate.py --weights runs/<essai>/weights/best.pt --split val
    python training/comparer_essais.py runs/anomalies-v1 runs/anomalies-e1 ... --temps-cpu 10
"""
import argparse
import json
import statistics
import time
from pathlib import Path

PETITES = ("< 16 px", "16–32 px")


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("runs", type=Path, nargs="+", help="dossiers des runs (runs/<nom>)")
    p.add_argument("--temps-cpu", type=int, default=0, metavar="N",
                   help="mesure l'analyse de N clichés de validation sur le processeur")
    p.add_argument("--out", type=Path, default=None, help="fichier markdown (défaut : stdout seulement)")
    return p.parse_args(argv)


def lire_essai(run_dir: Path) -> dict:
    """Réglages et mesures de validation d'un run."""
    evaluation = run_dir / "evaluation_val" / "metrics.json"
    if not evaluation.exists():
        raise SystemExit(f"{evaluation} absent : lancer d'abord evaluate.py --split val sur ce run.")
    m = json.loads(evaluation.read_text(encoding="utf-8"))
    if m.get("split") != "val":
        raise SystemExit(f"{evaluation} : partition « {m.get('split')} », la comparaison se fait sur la validation.")
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    hyp = run.get("hyperparametres", {})
    petites = {}
    for nom, cases in m["detection"].get("rappel_par_taille", {}).get("par_classe", {}).items():
        n = sum(c["n"] for c in cases if c["tranche"] in PETITES)
        k = sum(c["trouvees"] for c in cases if c["tranche"] in PETITES)
        petites[nom] = (k, n)
    return {
        "nom": run_dir.name,
        "modele": Path(run.get("modele_initial", "?")).stem,
        "imgsz": hyp.get("imgsz"),
        "reequilibrage": hyp.get("reequilibrage", 0.0),
        "duree_h": round(run["duree_derniere_session_s"] / 3600, 1) if run.get("duree_derniere_session_s") else None,
        "global": m["detection"]["global"],
        "par_classe": {k: v for k, v in m["detection"]["par_classe"].items() if v},
        "petites": petites,
        "decoupage": (m.get("decoupage") or {}).get("empreinte"),
        "poids": run_dir / "weights" / "best.pt",
    }


def temps_cpu(poids: Path, images: list[Path], imgsz: int) -> float:
    """Médiane, en secondes, de l'analyse d'un cliché sur le processeur (après une passe de chauffe)."""
    from ultralytics import YOLO

    modele = YOLO(str(poids))
    modele.predict(str(images[0]), imgsz=imgsz, device="cpu", verbose=False)
    durees = []
    for image in images:
        debut = time.perf_counter()
        modele.predict(str(image), imgsz=imgsz, device="cpu", verbose=False)
        durees.append(time.perf_counter() - debut)
    return statistics.median(durees)


def images_de_validation(run_dir: Path, n: int) -> list[Path]:
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    data = Path(run["data_yaml"])
    racine = data.parent
    for ligne in data.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("path:"):
            racine = Path(ligne.split("path:", 1)[1].strip())
    return sorted((racine / "val" / "images").glob("*"))[:n]


def tableau(essais: list[dict]) -> str:
    def f(v):
        return "—" if v is None else f"{v:.3f}"

    empreintes = {e["decoupage"] for e in essais}
    classes = [c for c in essais[0]["par_classe"]]
    meilleur = max(essais, key=lambda e: e["global"]["mAP50"])
    lignes = ["# Comparaison des essais — validation", ""]
    if len(empreintes) > 1:
        lignes += ["**Attention : découpages différents, comparaison invalide** : "
                   + ", ".join(sorted(str(x) for x in empreintes)), ""]
    entete = ["essai", "départ", "px", "rééq.", "durée (h)", "mAP@0,50"] + [f"{c} mAP / rappel" for c in classes] \
        + ["petites lésions trouvées"] + (["CPU (s/cliché)"] if any("cpu_s" in e for e in essais) else [])
    lignes += ["| " + " | ".join(entete) + " |", "|" + "---|" * len(entete)]
    for e in essais:
        k = sum(a for a, _ in e["petites"].values())
        n = sum(b for _, b in e["petites"].values())
        cellules = [f"**{e['nom']}**" if e is meilleur else e["nom"], e["modele"], str(e["imgsz"]),
                    str(e["reequilibrage"] or "—"), "—" if e["duree_h"] is None else str(e["duree_h"]),
                    f(e["global"]["mAP50"])]
        for c in classes:
            d = e["par_classe"].get(c)
            cellules.append("—" if d is None else f"{f(d['mAP50'])} / {f(d['rappel'])}")
        cellules.append(f"{k}/{n}" if n else "—")
        if "cpu_s" in e:
            cellules.append(f"{e['cpu_s']:.2f}")
        lignes.append("| " + " | ".join(cellules) + " |")
    lignes += ["", f"En gras : meilleur mAP@0,50 global sur la validation ({meilleur['nom']}). "
               "Le choix se fait ici ; le test n'est évalué qu'ensuite, une fois, pour ce seul modèle.",
               "Petites lésions : côté < 32 px dans l'image vue par le modèle, toutes classes d'anomalies.", ""]
    return "\n".join(lignes)


def main(argv=None):
    args = _parse_args(argv)
    essais = [lire_essai(r) for r in args.runs]
    if args.temps_cpu:
        images = images_de_validation(args.runs[0], args.temps_cpu)
        for e in essais:
            e["cpu_s"] = temps_cpu(e["poids"], images, e["imgsz"])
    texte = tableau(essais)
    print(texte)
    if args.out:
        args.out.write_text(texte, encoding="utf-8")
        print(f"-> {args.out}")


if __name__ == "__main__":
    main()
