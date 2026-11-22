"""Sprint 7 : la chaîne accepte la liste de classes des rangs (numérotation hybride)."""
import json

import pytest

import evaluate
import publish_model as pm
import train
from config import CLASSES, CLASSES_RANGS
from conftest import ecrire_jeu
from test_publication import faux_run


def test_ordre_des_classes_admis(tmp_path):
    for noms in (CLASSES, CLASSES_RANGS):
        data = ecrire_jeu(tmp_path / f"jeu{len(noms)}", n_par_partition=(1, 1, 1), noms=noms)
        train.check_class_order(data)
    data = ecrire_jeu(tmp_path / "autre", n_par_partition=(1, 1, 1), noms=list(reversed(CLASSES_RANGS)))
    with pytest.raises(SystemExit, match="ORDRE DES CLASSES"):
        train.check_class_order(data)


def test_publication_modele_dents_en_rangs(tmp_path):
    base = f"sqlite:///{tmp_path / 'r.db'}"
    from sqlalchemy import create_engine, text
    from test_publication import TABLE
    with create_engine(base).begin() as cx:
        cx.execute(text(TABLE))
    dents = faux_run(tmp_path / "dents", b"rangs", classes=CLASSES_RANGS)
    anomalies = faux_run(tmp_path / "anomalies", b"anomalies")
    pm.main(["--version", "v-rangs", "--dents", str(dents), "--anomalies", str(anomalies),
             "--poids", str(tmp_path / "w"), "--database-url", base])
    assert (tmp_path / "w" / "v-rangs" / "dents.pt").read_bytes() == b"rangs"
    # Le modèle anomalies, lui, doit rester au contrat.
    anomalies_rangs = faux_run(tmp_path / "anomalies2", b"x", classes=CLASSES_RANGS)
    with pytest.raises(pm.PublicationRefusee, match="ordre de classes"):
        pm.main(["--version", "v2", "--dents", str(dents), "--anomalies", str(anomalies_rangs),
                 "--poids", str(tmp_path / "w"), "--database-url", base])


@pytest.mark.lent
def test_entrainement_et_evaluation_d_un_modele_rangs(tmp_path):
    data = ecrire_jeu(tmp_path / "jeu", noms=CLASSES_RANGS)
    run_dir = train.entrainer(train._parse_args([
        "--data", str(data), "--model", "yolo11n.yaml", "--epochs", "1", "--imgsz", "128",
        "--batch", "4", "--device", "cpu", "--workers", "0", "--amp", "non", "--no-plots",
        "--project", str(tmp_path / "runs"), "--name", "rangs"]))
    assert json.loads((run_dir / "run.json").read_text(encoding="utf-8"))["classes"] == CLASSES_RANGS
    sortie = evaluate.evaluer(evaluate._parse_args(
        ["--weights", str(run_dir / "weights" / "best.pt"), "--split", "val", "--device", "cpu"]))
    metrics = json.loads((sortie / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["classes"] == CLASSES_RANGS
    assert set(metrics["detection"]["par_classe"]) == set(CLASSES_RANGS)
    assert metrics["detection"]["confusion"]["etiquettes"] == CLASSES_RANGS + ["fond"]
