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


def test_dossier_du_test_externe_distinct_du_test_interne(tmp_path):
    interne = tmp_path / "anomalies" / "data.yaml"
    externe = tmp_path / "externe" / "data.yaml"
    assert evaluate.dossier_evaluation(interne, interne, "test") == "evaluation_test"
    assert evaluate.dossier_evaluation(externe, interne, "test") == "evaluation_externe_test"
    assert evaluate.dossier_evaluation(interne, None, "val") == "evaluation_val"
    # jeu préparé sur Colab, copié en local : même jeu, même dossier
    colab = evaluate.Path("/content/panoradent/data/yolo/anomalies/data.yaml")
    assert evaluate.dossier_evaluation(interne, colab, "val") == "evaluation_val"
    assert evaluate.dossier_evaluation(externe, colab, "test") == "evaluation_externe_test"


def test_rappel_par_taille_a_la_resolution_du_modele():
    """Côté mesuré en pixels VUS par le modèle : une boîte de 40 px sur un cliché
    de 2 048 px ne fait plus que 20 px à 1 024."""
    noms = ["tooth", "caries", "deep_caries"]
    cliches = [{
        "taille": (2048, 1024),
        "verite": [(1, (0, 0, 40, 40)), (1, (100, 100, 300, 300)), (2, (500, 500, 540, 540))],
        # la grande carie est trouvée ; la carie profonde est vue, mais typée « carie »
        "predictions": [(1, (100, 100, 300, 300), 0.9), (1, (500, 500, 540, 540), 0.6)],
        "trouvees": {1},
    }]
    r = evaluate.rappel_par_taille(cliches, 1024, noms)
    assert r["imgsz"] == 1024 and r["tranches"][0] == "< 16 px"
    carie = {c["tranche"]: c for c in r["par_classe"]["caries"]}
    assert carie["16–32 px"] == {"tranche": "16–32 px", "n": 1, "trouvees": 0, "autre_classe": 0, "rappel": 0.0}
    assert carie["≥ 64 px"]["rappel"] == 1.0
    assert r["par_classe"]["deep_caries"] == [
        {"tranche": "16–32 px", "n": 1, "trouvees": 0, "autre_classe": 1, "rappel": 0.0}]
    assert "tooth" not in r["par_classe"]


def test_rapport_montre_le_rappel_par_taille():
    metrics = {"split": "val", "poids": "p.pt", "poids_sha256": "0" * 64, "decoupage": None,
               "imgsz": 1024, "seuil_confiance": 0.25, "date_utc": "x", "git_commit": "y",
               "niveau_image": {"par_classe": {}},
               "detection": {"par_classe": {}, "global": {"precision": 0.5, "rappel": 0.5, "mAP50": 0.5, "mAP50_95": 0.3},
                             "rappel_par_taille": {"imgsz": 1024, "tranches": ["< 16 px", "16–32 px"],
                                                   "par_classe": {"caries": [{"tranche": "16–32 px", "n": 4, "trouvees": 1,
                                                                              "autre_classe": 2, "rappel": 0.25}]}}}}
    texte = evaluate.rapport_markdown(metrics)
    assert "## Rappel selon la taille (côté de la boîte, en pixels à 1024 px)" in texte
    assert "| caries | — | 0.250 (1/4, 2 mal typées) |" in texte


def test_test_deja_evalue_ailleurs_reconnu_par_les_runs(tmp_path):
    """Registre perdu (nouvelle machine, nouvelle session Colab) : l'évaluation
    rangée dans un run rapatrié suffit à bloquer une seconde mesure."""
    jeu = tmp_path / "data" / "anomalies"
    jeu.mkdir(parents=True)
    runs = tmp_path / "runs"
    (runs / "anomalies-v1" / "evaluation_test").mkdir(parents=True)
    (runs / "anomalies-v1" / "evaluation_test" / "metrics.json").write_text(json.dumps({
        "split": "test", "data_yaml": "/content/panoradent/data/yolo/anomalies/data.yaml",
        "date_utc": "2026-11-22T10:00:00+00:00", "poids": "best.pt", "poids_sha256": "a" * 64}))
    # le test d'un AUTRE jeu (externe) ne compte pas pour celui-ci
    (runs / "anomalies-v1" / "evaluation_externe_test").mkdir()
    (runs / "anomalies-v1" / "evaluation_externe_test" / "metrics.json").write_text(json.dumps({
        "split": "test", "data_yaml": "/x/externe/data.yaml"}))

    with pytest.raises(SystemExit, match="anomalies-v1"):
        evaluate.verifier_test_unique(jeu, "b" * 64, None, runs)
    assert len(evaluate.verifier_test_unique(jeu, "b" * 64, "modèle v2 choisi sur la validation", runs)) == 1
    assert evaluate.verifier_test_unique(tmp_path / "data" / "externe", "b" * 64, None, tmp_path / "vide") == []
