"""Découpage : reproductible, sans fuite, fidèle aux ratios, classes rares présentes."""
import random
from collections import Counter

import pytest

from decoupage import decouper, effectifs, empreinte_decoupage


def jeu(n=400, graine=0):
    """Groupes synthétiques : beaucoup de caries, quelques lésions rares."""
    rng = random.Random(graine)
    groupes = {}
    for i in range(n):
        classes = set()
        if rng.random() < 0.7:
            classes.add("caries")
        if rng.random() < 0.25:
            classes.add("impacted_tooth")
        if rng.random() < 0.04:
            classes.add("periapical_lesion")
        groupes[f"img_{i}"] = classes
    return groupes


def test_meme_graine_meme_decoupage():
    groupes = jeu()
    a = decouper(groupes, graine=42)
    b = decouper(dict(reversed(list(groupes.items()))), graine=42)   # autre ordre de lecture
    assert a == b
    assert empreinte_decoupage(a, 42, (0.7, 0.15, 0.15)) == \
        empreinte_decoupage(b, 42, (0.7, 0.15, 0.15))


def test_autre_graine_autre_decoupage():
    groupes = jeu()
    a, b = decouper(groupes, graine=42), decouper(groupes, graine=43)
    assert a != b
    assert empreinte_decoupage(a, 42, (0.7, 0.15, 0.15)) != \
        empreinte_decoupage(b, 43, (0.7, 0.15, 0.15))


def test_chaque_groupe_dans_une_seule_partition():
    groupes = jeu()
    affectation = decouper(groupes)
    assert set(affectation) == set(groupes)
    assert set(affectation.values()) <= {"train", "val", "test"}


def test_ratios_respectes_au_total():
    affectation = decouper(jeu(1000), ratios=(0.7, 0.15, 0.15))
    n = Counter(affectation.values())
    assert abs(n["train"] - 700) <= 3
    assert abs(n["val"] - 150) <= 3
    assert abs(n["test"] - 150) <= 3


def test_classe_rare_presente_dans_chaque_partition():
    groupes = jeu()
    rares = [g for g, c in groupes.items() if "periapical_lesion" in c]
    assert 8 <= len(rares) <= 30
    affectation = decouper(groupes)
    assert {affectation[g] for g in rares} == {"train", "val", "test"}


def test_ratios_invalides_refuses():
    with pytest.raises(ValueError):
        decouper(jeu(10), ratios=(0.8, 0.15, 0.15))


def test_effectifs_par_classe_et_partition():
    groupes = {"a": Counter(caries=2), "b": Counter(caries=1, tooth=30), "c": Counter()}
    affectation = {"a": "train", "b": "test", "c": "val"}
    e = effectifs(groupes, affectation)
    assert e["boites"]["train"] == {"caries": 2}
    assert e["boites"]["test"] == {"caries": 1, "tooth": 30}
    assert e["groupes"] == {"train": 1, "val": 1, "test": 1}
