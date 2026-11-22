"""Entraînement réel sur le processeur : journal, traçabilité, reprise après coupure.

Modèle construit depuis zéro (`yolo11n.yaml`) : aucun téléchargement.
"""
import csv
import json

import pytest

import train


class Coupure(Exception):
    """Simule une interruption (coupure de courant, Ctrl+C) après une époque."""


def couper_apres_premiere_epoque(trainer):
    if trainer.epoch == 0:
        raise Coupure


def args_cpu(data, projet, **extra):
    return train._parse_args([
        "--data", str(data), "--model", "yolo11n.yaml", "--epochs", "2", "--imgsz", "128",
        "--batch", "4", "--device", "cpu", "--workers", "0", "--amp", "non",
        "--no-plots", "--project", str(projet), "--name", "essai",
        *[x for k, v in extra.items() for x in (f"--{k}", str(v))],
    ])


def lire_journal(run_dir):
    return [json.loads(l) for l in (run_dir / train.JOURNAL).read_text(encoding="utf-8").splitlines()]


@pytest.mark.lent
def test_reprise_apres_interruption(jeu_synthetique, tmp_path):
    args = args_cpu(jeu_synthetique, tmp_path / "runs")
    with pytest.raises(Coupure):
        train.entrainer(args, rappels={"on_fit_epoch_end": couper_apres_premiere_epoque})

    run_dir = tmp_path / "runs" / "essai"
    last = run_dir / "weights" / "last.pt"
    assert last.exists()
    assert [l["epoque"] for l in lire_journal(run_dir)] == [1]

    train.entrainer(train._parse_args(["--reprendre", str(last)]))

    journal = lire_journal(run_dir)
    assert [l["epoque"] for l in journal] == [1, 2]          # repart à 2, sans doublon
    assert all({"pertes", "mesures", "lr", "duree_s"} <= l.keys() for l in journal)
    assert "metrics/mAP50(B)" in journal[-1]["mesures"]
    with (run_dir / "results.csv").open(encoding="utf-8") as f:
        assert len(list(csv.DictReader(f))) == 2
    assert (run_dir / "weights" / "best.pt").exists()

    meta = json.loads((run_dir / train.RUN).read_text(encoding="utf-8"))
    assert meta["decoupage"]["empreinte"] == "0" * 64
    assert meta["classes"] == train.CLASSES
    assert meta["hyperparametres"]["augmentations"]["flipud"] == 0.0
    assert len(meta["reprises"]) == 1
    assert "metrics/mAP50(B)" in meta["validation_meilleur"]   # réévaluation de best.pt


@pytest.mark.parametrize("choix, carte, attendu", [
    ("auto", "NVIDIA GeForce GTX 1650", False),
    ("auto", "NVIDIA GeForce GTX 1660 Ti", False),
    ("auto", "NVIDIA GeForce RTX 3060", True),
    ("auto", None, True),            # processeur : ultralytics la coupe de lui-même
    ("oui", "NVIDIA GeForce GTX 1650", True),
    ("non", "NVIDIA GeForce RTX 3060", False),
])
def test_precision_mixte_selon_la_carte(choix, carte, attendu):
    assert train.resoudre_amp(choix, carte) is attendu


@pytest.mark.lent
def test_perte_nan_arrete_l_entrainement(jeu_synthetique, tmp_path):
    import torch

    def empoisonner(trainer):
        trainer.tloss = torch.tensor([float("nan"), 1.0, 1.0])

    # Posée au début du lot, la perte NaN se propage dans la moyenne courante
    # qu'ultralytics calcule pendant le lot : la garde la voit en fin de lot.
    with pytest.raises(train.PerteNonFinie, match="--amp non"):
        train.entrainer(args_cpu(jeu_synthetique, tmp_path / "runs"),
                        rappels={"on_train_batch_start": empoisonner})


def test_journal_sans_nan():
    assert train._nombre(float("nan"), 3) is None
    assert train._nombre(1.23456, 2) == 1.23


def test_ordre_des_classes_verifie(jeu_synthetique, tmp_path):
    texte = jeu_synthetique.read_text(encoding="utf-8")
    jeu_synthetique.write_text(texte.replace('"tooth", "caries"', '"caries", "tooth"'),
                               encoding="utf-8")
    with pytest.raises(SystemExit, match="ORDRE DES CLASSES"):
        train.entrainer(args_cpu(jeu_synthetique, tmp_path / "runs"))


def test_decoupage_sans_empreinte_refuse(jeu_synthetique, tmp_path):
    (jeu_synthetique.parent / "split.json").write_text("{}")
    with pytest.raises(SystemExit, match="empreinte"):
        train.entrainer(args_cpu(jeu_synthetique, tmp_path / "runs"))


def test_run_existant_jamais_ecrase(jeu_synthetique, tmp_path):
    (tmp_path / "runs" / "essai").mkdir(parents=True)
    with pytest.raises(SystemExit, match="existe déjà"):
        train.entrainer(args_cpu(jeu_synthetique, tmp_path / "runs"))


def test_pont_numpy_2_pour_le_calcul_de_l_ap(monkeypatch):
    """Sous numpy 2 (Colab), np.trapz n'existe plus : le pont le rétablit."""
    import numpy as np

    import config

    if hasattr(np, "trapezoid"):
        monkeypatch.delattr(np, "trapz", raising=False)
    else:  # numpy 1.x : simuler numpy 2
        monkeypatch.setattr(np, "trapezoid", np.trapz, raising=False)
        monkeypatch.delattr(np, "trapz")
    config.assurer_compat_numpy()
    assert np.trapz(np.array([0.0, 1.0]), np.array([0.0, 1.0])) == 0.5
