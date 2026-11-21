"""Planche d'images augmentées, pour le contrôle visuel.

Les images passent par **la chaîne réelle d'entraînement** (`DatasetPanoradent`,
mêmes hyperparamètres que `train.py`) : la planche montre exactement ce que le
modèle verra, boîtes comprises. À regarder avant tout entraînement long : un
cadre décalé après miroir ou recadrage s'y voit immédiatement.

    python training/planche_augmentations.py --data data/yolo/dents/data.yaml \\
        --out runs/planche.jpg --n 16 --imgsz 1024
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np

import augmentations
from config import CLASSES

#: Couleur BGR par classe, lisible sur fond gris.
COULEURS = [(80, 200, 80), (40, 40, 230), (0, 140, 255), (230, 80, 200), (230, 200, 40)]


def dessiner(element: dict) -> np.ndarray:
    """Image augmentée (tenseur CHW RVB) avec ses boîtes, en BGR pour OpenCV."""
    img = element["img"].numpy().transpose(1, 2, 0)[:, :, ::-1].copy()
    h, w = img.shape[:2]
    for (cx, cy, bw, bh), c in zip(element["bboxes"].tolist(), element["cls"].flatten().tolist()):
        x1, y1 = int((cx - bw / 2) * w), int((cy - bh / 2) * h)
        x2, y2 = int((cx + bw / 2) * w), int((cy + bh / 2) * h)
        couleur = COULEURS[int(c) % len(COULEURS)]
        cv2.rectangle(img, (x1, y1), (x2, y2), couleur, max(1, w // 400))
        cv2.putText(img, CLASSES[int(c)], (x1, max(10, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX,
                    max(0.3, w / 2000), couleur, 1, cv2.LINE_AA)
    return img


def planche(data_yaml: Path, sortie: Path, n: int = 16, imgsz: int = 640,
            colonnes: int = 4, graine: int = 0) -> Path:
    from ultralytics.cfg import get_cfg
    from ultralytics.data.utils import check_det_dataset

    from entraineur import construire_dataset

    augmentations.verifier_hyperparametres(augmentations.HYPERPARAMETRES)
    cfg = get_cfg(overrides={**augmentations.HYPERPARAMETRES, "imgsz": imgsz})
    data = check_det_dataset(str(data_yaml))
    dataset = construire_dataset(cfg, data["train"], batch=1, data=data, mode="train")

    random.seed(graine)
    np.random.seed(graine)
    indices = [random.randrange(len(dataset)) for _ in range(n)]
    vignettes = [dessiner(dataset[i]) for i in indices]

    taille = max(max(v.shape[:2]) for v in vignettes)
    lignes = -(-n // colonnes)
    toile = np.full((lignes * taille, colonnes * taille, 3), 255, np.uint8)
    for k, v in enumerate(vignettes):
        r, c = divmod(k, colonnes)
        toile[r * taille:r * taille + v.shape[0], c * taille:c * taille + v.shape[1]] = v

    sortie.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(sortie), toile)
    return sortie


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("runs/planche_augmentations.jpg"))
    p.add_argument("--n", type=int, default=16)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--graine", type=int, default=0)
    args = p.parse_args(argv)
    print(f"-> {planche(args.data, args.out, args.n, args.imgsz, graine=args.graine)}")


if __name__ == "__main__":
    main()
