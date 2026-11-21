"""Évaluation : appariement IoU, test évalué une seule fois, rapport complet produit."""
import json

import cv2
import pytest

import evaluate
import train
from conftest import ecrire_jeu


# --- Appariement -------------------------------------------------------------

def test_iou():
    assert evaluate.iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert evaluate.iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    assert evaluate.iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(50 / 150)


def test_appariement_classe_et_recouvrement():
    verite = [(0, (0, 0, 10, 10)), (1, (20, 0, 30, 10))]
    predictions = [
        (0, (0, 0, 10, 9), 0.9),     # juste
        (0, (20, 0, 30, 10), 0.8),   # bonne place, mauvaise classe : faux positif
        (1, (40, 0, 50, 10), 0.7),   # classe juste, mauvaise place : faux positif
    ]
    r = evaluate.apparier(verite, predictions)
    assert r["par_classe"][0] == {"tp": 1, "fp": 1, "fn": 0}
    assert r["par_classe"][1] == {"tp": 0, "fp": 1, "fn": 1}
    assert r["predictions_justes"] == {0}


def test_une_verite_n_est_appariee_qu_une_fois():
    verite = [(0, (0, 0, 10, 10))]
    predictions = [(0, (0, 0, 10, 10), 0.6), (0, (0, 0, 10, 10), 0.9)]
    r = evaluate.apparier(verite, predictions)
    assert r["par_classe"][0] == {"tp": 1, "fp": 1, "fn": 0}
    assert r["predictions_justes"] == {1}           # la plus confiante l'emporte


def test_recouvrement_sous_le_seuil_non_compte():
    r = evaluate.apparier([(0, (0, 0, 10, 10))], [(0, (6, 0, 16, 10), 0.9)])
    assert r["par_classe"][0] == {"tp": 0, "fp": 1, "fn": 1}   # IoU 0,25 < 0,50


def test_matrice_de_confusion():
    verite = [(0, (0, 0, 10, 10)), (1, (20, 0, 30, 10)), (1, (60, 0, 70, 10))]
    predictions = [
        (0, (0, 0, 10, 10), 0.9),    # dent vue dent
        (2, (20, 0, 30, 10), 0.8),   # carie vue comme carie profonde
        (0, (40, 0, 50, 10), 0.7),   # dent inventée
    ]                                # la carie en 60 est manquée
    m = evaluate.confusion(verite, predictions, nc=3)
    assert m[0][0] == 1
    assert m[2][1] == 1
    assert m[3][1] == 1              # ligne fond : manquée
    assert m[0][3] == 1              # colonne fond : inventée
    assert sum(map(sum, m)) == 4


# --- Registre du test --------------------------------------------------------

def test_test_evalue_une_seule_fois(tmp_path):
    evaluate.verifier_test_unique(tmp_path, "a" * 64, None)        # première fois : permis
    evaluate.inscrire_test(tmp_path, {"date_utc": "2026-11-22T00:00:00+00:00", "poids": "best.pt",
                                      "poids_sha256": "a" * 64, "motif": None})
    with pytest.raises(SystemExit, match="déjà été évalué"):
        evaluate.verifier_test_unique(tmp_path, "b" * 64, None)
    assert len(evaluate.verifier_test_unique(tmp_path, "b" * 64, "erreur de conversion corrigée")) == 1


# --- Bout en bout ------------------------------------------------------------

@pytest.fixture(scope="module")
def modele_entraine(tmp_path_factory):
    racine = tmp_path_factory.mktemp("eval")
    data = ecrire_jeu(racine / "jeu")
    args = train._parse_args([
        "--data", str(data), "--model", "yolo11n.yaml", "--epochs", "1", "--imgsz", "128",
        "--batch", "4", "--device", "cpu", "--workers", "0", "--amp", "non", "--no-plots",
        "--project", str(racine / "runs"), "--name", "eval"])
    run_dir = train.entrainer(args)
    return run_dir / "weights" / "best.pt", data


@pytest.mark.lent
def test_rapport_complet_sur_la_validation(modele_entraine):
    poids, _ = modele_entraine
    sortie = evaluate.evaluer(evaluate._parse_args(
        ["--weights", str(poids), "--split", "val", "--conf", "0.001", "--device", "cpu"]))

    metrics = json.loads((sortie / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["imgsz"] == 128                                 # relu dans run.json
    assert metrics["decoupage"]["empreinte"] == "0" * 64
    par_classe = metrics["detection"]["par_classe"]
    assert set(par_classe) == set(train.CLASSES)
    # Présentes dans les étiquettes : mesurées (zéro au pire), jamais « absentes ».
    assert par_classe["tooth"]["instances"] == 24 and par_classe["caries"] is not None
    assert par_classe["periapical_lesion"] is None       # aucune dans le jeu synthétique
    assert {"precision", "rappel", "mAP50", "mAP50_95"} <= metrics["detection"]["global"].keys()
    n = len(train.CLASSES) + 1
    m = metrics["detection"]["confusion"]["matrice"]
    assert len(m) == n and all(len(l) == n for l in m)
    # Chaque vérité terrain est comptée une fois : appariée ou manquée.
    total_verite = sum(c["instances"] for c in par_classe.values() if c)
    assert sum(m[i][j] for i in range(n) for j in range(n - 1)) == total_verite
    assert metrics["niveau_image"]["n_images"] == 4
    assert cv2.imread(str(sortie / "confusion.png")) is not None
    assert cv2.imread(str(sortie / "pires_erreurs.jpg")) is not None
    assert "| **global** |" in (sortie / "rapport.md").read_text(encoding="utf-8")


@pytest.mark.lent
def test_second_passage_sur_le_test_refuse(modele_entraine):
    poids, data = modele_entraine
    args = ["--weights", str(poids), "--split", "test", "--device", "cpu"]
    evaluate.evaluer(evaluate._parse_args(args))
    assert (data.parent / evaluate.REGISTRE_TEST).exists()
    with pytest.raises(SystemExit, match="déjà été évalué"):
        evaluate.evaluer(evaluate._parse_args(args))
    sortie = evaluate.evaluer(evaluate._parse_args([*args, "--forcer", "essai du registre"]))
    metrics = json.loads((sortie / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["motif_reevaluation"] == "essai du registre"
    assert len((data.parent / evaluate.REGISTRE_TEST).read_text().splitlines()) == 2
