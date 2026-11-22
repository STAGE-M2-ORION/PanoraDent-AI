import math

import pytest

import reequilibrage as rq

# 10 clichés : la classe 1 (carie) partout, la classe 3 (lésion péri-apicale) sur un seul.
CLICHES = [{1}] * 9 + [{1, 3}]


def test_desactive_par_defaut():
    assert rq.SEUIL == 0.0
    assert rq.facteurs(CLICHES, 0.0) == [1.0] * 10


def test_facteur_lvis_selon_la_classe_la_plus_rare():
    f = rq.facteurs(CLICHES, 0.3)
    # carie : présente sur 100 % des clichés, au-dessus du seuil -> 1
    assert f[:9] == [1.0] * 9
    # lésion : 10 % des clichés -> sqrt(0,3 / 0,1)
    assert f[9] == pytest.approx(math.sqrt(3))


def test_cliche_sans_annotation_non_repete():
    assert rq.facteurs([set(), {2}], 0.9) == [1.0, pytest.approx(math.sqrt(1.8))]


def test_repetitions_reproductibles_et_en_moyenne_justes():
    copies = rq.repetitions([1.4] * 2000, graine=42)
    assert copies == rq.repetitions([1.4] * 2000, graine=42)
    assert set(copies) == {1, 2}
    assert sum(copies) / len(copies) == pytest.approx(1.4, abs=0.04)
    assert rq.repetitions([1.0, 3.0], graine=1) == [1, 3]


def test_bilan_et_repetition():
    copies = [1] * 9 + [3]
    b = rq.bilan(CLICHES, copies)
    assert b["cliches_avant"] == 10 and b["cliches_apres"] == 12
    assert b["par_classe"][3] == {"avant": 1, "apres": 3}
    assert rq.repeter(["a", "b"], [2, 1]) == ["a", "a", "b"]


def test_jeu_d_entrainement_reequilibre_validation_intacte(jeu_synthetique, tmp_path, monkeypatch):
    """Vrai jeu ultralytics : le cliché porteur d'une classe rare est répété à
    l'entraînement ; la validation n'est jamais touchée ; le bilan est écrit."""
    import json

    from ultralytics.cfg import get_cfg

    from entraineur import construire_dataset

    racine = jeu_synthetique.parent
    rare = racine / "train" / "labels" / "train_0.txt"
    rare.write_text(rare.read_text() + "3 0.5 0.5 0.1 0.1\n")   # une lésion, sur 1 cliché sur 8
    bilan = tmp_path / "reequilibrage.json"
    monkeypatch.setattr(rq, "SEUIL", 0.5)
    monkeypatch.setattr(rq, "FICHIER_BILAN", bilan)
    cfg = get_cfg(overrides={"imgsz": 128})
    data = {"names": {i: str(i) for i in range(5)}, "nc": 5}

    train = construire_dataset(cfg, str(racine / "train" / "images"), 4, data, mode="train")
    val = construire_dataset(cfg, str(racine / "val" / "images"), 4, data, mode="val")

    # classe 3 sur 1/8 des clichés -> facteur sqrt(0,5 / 0,125) = 2 : une copie de plus
    assert len(train.labels) == len(train.im_files) == 9
    assert sum(f.endswith("train_0.png") for f in train.im_files) == 2
    assert len(val.labels) == 4
    assert json.loads(bilan.read_text())["par_classe"]["3"] == {"avant": 1, "apres": 2}


def test_reglage_borne_et_bilan_range_dans_le_run(tmp_path, monkeypatch):
    import train

    for attr in ("SEUIL", "GRAINE", "FICHIER_BILAN"):
        monkeypatch.setattr(rq, attr, getattr(rq, attr))
    with pytest.raises(SystemExit, match="entre 0 et 1"):
        train._regler_reequilibrage(1.5, 42, tmp_path)
    train._regler_reequilibrage(0.3, 7, tmp_path)
    assert (rq.SEUIL, rq.GRAINE, rq.FICHIER_BILAN) == (0.3, 7, tmp_path / "reequilibrage.json")
    train._regler_reequilibrage(0.0, 7, tmp_path)
    assert rq.FICHIER_BILAN is None
    assert train._parse_args(["--data", "x.yaml"]).reequilibrage == 0.0
