"""Augmentations : miroir et quadrants, jamais de retournement vertical, planche."""
import cv2
import numpy as np
import pytest

import augmentations as aug


@pytest.mark.parametrize("avant, apres", [
    (11, 21), (16, 26), (28, 18), (36, 46), (48, 38), (31, 41), (55, 65), (84, 74),
])
def test_miroir_inverse_les_quadrants(avant, apres):
    assert aug.miroir_fdi(avant) == apres


def test_miroir_deux_fois_rend_l_original():
    for fdi in [q * 10 + r for q in range(1, 5) for r in range(1, 9)]:
        assert aug.miroir_fdi(aug.miroir_fdi(fdi)) == fdi


def test_miroir_fdi_invalide_refuse():
    for fdi in (10, 19, 91, 0):
        with pytest.raises(ValueError):
            aug.miroir_fdi(fdi)


def test_miroir_des_boites_deplace_et_renumerote():
    boites = [{"x": 0.10, "y": 0.4, "w": 0.05, "h": 0.2, "classe": "tooth", "fdi": 18},
              {"x": 0.55, "y": 0.5, "w": 0.04, "h": 0.1, "classe": "caries", "fdi": 36}]
    m = aug.miroir_boites(boites)
    assert m[0]["x"] == pytest.approx(0.85) and m[0]["fdi"] == 28
    assert m[1]["x"] == pytest.approx(0.41) and m[1]["fdi"] == 46
    assert [b["y"] for b in m] == [0.4, 0.5]        # la hauteur ne bouge pas
    assert boites[0]["fdi"] == 18                    # l'original est intact


def test_jamais_de_retournement_vertical():
    assert aug.HYPERPARAMETRES["flipud"] == 0.0
    assert aug.HYPERPARAMETRES["fliplr"] > 0.0
    aug.verifier_hyperparametres(aug.HYPERPARAMETRES)
    with pytest.raises(ValueError, match="flipud"):
        aug.verifier_hyperparametres({**aug.HYPERPARAMETRES, "flipud": 0.5})


def test_contraste_garde_la_moyenne_et_change_l_ecart(monkeypatch):
    img = np.tile(np.linspace(50, 200, 100, dtype=np.uint8), (20, 1))[..., None].repeat(3, 2)
    monkeypatch.setattr(aug.random, "random", lambda: 0.0)        # toujours appliqué
    monkeypatch.setattr(aug.random, "uniform", lambda a, b: 1.2)  # +20 %
    sortie = aug.ContrasteAleatoire(0.25)({"img": img.copy()})["img"]
    assert sortie.dtype == np.uint8
    assert abs(sortie.mean() - img.mean()) < 1.0
    assert sortie.std() == pytest.approx(img.std() * 1.2, rel=0.02)


def test_chaine_ultralytics_contient_nos_augmentations(jeu_synthetique):
    from ultralytics.cfg import get_cfg
    from ultralytics.data.augment import RandomFlip
    from ultralytics.data.utils import check_det_dataset

    from entraineur import construire_dataset

    cfg = get_cfg(overrides={**aug.HYPERPARAMETRES, "imgsz": 128})
    data = check_det_dataset(str(jeu_synthetique))
    chaine = construire_dataset(cfg, data["train"], 1, data, mode="train").transforms.transforms
    assert any(isinstance(t, aug.ContrasteAleatoire) for t in chaine)
    retournements = {t.direction: t.p for t in chaine if isinstance(t, RandomFlip)}
    assert retournements == {"vertical": 0.0, "horizontal": 0.5}
    # Validation : aucune augmentation.
    validation = construire_dataset(cfg, data["val"], 1, data, mode="val").transforms.transforms
    assert not any(isinstance(t, (aug.ContrasteAleatoire, RandomFlip)) for t in validation)


def test_planche_produite_par_la_chaine_reelle(jeu_synthetique, tmp_path):
    from planche_augmentations import planche
    sortie = planche(jeu_synthetique, tmp_path / "planche.jpg", n=6, imgsz=128)
    img = cv2.imread(str(sortie))
    assert img is not None
    assert img.shape[:2] == (2 * 128, 4 * 128)      # 6 vignettes sur 4 colonnes
