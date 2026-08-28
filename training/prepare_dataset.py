"""COCO vers format YOLO, avec découpage **par patient** et jeu de test gelé.

Deux exigences de la méthodologie de validation (§10.3) sont traitées ici, et
nulle part ailleurs :

1. **Aucune fuite entre partitions.** Le découpage porte sur les *patients*, pas
   sur les images : deux clichés du même patient ne peuvent pas se retrouver
   l'un en entraînement et l'autre en test, ce qui gonflerait artificiellement
   les scores.
2. **Test gelé et reproductible.** L'affectation est écrite dans `split.json`
   avec la graine et les ratios. Rejouer la commande produit exactement le même
   découpage ; relire le fichier permet de le prouver.

Exemple :

    python training/prepare_dataset.py
        --annotations data/dentex/annotations.json
        --images      data/dentex/images
        --out         data/yolo
        --class-map   training/class_map.dentex.json

ATTENTION : la structure des annotations DENTEX est **hiérarchique**
(quadrant, numérotation, diagnostic) et n'a pas pu être vérifiée — aucune donnée
n'était disponible à l'écriture de ce script. `--category-field` désigne le champ
portant la classe ; les catégories non mappées sont comptées et signalées,
jamais ignorées en silence.
"""
import argparse
import json
import random
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from config import CLASSES

SPLITS = ("train", "val", "test")


def _parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--annotations", type=Path, required=True, help="JSON COCO source")
    p.add_argument("--images", type=Path, required=True, help="dossier des images")
    p.add_argument("--out", type=Path, required=True, help="dossier du dataset YOLO")
    p.add_argument("--class-map", type=Path,
                   help="JSON {nom_source: nom_panoradent}. Sans lui, les noms de "
                        "catégories doivent déjà correspondre à CLASSES.")
    p.add_argument("--category-field", default="category_id",
                   help="champ de l'annotation portant la classe "
                        "(DENTEX : category_id_3 pour le diagnostic)")
    p.add_argument("--patient-regex", default=r"^(.*?)(?:_\d+)?$",
                   help="expression sur le nom de fichier, groupe 1 = identifiant "
                        "patient. Par défaut : le nom sans suffixe numérique.")
    p.add_argument("--ratios", type=float, nargs=3, default=(0.70, 0.15, 0.15),
                   metavar=("TRAIN", "VAL", "TEST"))
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--link", action="store_true",
                   help="lier les images au lieu de les copier (économise le disque)")
    return p.parse_args()


def load_class_map(path):
    """Correspondance nom de catégorie source vers nom PanoraDent."""
    if path is None:
        return {c: c for c in CLASSES}
    mapping = {k: v for k, v in json.loads(path.read_text(encoding="utf-8")).items()
               if not k.startswith("_")}
    inconnues = sorted(set(mapping.values()) - set(CLASSES))
    if inconnues:
        raise SystemExit(
            f"class-map : cibles absentes de CLASSES {CLASSES} -> {inconnues}")
    return mapping


def patient_of(file_name: str, pattern) -> str:
    stem = Path(file_name).stem
    match = pattern.match(stem)
    return match.group(1) if match and match.groups() and match.group(1) else stem


def assign_splits(patients, ratios, seed: int) -> dict:
    """Affectation déterministe : tri, puis mélange à graine fixe.

    Le tri préalable est indispensable — sans lui, l'ordre de lecture du JSON
    ferait varier le découpage d'une exécution à l'autre malgré la graine.
    """
    if abs(sum(ratios) - 1.0) > 1e-6:
        raise SystemExit(f"les ratios doivent sommer à 1, reçu {sum(ratios)}")
    ordered = sorted(patients)
    random.Random(seed).shuffle(ordered)
    n = len(ordered)
    n_train = int(n * ratios[0])
    n_val = int(n * ratios[1])

    # Sur un petit nombre de patients, la troncature peut vider une partition
    # (6 patients x 0,15 -> 0). On garantit au moins un patient partout où le
    # ratio est non nul : une validation vide fausse l'early stopping en
    # silence, et un test vide rend la mesure finale impossible.
    if ratios[1] > 0 and n_val == 0 and n - n_train > 1:
        n_val = 1
    if ratios[2] > 0 and n - n_train - n_val == 0 and n_train > 1:
        n_train -= 1

    groupes = {
        "train": ordered[:n_train],
        "val": ordered[n_train:n_train + n_val],
        "test": ordered[n_train + n_val:],
    }
    return {patient: split for split, group in groupes.items() for patient in group}


def yolo_line(cls_index: int, bbox, img_w: int, img_h: int):
    """Ligne YOLO normalisée, ou None si la boîte est inexploitable."""
    x, y, w, h = bbox
    x, y = max(0.0, x), max(0.0, y)
    w, h = min(w, img_w - x), min(h, img_h - y)
    if w <= 1 or h <= 1:
        return None
    cx, cy = (x + w / 2) / img_w, (y + h / 2) / img_h
    return f"{cls_index} {cx:.6f} {cy:.6f} {w / img_w:.6f} {h / img_h:.6f}"


