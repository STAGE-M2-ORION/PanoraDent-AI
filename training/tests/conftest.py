"""Jeu synthétique minuscule, au format produit par prepare_dataset.py.

Des « dents » claires sur fond sombre et quelques « caries » plus sombres :
assez pour que l'entraînement, la reprise et l'évaluation tournent vraiment, en
quelques secondes sur le processeur, sans aucune donnée réelle.
"""
import json
import random
from pathlib import Path

import cv2
import numpy as np
import pytest

from config import CLASSES


def ecrire_jeu(racine: Path, n_par_partition=(8, 4, 4), taille=(256, 128), graine=0,
               noms=CLASSES) -> Path:
    """`noms` : liste de classes du data.yaml (contrat, ou rangs du sprint 7)."""
    rng = random.Random(graine)
    w, h = taille
    for partition, n in zip(("train", "val", "test"), n_par_partition):
        (racine / partition / "images").mkdir(parents=True, exist_ok=True)
        (racine / partition / "labels").mkdir(parents=True, exist_ok=True)
        for i in range(n):
            img = np.full((h, w, 3), 40, np.uint8)
            lignes = []
            for k in range(6):
                bw, bh = 24, 40
                x = 10 + k * 38 + rng.randint(0, 6)
                y = 20 + rng.randint(0, 40)
                cv2.rectangle(img, (x, y), (x + bw, y + bh), (200, 200, 200), -1)
                lignes.append(f"0 {(x + bw / 2) / w:.6f} {(y + bh / 2) / h:.6f} {bw / w:.6f} {bh / h:.6f}")
                if rng.random() < 0.4:
                    cx, cy = x + 12, y + 15
                    cv2.circle(img, (cx, cy), 6, (60, 60, 60), -1)
                    lignes.append(f"1 {cx / w:.6f} {cy / h:.6f} {14 / w:.6f} {14 / h:.6f}")
            nom = f"{partition}_{i}"
            cv2.imwrite(str(racine / partition / "images" / f"{nom}.png"), img)
            (racine / partition / "labels" / f"{nom}.txt").write_text("\n".join(lignes) + "\n")

    data = racine / "data.yaml"
    data.write_text(
        f"path: {racine.resolve().as_posix()}\ntrain: train/images\nval: val/images\n"
        f"test: test/images\nnc: {len(noms)}\nnames: {json.dumps(noms)}\n",
        encoding="utf-8")
    (racine / "split.json").write_text(json.dumps({"empreinte": "0" * 64, "graine": graine}))
    return data


@pytest.fixture
def jeu_synthetique(tmp_path) -> Path:
    return ecrire_jeu(tmp_path / "jeu")
