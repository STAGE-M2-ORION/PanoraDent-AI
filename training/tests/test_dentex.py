"""Lecture DENTEX : les deux formats réels, reproduits sur de petits extraits."""
import json

import cv2
import numpy as np
import pytest

import dentex

# Catégories telles que publiées : identifiants à partir de 0, numéro dans le nom.
CATEGORIES = {
    "categories_1": [{"id": i, "name": str(i + 1)} for i in range(4)],
    "categories_2": [{"id": i, "name": str(i + 1)} for i in range(8)],
    "categories_3": [{"id": 0, "name": "Impacted"}, {"id": 1, "name": "Caries"},
                     {"id": 2, "name": "Periapical Lesion"}, {"id": 3, "name": "Deep Caries"}],
}


def ecrire_coco(chemin, annotations, categories=CATEGORIES):
    chemin.write_text(json.dumps({
        "images": [{"id": 1, "file_name": "train_1.png", "width": 2000, "height": 1000}],
        "annotations": annotations, **categories}), encoding="utf-8")
    return chemin


def test_coco_hierarchique_lit_les_noms_pas_les_identifiants(tmp_path):
    json_path = ecrire_coco(tmp_path / "a.json", [
        # id quadrant 3 -> "4", id rang 7 -> "8", id diagnostic 0 -> Impacted : la 48 incluse
        {"image_id": 1, "bbox": [400, 500, 200, 100], "category_id_1": 3,
         "category_id_2": 7, "category_id_3": 0},
    ])
    [c] = dentex.lire_coco(json_path, tmp_path, "quadrant_enumeration_disease")
    [b] = c.boites
    assert b.fdi == 48
    assert b.diagnostic == "impacted_tooth"
    assert (b.x, b.y, b.w, b.h) == (0.2, 0.5, 0.1, 0.1)
    assert c.identifiant == "quadrant_enumeration_disease/train_1.png"


def test_coco_sans_diagnostic_donne_une_dent_numerotee(tmp_path):
    categories = {k: v for k, v in CATEGORIES.items() if k != "categories_3"}
    json_path = ecrire_coco(tmp_path / "a.json", [
        {"image_id": 1, "bbox": [0, 0, 10, 10], "category_id_1": 0, "category_id_2": 0}],
        categories)
    [b] = dentex.lire_coco(json_path, tmp_path, "quadrant_enumeration")[0].boites
    assert b.fdi == 11 and b.diagnostic is None


def test_boite_debordante_rognee(tmp_path):
    json_path = ecrire_coco(tmp_path / "a.json", [
        {"image_id": 1, "bbox": [1900, -20, 200, 120], "category_id_1": 0, "category_id_2": 0}])
    [b] = dentex.lire_coco(json_path, tmp_path, "x")[0].boites
    assert (b.x, b.y, b.w, b.h) == (0.95, 0.0, 0.05, 0.1)


def test_diagnostic_inconnu_refuse(tmp_path):
    categories = dict(CATEGORIES, categories_3=[{"id": 0, "name": "Fracture"}])
    with pytest.raises(dentex.FormatInattendu, match="Fracture"):
        dentex.lire_coco(ecrire_coco(tmp_path / "a.json", [], categories), tmp_path, "x")


def test_labelme_du_test_officiel(tmp_path):
    (tmp_path / "test_14.json").write_text(json.dumps({
        "shapes": [
            {"label": "1-çürük-35", "points": [[1690, 708], [1800, 933], [1700, 686]],
             "shape_type": "polygon"},
            {"label": "3-kanal-11", "points": [[10, 10], [20, 30]], "shape_type": "polygon"},
        ],
        "imagePath": "test_14.png", "imageHeight": 1316, "imageWidth": 2935,
    }, ensure_ascii=False), encoding="utf-8")
    [c] = dentex.lire_labelme(tmp_path, tmp_path)
    carie, canal = c.boites
    assert carie.fdi == 35 and carie.diagnostic == "caries"
    assert carie.x == pytest.approx(1690 / 2935) and carie.h == pytest.approx((933 - 686) / 1316)
    assert canal.fdi == 11 and canal.diagnostic is None        # hors périmètre


def test_labelme_code_inconnu_refuse(tmp_path):
    (tmp_path / "t.json").write_text(json.dumps({
        "shapes": [{"label": "4-mystere-11", "points": [[0, 0], [1, 1]]}],
        "imagePath": "t.png", "imageHeight": 10, "imageWidth": 10}), encoding="utf-8")
    with pytest.raises(dentex.FormatInattendu, match="mystere"):
        dentex.lire_labelme(tmp_path, tmp_path)


def test_empreinte_pixels_ignore_le_conteneur(tmp_path):
    img = np.random.default_rng(0).integers(0, 255, (50, 80), np.uint8)
    cv2.imwrite(str(tmp_path / "a.png"), img)
    cv2.imwrite(str(tmp_path / "b.png"), img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    assert (tmp_path / "a.png").read_bytes() != (tmp_path / "b.png").read_bytes()
    assert dentex.empreinte_pixels(tmp_path / "a.png") == dentex.empreinte_pixels(tmp_path / "b.png")
