"""Conversion DENTEX : deux jeux sans mélange, groupes jamais séparés, test externe isolé."""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

import prepare_dataset as pd
from config import CLASSES

CAT12 = {
    "categories_1": [{"id": i, "name": str(i + 1)} for i in range(4)],
    "categories_2": [{"id": i, "name": str(i + 1)} for i in range(8)],
}
CAT3 = {"categories_3": [{"id": 0, "name": "Impacted"}, {"id": 1, "name": "Caries"},
                         {"id": 2, "name": "Periapical Lesion"}, {"id": 3, "name": "Deep Caries"}]}
W, H = 200, 100


def image(graine: int) -> np.ndarray:
    return np.random.default_rng(graine).integers(0, 255, (H, W), np.uint8)


def ecrire_coco(json_path: Path, dossier: Path, cliches: list, avec_diagnostic: bool):
    """cliches : [(nom, graine_pixels, [(quadrant_id, rang_id, diag_id|None), ...])]"""
    dossier.mkdir(parents=True, exist_ok=True)
    images, annotations = [], []
    for k, (nom, graine, boites) in enumerate(cliches, start=1):
        cv2.imwrite(str(dossier / nom), image(graine))
        images.append({"id": k, "file_name": nom, "width": W, "height": H})
        for j, (q, r, d) in enumerate(boites):
            ann = {"image_id": k, "bbox": [10 + 20 * j, 20, 15, 30],
                   "category_id_1": q, "category_id_2": r}
            if avec_diagnostic:
                ann["category_id_3"] = d
            annotations.append(ann)
    categories = {**CAT12, **(CAT3 if avec_diagnostic else {})}
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps({"images": images, "annotations": annotations, **categories}),
                         encoding="utf-8")


