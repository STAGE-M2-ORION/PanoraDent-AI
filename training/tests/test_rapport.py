"""Rapport d'évaluation : assemblé à partir des runs, figures produites, limites présentes."""
import json

import rapport_evaluation as re_
from test_publication import faux_run


def ajouter_journal(run_dir, n=5):
    lignes = [{"epoque": k, "duree_s": 60.0, "fitness": 0.1 * k if k != 4 else 0.9,
               "pertes": {"train/box_loss": 2 - 0.1 * k, "train/cls_loss": 3 - 0.2 * k, "train/dfl_loss": 1.5},
               "mesures": {"metrics/mAP50(B)": 0.1 * k}} for k in range(1, n + 1)]
    (run_dir / "journal.jsonl").write_text("\n".join(json.dumps(l) for l in lignes))
    run = json.loads((run_dir / "run.json").read_text())
    run.update({"modele_initial": "yolo11s.pt", "hyperparametres": {"imgsz": 1024, "batch": 2, "epochs": 150,
                "patience": 30, "amp": False}, "versions": {"carte": "NVIDIA GeForce GTX 1650"}})
    (run_dir / "run.json").write_text(json.dumps(run))


def test_rapport_complet(tmp_path):
    dents = faux_run(tmp_path / "dents")
    anomalies = faux_run(tmp_path / "anomalies", externe=True)
    for r in (dents, anomalies):
        ajouter_journal(r)
    (anomalies / "evaluation_test" / "metrics.json").write_text(json.dumps({
        "classes": re_.CLASSES, "niveau_image": {"n_images": 109, "par_classe": {"caries": {"sensibilite": 0.8, "specificite": 0.7}}},
        "detection": {"global": {"mAP50": 0.61, "precision": 0.7, "rappel": 0.55, "mAP50_95": 0.3},
                      "par_classe": {"caries": {"instances": 332, "precision": 0.7, "rappel": 0.6, "mAP50": 0.65, "mAP50_95": 0.3},
                                     "tooth": None}}}))
    (anomalies / "evaluation_externe_test" / "metrics.json").write_text(
        (anomalies / "evaluation_test" / "metrics.json").read_text())
    rapport = re_.construire(re_._parse_args(["--version", "v1", "--dents", str(dents),
                                              "--anomalies", str(anomalies), "--out", str(tmp_path / "out")]))
    texte = rapport.read_text(encoding="utf-8")
    assert "# Rapport d'évaluation — version `v1`" in texte
    assert "| Meilleure époque | 4 (mAP@0,50 de validation 0,400) |" in texte
    assert "GTX 1650" in texte and "1024 px · 2" in texte
    assert "| Carie | 332 | 0,700 | 0,600 | 0,650 | 0,300 | 0,800 | 0,700 |" in texte
    assert "Test externe (test officiel DENTEX" in texte and "küretaj" in texte
    assert "## Limites" in texte and "non certifié" in texte
    assert (tmp_path / "out" / "courbes_dents.png").is_file()
    assert (tmp_path / "out" / "courbes_anomalies.png").is_file()


def test_rapport_sans_test_externe_ni_journal(tmp_path):
    dents, anomalies = faux_run(tmp_path / "dents"), faux_run(tmp_path / "anomalies")
    rapport = re_.construire(re_._parse_args(["--version", "v1", "--dents", str(dents),
                                              "--anomalies", str(anomalies), "--out", str(tmp_path / "out")]))
    texte = rapport.read_text(encoding="utf-8")
    assert "> Non évalué." in texte
    assert "| Époques réalisées | 0 sur" in texte