def main():
    args = _parse_args()
    coco = json.loads(args.annotations.read_text(encoding="utf-8"))
    class_map = load_class_map(args.class_map)
    index_of = {name: i for i, name in enumerate(CLASSES)}
    pattern = re.compile(args.patient_regex)

    categories = {c["id"]: c["name"] for c in coco.get("categories", [])}
    images = {img["id"]: img for img in coco["images"]}

    par_image = defaultdict(list)
    non_mappees = Counter()
    ecartees = 0

    for ann in coco.get("annotations", []):
        if ann.get("iscrowd"):
            continue
        source = categories.get(ann.get(args.category_field, ann.get("category_id")))
        cible = class_map.get(source)
        if cible is None:
            non_mappees[source] += 1
            continue
        img = images[ann["image_id"]]
        ligne = yolo_line(index_of[cible], ann["bbox"], img["width"], img["height"])
        if ligne is None:
            ecartees += 1
            continue
        par_image[ann["image_id"]].append(ligne)

    patients = {img_id: patient_of(img["file_name"], pattern)
                for img_id, img in images.items()}
    affectation = assign_splits(set(patients.values()), args.ratios, args.seed)

    for split in SPLITS:
        (args.out / split / "images").mkdir(parents=True, exist_ok=True)
        (args.out / split / "labels").mkdir(parents=True, exist_ok=True)

    distribution = {s: Counter() for s in SPLITS}
    par_split = Counter()

    for img_id, img in images.items():
        split = affectation[patients[img_id]]
        nom = Path(img["file_name"]).name
        source = args.images / img["file_name"]
        if not source.exists():
            source = args.images / nom
        if not source.exists():
            raise SystemExit(f"image absente du disque : {img['file_name']}")

        cible = args.out / split / "images" / nom
        if not cible.exists():
            if args.link:
                cible.symlink_to(source.resolve())
            else:
                shutil.copy2(source, cible)

        lignes = par_image.get(img_id, [])
        (args.out / split / "labels" / f"{Path(nom).stem}.txt").write_text(
            "\n".join(lignes) + ("\n" if lignes else ""), encoding="utf-8")
        par_split[split] += 1
        for ligne in lignes:
            distribution[split][CLASSES[int(ligne.split()[0])]] += 1

    (args.out / "data.yaml").write_text(
        "# Généré par training/prepare_dataset.py — ne pas éditer à la main.\n"
        f"path: {args.out.resolve().as_posix()}\n"
        "train: train/images\n"
        "val: val/images\n"
        "test: test/images\n"
        f"nc: {len(CLASSES)}\n"
        f"names: {json.dumps(CLASSES, ensure_ascii=False)}\n",
        encoding="utf-8")

    (args.out / "split.json").write_text(json.dumps({
        "seed": args.seed,
        "ratios": dict(zip(SPLITS, args.ratios)),
        "patient_regex": args.patient_regex,
        "n_patients": len(set(patients.values())),
        "n_images": dict(par_split),
        "affectation_patients": affectation,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    report(distribution, par_split, ecartees, non_mappees, args.out)


def report(distribution, par_split, ecartees, non_mappees, out: Path):
    """Distribution par classe et par partition.

    Le déséquilibre des classes est une exigence de la validation : une carie
    est bien plus fréquente qu'une dent incluse. Ce tableau est le premier
    endroit où le problème devient visible.
    """
    largeur = max(len(c) for c in CLASSES)
    entete = "classe".ljust(largeur) + " " + " ".join(s.rjust(8) for s in SPLITS)
    print("\n" + entete)
    print("-" * len(entete))
    for classe in CLASSES:
        compte = [distribution[s][classe] for s in SPLITS]
        print(classe.ljust(largeur) + " " + " ".join(str(c).rjust(8) for c in compte))
    print("-" * len(entete))
    print("images".ljust(largeur) + " "
          + " ".join(str(par_split[s]).rjust(8) for s in SPLITS))

    vides = [s for s in SPLITS if par_split[s] == 0]
    if vides:
        print(f"\n[!] Partitions VIDES : {', '.join(vides)}. "
              "Trop peu de patients pour ces ratios — la mesure sera invalide.")
    if ecartees:
        print(f"\n[!] {ecartees} boîtes dégénérées écartées.")
    if non_mappees:
        print("\n[!] Catégories source sans correspondance (annotations perdues) :")
        for nom, n in non_mappees.most_common():
            print(f"      {nom!r} : {n}")
        print("    Compléter --class-map, ou vérifier --category-field.")
    print(f"\n-> {out / 'data.yaml'}\n-> {out / 'split.json'}")


if __name__ == "__main__":
    main()
