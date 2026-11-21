"""Découpage reproductible apprentissage / validation / test.

Trois exigences, tenues ici et nulle part ailleurs :

1. **Aucune fuite entre partitions.** On découpe des *groupes*, jamais des
   images isolées : tous les clichés d'un même groupe vont dans la même
   partition. DENTEX ne publie pas d'identifiant patient ; le groupe est donc le
   cliché lui-même, et les clichés identiques au pixel près (même empreinte de
   contenu) sont réunis dans un seul groupe, sinon un même cliché pourrait servir
   à l'apprentissage et au test.
2. **Reproductible.** Même graine, mêmes groupes : même découpage, quel que soit
   l'ordre de lecture des fichiers. L'**empreinte du découpage** (sha256 de
   l'affectation) est conservée avec le modèle : elle prouve sur quelles images
   le modèle a été mesuré.
3. **Représentatif.** Le découpage est stratifié sur la classe la plus rare
   présente dans chaque groupe : une classe rare (lésion péri-apicale) ne peut pas
   disparaître du test par malchance.
"""
import hashlib
import json
import random
from collections import Counter, defaultdict

PARTITIONS = ("train", "val", "test")
SANS_CLASSE = "(aucune)"


def empreinte_decoupage(affectation: dict, graine: int, ratios) -> str:
    """sha256 d'une forme canonique : indépendante de l'ordre des clés."""
    canonique = json.dumps({
        "graine": graine,
        "ratios": [round(float(r), 6) for r in ratios],
        "affectation": sorted(affectation.items()),
    }, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonique.encode("utf-8")).hexdigest()


def strate_de(classes: set, frequences: Counter) -> str:
    """Classe la plus rare du groupe (égalité : ordre alphabétique)."""
    if not classes:
        return SANS_CLASSE
    return min(classes, key=lambda c: (frequences[c], c))


def decouper(groupes: dict[str, set], ratios=(0.70, 0.15, 0.15), graine: int = 42) -> dict:
    """Affecte chaque groupe à une partition.

    `groupes` : identifiant de groupe -> ensemble des classes qu'il contient.
    Retourne {identifiant: "train" | "val" | "test"}.
    """
    if abs(sum(ratios) - 1.0) > 1e-6:
        raise ValueError(f"les ratios doivent sommer à 1, reçu {sum(ratios)}")

    frequences = Counter(c for classes in groupes.values() for c in classes)
    strates = defaultdict(list)
    for gid in sorted(groupes):   # tri : l'ordre de lecture ne doit rien changer
        strates[strate_de(groupes[gid], frequences)].append(gid)

    rng = random.Random(graine)
    affectation = {}
    deja = Counter()   # groupes déjà affectés, par partition
    vus = 0
    # Les strates rares d'abord : ce sont elles qui ont besoin des arrondis.
    for strate in sorted(strates, key=lambda s: (len(strates[s]), s)):
        membres = strates[strate]
        rng.shuffle(membres)
        vus += len(membres)
        # Cible cumulée : chaque strate reçoit l'écart entre ce que les ratios
        # demandent sur tout ce qui a été vu et ce qui est déjà affecté. Les
        # arrondis ne s'accumulent pas, et une strate de 9 clichés en donne
        # quand même à la validation et au test.
        n_train = min(len(membres), max(0, round(vus * ratios[0]) - deja["train"]))
        n_val = min(len(membres) - n_train,
                    max(0, round(vus * ratios[1]) - deja["val"]))
        for i, gid in enumerate(membres):
            p = "train" if i < n_train else "val" if i < n_train + n_val else "test"
            affectation[gid] = p
            deja[p] += 1
    return affectation


def effectifs(groupes: dict[str, Counter], affectation: dict) -> dict:
    """Nombre de boîtes par classe et par partition, plus le nombre de groupes."""
    table = {p: Counter() for p in PARTITIONS}
    n_groupes = Counter()
    for gid, compte in groupes.items():
        p = affectation[gid]
        table[p].update(compte)
        n_groupes[p] += 1
    return {"boites": {p: dict(table[p]) for p in PARTITIONS},
            "groupes": dict(n_groupes)}


def tableau(effectif: dict, classes) -> str:
    """Rendu texte des effectifs, une ligne par classe."""
    largeur = max([len(c) for c in classes] + [8])
    lignes = ["classe".ljust(largeur) + "".join(p.rjust(9) for p in PARTITIONS),
              "-" * (largeur + 9 * len(PARTITIONS))]
    for c in classes:
        lignes.append(c.ljust(largeur) + "".join(
            str(effectif["boites"][p].get(c, 0)).rjust(9) for p in PARTITIONS))
    lignes.append("-" * (largeur + 9 * len(PARTITIONS)))
    lignes.append("clichés".ljust(largeur) + "".join(
        str(effectif["groupes"].get(p, 0)).rjust(9) for p in PARTITIONS))
    return "\n".join(lignes)
