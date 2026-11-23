"""Publication d'une paire : contrôles, poids immuables, registre, rien d'activé."""
import json

import pytest
from sqlalchemy import create_engine, text

import publish_model as pm
from config import CLASSES

TABLE = """CREATE TABLE model_versions (
    id TEXT PRIMARY KEY, version TEXT UNIQUE, created_at TIMESTAMP, dataset TEXT,
    metrics_json TEXT, notes TEXT, poids_dents TEXT, poids_anomalies TEXT,
    sha256_dents TEXT, sha256_anomalies TEXT, empreinte_decoupage TEXT,
    actif BOOLEAN, active_le TIMESTAMP, seuils JSON)"""


def faux_run(dossier, poids=b"poids", empreinte="e" * 64, classes=CLASSES, externe=False):
    (dossier / "weights").mkdir(parents=True)
    (dossier / "weights" / "best.pt").write_bytes(poids)
    (dossier / "run.json").write_text(json.dumps(
        {"classes": classes, "decoupage": {"empreinte": empreinte}, "git_commit": "abc1234"}))
    for nom in ["evaluation_test"] + (["evaluation_externe_test"] if externe else []):
        (dossier / nom).mkdir()
        (dossier / nom / "metrics.json").write_text(json.dumps({
            "classes": classes, "split": "test",
            "detection": {"global": {"mAP50": 0.61, "precision": 0.7, "rappel": 0.55, "mAP50_95": 0.3}},
            "niveau_image": {"n_images": 109},
        }))
    return dossier


@pytest.fixture
def base(tmp_path):
    url = f"sqlite:///{tmp_path / 'registre.db'}"
    with create_engine(url).begin() as cx:
        cx.execute(text(TABLE))
    return url


def publier(tmp_path, base, version="dentex-2026.11", **runs):
    dents = runs.get("dents") or faux_run(tmp_path / "dents", b"poids-dents")
    anomalies = runs.get("anomalies") or faux_run(tmp_path / "anomalies", b"poids-anomalies", externe=True)
    pm.main(["--version", version, "--dents", str(dents), "--anomalies", str(anomalies),
             "--poids", str(tmp_path / "weights"), "--database-url", base])
    return dents, anomalies


def lignes(base):
    with create_engine(base).connect() as cx:
        return [dict(r._mapping) for r in cx.execute(text("SELECT * FROM model_versions"))]


def test_paire_publiee_non_active(tmp_path, base):
    publier(tmp_path, base)
    assert (tmp_path / "weights/dentex-2026.11/dents.pt").read_bytes() == b"poids-dents"
    assert (tmp_path / "weights/dentex-2026.11/anomalies.pt").read_bytes() == b"poids-anomalies"
    [l] = lignes(base)
    assert l["version"] == "dentex-2026.11" and not l["actif"]
    assert l["poids_dents"] == "dentex-2026.11/dents.pt"
    assert l["sha256_dents"] == pm.sha256_de(tmp_path / "weights/dentex-2026.11/dents.pt")
    assert l["empreinte_decoupage"] == "e" * 64
    metrics = json.loads(l["metrics_json"])
    assert metrics["map50"] == 0.61 and metrics["test_images"] == 109     # résumé à plat
    assert metrics["externe"] is not None and metrics["dents"]["split"] == "test"


def test_decoupages_differents_refuses(tmp_path, base):
    dents = faux_run(tmp_path / "dents", empreinte="a" * 64)
    with pytest.raises(pm.PublicationRefusee, match="même découpage"):
        publier(tmp_path, base, dents=dents)
    assert lignes(base) == [] and not (tmp_path / "weights").exists()


def test_ordre_des_classes_verifie(tmp_path, base):
    dents = faux_run(tmp_path / "dents", classes=list(reversed(CLASSES)))
    with pytest.raises(pm.PublicationRefusee, match="ordre de classes"):
        publier(tmp_path, base, dents=dents)


def test_mesures_du_test_exigees(tmp_path, base):
    anomalies = faux_run(tmp_path / "anomalies")
    (anomalies / "evaluation_test" / "metrics.json").unlink()
    with pytest.raises(pm.PublicationRefusee, match="mesures"):
        publier(tmp_path, base, anomalies=anomalies)


def test_version_publiee_immuable(tmp_path, base):
    dents, anomalies = publier(tmp_path, base)
    publier(tmp_path, base, dents=dents, anomalies=anomalies)          # reprise : mêmes fichiers, accepté
    assert len(lignes(base)) == 1
    (dents / "weights" / "best.pt").write_bytes(b"nouveaux poids")
    with pytest.raises(pm.PublicationRefusee, match="ne change plus"):
        publier(tmp_path, base, dents=dents, anomalies=anomalies)
    assert (tmp_path / "weights/dentex-2026.11/dents.pt").read_bytes() == b"poids-dents"


@pytest.mark.parametrize("version", ["../x", "a/b", "", ".cache"])
def test_nom_de_version_valide(tmp_path, base, version):
    with pytest.raises(pm.PublicationRefusee, match="invalide"):
        publier(tmp_path, base, version=version)


def ecrire_seuils(run, sha, split="val"):
    (run / "seuils_exploitation.json").write_text(json.dumps({
        "split": split, "poids_sha256": sha,
        "par_classe": {"caries": {"seuil": 0.1, "rappel": 0.6}, "impacted_tooth": {"seuil": 0.25, "rappel": 0.94}}}))


def test_seuils_d_exploitation_publies_avec_la_paire(tmp_path, base):
    anomalies = faux_run(tmp_path / "anomalies", b"poids-anomalies", externe=True)
    ecrire_seuils(anomalies, pm.sha256_de(anomalies / "weights" / "best.pt"))
    publier(tmp_path, base, anomalies=anomalies)
    [l] = lignes(base)
    assert json.loads(l["seuils"]) == {"caries": 0.1, "impacted_tooth": 0.25}
    assert json.loads(l["metrics_json"])["seuils_exploitation"]["split"] == "val"


def test_sans_seuils_publication_possible(tmp_path, base):
    publier(tmp_path, base)
    assert lignes(base)[0]["seuils"] is None


@pytest.mark.parametrize("sha, split, message", [("0" * 64, "val", "autres poids"), (None, "test", "validation")])
def test_seuils_d_autres_poids_ou_du_test_refuses(tmp_path, base, sha, split, message):
    anomalies = faux_run(tmp_path / "anomalies", b"poids-anomalies")
    ecrire_seuils(anomalies, sha or pm.sha256_de(anomalies / "weights" / "best.pt"), split)
    with pytest.raises(pm.PublicationRefusee, match=message):
        publier(tmp_path, base, anomalies=anomalies)
    assert lignes(base) == []
