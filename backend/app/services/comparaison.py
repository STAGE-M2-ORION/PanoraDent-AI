"""Comparaison des propositions de deux modèles sur le même cliché.

On compare ce que chaque MODÈLE a proposé (`source = model`), au même seuil
de confiance, jamais les verdicts du praticien : la question est « qu'est-ce
que le nouveau modèle voit de plus, ou de moins ? ». Deux propositions se
correspondent si elles ont la même classe et se recouvrent à au moins 0,50
(IoU), chacune ne servant qu'une fois.
"""
from collections import Counter

SEUIL_IOU = 0.50


def iou(a, b) -> float:
    """Recouvrement de deux boîtes (x, y, w, h) en fractions de l'image."""
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def comparer(origine: list, rejeu: list, seuil: float) -> dict:
    """`origine`, `rejeu` : [(label, (x, y, w, h), confiance)]. Retourne, par
    classe, le nombre de propositions de chaque côté et leur recoupement."""
    a = [d for d in origine if (d[2] or 0) >= seuil]
    b = [d for d in rejeu if (d[2] or 0) >= seuil]
    paires = sorted(((iou(da[1], db[1]), i, j) for i, da in enumerate(a)
                     for j, db in enumerate(b) if da[0] == db[0]), reverse=True)
    pris_a, pris_b, communes = set(), set(), Counter()
    for valeur, i, j in paires:
        if valeur < SEUIL_IOU:
            break
        if i in pris_a or j in pris_b:
            continue
        pris_a.add(i)
        pris_b.add(j)
        communes[a[i][0]] += 1
    n_a, n_b = Counter(d[0] for d in a), Counter(d[0] for d in b)
    return {label: {"origine": n_a[label], "rejeu": n_b[label], "communes": communes[label],
                    "seulement_origine": n_a[label] - communes[label],
                    "seulement_rejeu": n_b[label] - communes[label]}
            for label in sorted(set(n_a) | set(n_b))}
