"""Augmentations adaptées à la radiographie panoramique.

Ce qui est admis, et pourquoi :

- **miroir horizontal** seulement. Un panoramique retourné verticalement
  n'existe pas : l'apprendre au modèle reviendrait à lui montrer une image qu'il
  ne verra jamais. `flipud` est donc verrouillé à 0 ;
- **luminosité** (`hsv_v`) et **contraste** (`ContrasteAleatoire`) : les
  appareils et les réglages d'exposition varient d'un cabinet à l'autre. Teinte
  et saturation sont coupées, l'image est en niveaux de gris ;
- **léger recadrage** : petit zoom (`scale`) et petit décalage (`translate`).
  Mosaïque et mixup sont coupés : un collage de quatre panoramiques ne ressemble
  à aucun cliché réel.

Le miroir et la numérotation FDI. Nos classes (dent, carie…) n'ont pas de côté :
ultralytics retourne les boîtes et c'est suffisant pour l'entraînement. Mais la
vérité terrain FDI, conservée à côté des étiquettes pour le sprint 7, change de
côté avec le miroir : la droite du patient passe à gauche. `miroir_fdi` inverse
les quadrants (1↔2, 3↔4, et 5↔6, 7↔8 pour la denture temporaire). Sans cela, la
numérotation apprendrait l'inverse de ce qu'il faut.
"""
import random

import numpy as np

#: Hyperparamètres d'augmentation passés à ultralytics.
HYPERPARAMETRES = {
    "fliplr": 0.5,
    "flipud": 0.0,       # jamais : voir la docstring
    "mosaic": 0.0,
    "mixup": 0.0,
    "copy_paste": 0.0,
    "degrees": 0.0,
    "shear": 0.0,
    "perspective": 0.0,
    "hsv_h": 0.0,
    "hsv_s": 0.0,
    "hsv_v": 0.30,       # luminosité ±30 %
    "scale": 0.15,       # zoom ±15 % : léger recadrage
    "translate": 0.05,   # décalage ±5 %
}

#: Amplitude du contraste aléatoire (facteur tiré dans [1 - a, 1 + a]).
CONTRASTE = 0.25

QUADRANT_MIROIR = {1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7}


def verifier_hyperparametres(hyp: dict) -> None:
    """Refuse toute configuration qui retournerait l'image verticalement."""
    if hyp.get("flipud", 0.0) != 0.0:
        raise ValueError("flipud doit valoir 0 : un panoramique retourné verticalement n'existe pas")


def miroir_fdi(fdi: int | None) -> int | None:
    """Numéro FDI de la même dent vue en miroir : 16 → 26, 36 → 46, 11 → 21."""
    if fdi is None:
        return None
    quadrant, rang = divmod(int(fdi), 10)
    if quadrant not in QUADRANT_MIROIR or not 1 <= rang <= 8:
        raise ValueError(f"numéro FDI invalide : {fdi}")
    return QUADRANT_MIROIR[quadrant] * 10 + rang


def miroir_boites(boites: list[dict]) -> list[dict]:
    """Miroir horizontal d'une vérité terrain.

    Boîte : `{"x", "y", "w", "h"}` en fractions de l'image (coin haut gauche),
    plus `classe` et éventuellement `fdi`. Le coin gauche devient `1 - x - w`,
    et le numéro FDI change de quadrant.
    """
    sortie = []
    for b in boites:
        m = dict(b, x=round(1.0 - b["x"] - b["w"], 6))
        if "fdi" in b:
            m["fdi"] = miroir_fdi(b["fdi"])
        sortie.append(m)
    return sortie


class ContrasteAleatoire:
    """Étire ou resserre les niveaux autour de leur moyenne.

    Transformation au format ultralytics : reçoit et renvoie le dictionnaire
    `labels`, ne touche qu'à l'image (les boîtes ne bougent pas).
    """

    def __init__(self, amplitude: float = CONTRASTE, p: float = 0.5):
        self.amplitude = amplitude
        self.p = p

    def __call__(self, labels: dict) -> dict:
        if self.amplitude <= 0 or random.random() >= self.p:
            return labels
        img = labels["img"]
        facteur = random.uniform(1.0 - self.amplitude, 1.0 + self.amplitude)
        moyenne = float(img.mean())
        labels["img"] = np.clip((img.astype(np.float32) - moyenne) * facteur + moyenne,
                                0, 255).astype(np.uint8)
        return labels