def ecrire_labelme(dossier: Path, nom: str, graine: int, libelles: list):
    (dossier / "label").mkdir(parents=True, exist_ok=True)
    (dossier / "input").mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dossier / "input" / f"{nom}.png"), image(graine))
    formes = [{"label": l, "points": [[10 + 20 * j, 20], [25 + 20 * j, 50]], "shape_type": "polygon"}
              for j, l in enumerate(libelles)]
    (dossier / "label" / f"{nom}.json").write_text(json.dumps(
        {"shapes": formes, "imagePath": f"{nom}.png", "imageHeight": H, "imageWidth": W},
        ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def faux_dentex(tmp_path) -> Path:
    r = tmp_path / "dentex"
    td = r / "training_data"
    dents = [(f"train_{i}.png", i, [(0, 0, None), (1, 5, None), (2, 7, None)]) for i in range(40)]
    dents.append(("train_dup.png", 3, [(0, 0, None)]))           # doublon interne de train_3
    ecrire_coco(td / "quadrant_enumeration/train_quadrant_enumeration.json",
                td / "quadrant_enumeration/xrays", dents, False)
    maladies = [(f"train_{i}.png", 100 + i, [(0, 0, 1), (3, 7, 0)]) for i in range(30)]
    maladies += [("train_com.png", 5, [(1, 5, 2)])]               # même pixels que l'énumération 5
    maladies += [("train_vide.png", 999, [])]                     # sans boîte
    ecrire_coco(td / "quadrant-enumeration-disease/train_quadrant_enumeration_disease.json",
                td / "quadrant-enumeration-disease/xrays", maladies, True)
    ecrire_coco(r / "validation_triple.json",
                r / "validation_data/quadrant_enumeration_disease/xrays",
                [("val_1.png", 300, [(2, 3, 3)])], True)
    test = r / "test_data/disease"
    ecrire_labelme(test, "test_1", 7, ["1-çürük-35", "2-küretaj-36", "6-gömülü-48", "3-kanal-11"])
    ecrire_labelme(test, "test_2", 400, ["7-lezyon-46"])
    return r


def preparer(faux_dentex, out, graine=42):
    pd.main(["--dentex", str(faux_dentex), "--out", str(out), "--graine", str(graine),
             "--processus", "1"])
    return {j: json.loads((out / j / "split.json").read_text(encoding="utf-8"))
            for j in ("dents", "anomalies", "externe")}


def classes_ecrites(dossier: Path) -> set:
    return {int(l.split()[0]) for f in dossier.glob("*/labels/*.txt")
            for l in f.read_text().splitlines() if l}


def test_deux_jeux_sans_melange(faux_dentex, tmp_path):
    out = tmp_path / "yolo"
    preparer(faux_dentex, out)
    assert classes_ecrites(out / "dents") == {CLASSES.index("tooth")}
    assert classes_ecrites(out / "anomalies") == {CLASSES.index(c) for c in
                                                   ("caries", "deep_caries", "periapical_lesion",
                                                    "impacted_tooth")}
    for jeu in ("dents", "anomalies", "externe"):
        noms = json.loads((out / jeu / "data.yaml").read_text().split("names:")[1].strip())
        assert noms == CLASSES                      # ordre du contrat, dans les deux jeux


def test_groupes_jamais_separes_entre_les_deux_jeux(faux_dentex, tmp_path):
    split = preparer(faux_dentex, tmp_path / "yolo")
    partition = {}
    for jeu in ("dents", "anomalies"):
        for p, cliches in split[jeu]["cliches"].items():
            for c in cliches:
                partition[c] = p
    # Énumération 5 et maladies « train_com » ont les mêmes pixels.
    assert partition["enumeration/train_5.png"] == partition["maladies/train_com.png"]
    assert split["dents"]["empreinte"] == split["anomalies"]["empreinte"]


def test_test_officiel_isole(faux_dentex, tmp_path):
    out = tmp_path / "yolo"
    split = preparer(faux_dentex, out)
    tous = {c for j in ("dents", "anomalies") for v in split[j]["cliches"].values() for c in v}
    assert "enumeration/train_7.png" not in tous     # mêmes pixels que test_1 : retiré
    assert split["externe"]["cliches"]["test"] == ["externe/test_1.png", "externe/test_2.png"]
    lignes = (out / "externe/test/labels/externe__test_1.txt").read_text().split()
    classes = {int(lignes[i]) for i in range(0, len(lignes), 5)}
    # carie et inclusion gardées ; küretaj et canal exclus
    assert classes == {CLASSES.index("caries"), CLASSES.index("impacted_tooth")}


def test_doublons_et_cliches_vides_ecartes(faux_dentex, tmp_path):
    out = tmp_path / "yolo"
    split = preparer(faux_dentex, out)
    dents = {c for v in split["dents"]["cliches"].values() for c in v}
    anomalies = {c for v in split["anomalies"]["cliches"].values() for c in v}
    assert "enumeration/train_dup.png" not in dents and "enumeration/train_3.png" in dents
    assert "maladies/train_vide.png" not in anomalies
    assert "validation_officielle/val_1.png" in anomalies     # rejoint le pool
    texte = (out / "rapport_preparation.md").read_text(encoding="utf-8")
    assert "sans aucune boîte, écartés : 1" in texte


def test_meme_graine_meme_decoupage(faux_dentex, tmp_path):
    a = preparer(faux_dentex, tmp_path / "a")
    b = preparer(faux_dentex, tmp_path / "b")
    c = preparer(faux_dentex, tmp_path / "c", graine=7)
    assert a["dents"]["cliches"] == b["dents"]["cliches"]
    assert a["dents"]["empreinte"] == b["dents"]["empreinte"]
    assert a["dents"]["empreinte"] != c["dents"]["empreinte"]


def test_verite_fdi_conservee(faux_dentex, tmp_path):
    out = tmp_path / "yolo"
    preparer(faux_dentex, out)
    [fichier] = list(out.glob("anomalies/*/fdi/validation_officielle__val_1.json"))
    verite = json.loads(fichier.read_text(encoding="utf-8"))
    assert verite["boites"][0]["fdi"] == 34 and verite["boites"][0]["classe"] == "deep_caries"


def test_jeu_rangs_memes_cliches_que_dents_classe_egale_au_rang(faux_dentex, tmp_path):
    """Sprint 7 : le découpage ne change pas, chaque dent porte son rang (1 à 8)."""
    from config import CLASSES_RANGS

    out = tmp_path / "yolo"
    split = preparer(faux_dentex, out)
    rangs = json.loads((out / "rangs" / "split.json").read_text(encoding="utf-8"))
    assert rangs["cliches"] == split["dents"]["cliches"]
    assert rangs["empreinte"] == split["dents"]["empreinte"]
    noms = json.loads((out / "rangs" / "data.yaml").read_text().split("names:")[1].strip())
    assert noms == CLASSES_RANGS == [f"dent_{k}" for k in range(1, 9)]
    # Dents du faux DENTEX : rangs 1, 6 et 8 (identifiants de catégorie 0, 5, 7).
    assert classes_ecrites(out / "rangs") == {0, 5, 7}
    [verite] = list(out.glob("rangs/*/fdi/enumeration__train_0.json"))
    assert [b["classe"] for b in json.loads(verite.read_text(encoding="utf-8"))["boites"]] == \
        ["dent_1", "dent_6", "dent_8"]



def test_registres_du_test_gardes_si_le_decoupage_ne_change_pas(faux_dentex, tmp_path):
    """Relancer la préparation (pour créer le jeu « rangs ») ne doit pas effacer la
    trace des tests déjà évalués : sinon on pourrait les réévaluer sans le savoir."""
    out = tmp_path / "yolo"
    preparer(faux_dentex, out)
    for jeu in ("dents", "anomalies", "externe"):
        (out / jeu / "evaluations_test.jsonl").write_text('{"poids": "best.pt"}\n')
    preparer(faux_dentex, out)                                    # même graine, même découpage
    for jeu in ("dents", "anomalies", "externe"):
        assert (out / jeu / "evaluations_test.jsonl").read_text() == '{"poids": "best.pt"}\n'
    preparer(faux_dentex, out, graine=7)                          # autre découpage : caducs
    assert not (out / "dents" / "evaluations_test.jsonl").exists()
