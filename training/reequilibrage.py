"""Rééquilibrage des classes rares par répétition des clichés.

Méthode « repeat factor sampling » (Gupta, Dollár, Girshick, *LVIS*, CVPR
2019) : pour chaque classe c, f_c est la part des clichés d'entraînement qui
la contiennent ; son facteur vaut r_c = max(1, sqrt(t / f_c)), où t est le
seuil choisi. Un cliché est répété selon la plus rare de ses classes :
r = max(r_c). Une classe présente sur plus d'une part t des clichés n'est pas
répétée ; une classe deux fois plus rare que t l'est d'environ 1,4 fois.

Les facteurs non entiers sont arrondis au hasard, avec une graine fixe :
r = 1,4 donne 1 ou 2 copies, 2 en moyenne quatre fois sur dix. Le tirage est
fait une fois, à la construction du jeu d'entraînement ; la validation et le
test ne sont jamais rééquilibrés.

Seuil 0 : désactivé (comportement des modèles du sprint 6).
"""
import math
import random
from collections import Counter

# Fixés par train.py (--reequilibrage, --seed) avant la construction du jeu.
SEUIL = 0.0
GRAINE = 42
FICHIER_BILAN = None  # <run>/reequilibrage.json : clichés par classe, avant et après


def facteurs(classes_par_image: list[set[int]], seuil: float) -> list[float]:
    """Facteur de répétition de chaque cliché (1 : pas de répétition)."""
    if seuil <= 0 or not classes_par_image:
        return [1.0] * len(classes_par_image)
    n = len(classes_par_image)
    presence = Counter(c for classes in classes_par_image for c in classes)
    par_classe = {c: max(1.0, math.sqrt(seuil / (k / n))) for c, k in presence.items()}
    return [max((par_classe[c] for c in classes), default=1.0) for classes in classes_par_image]


def repetitions(facteurs_images: list[float], graine: int) -> list[int]:
    """Nombre de copies de chaque cliché : partie entière, plus une copie avec
    la probabilité de la partie décimale (tirage reproductible)."""
    rng = random.Random(graine)
    copies = []
    for r in facteurs_images:
        entier = math.floor(r)
        copies.append(entier + (1 if rng.random() < r - entier else 0))
    return copies


def bilan(classes_par_image: list[set[int]], copies: list[int]) -> dict:
    """Clichés contenant chaque classe, avant et après répétition."""
    avant = Counter(c for classes in classes_par_image for c in classes)
    apres = Counter()
    for classes, k in zip(classes_par_image, copies):
        for c in classes:
            apres[c] += k
    return {"cliches_avant": len(classes_par_image), "cliches_apres": sum(copies),
            "par_classe": {c: {"avant": avant[c], "apres": apres[c]} for c in sorted(avant)}}


def repeter(elements: list, copies: list[int]) -> list:
    """Liste où chaque élément figure autant de fois que demandé, dans l'ordre."""
    return [e for e, k in zip(elements, copies) for _ in range(k)]
