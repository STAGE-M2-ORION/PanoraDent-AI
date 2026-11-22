import json

import pytest

import comparer_essais as ce


def ecrire_run(racine, nom, map50, split="val", empreinte="f22d", imgsz=1024, reeq=0.0, petites=(3, 10)):
    run = racine / nom
    (run / "evaluation_val").mkdir(parents=True)
    (run / "run.json").write_text(json.dumps({
        "modele_initial": "yolo11s.pt", "duree_derniere_session_s": 7200,
        "hyperparametres": {"imgsz": imgsz, "reequilibrage": reeq}, "data_yaml": "x/data.yaml"}))
    k, n = petites
    (run / "evaluation_val" / "metrics.json").write_text(json.dumps({
        "split": split, "decoupage": {"empreinte": empreinte},
        "detection": {
            "global": {"mAP50": map50},
            "par_classe": {"caries": {"mAP50": map50, "rappel": 0.4}, "tooth": None},
            "rappel_par_taille": {"par_classe": {"caries": [
                {"tranche": "16–32 px", "n": n, "trouvees": k},
                {"tranche": "≥ 64 px", "n": 5, "trouvees": 5}]}},
        }}))
    return run


def test_tableau_designe_le_meilleur_sur_la_validation(tmp_path):
    a = ce.lire_essai(ecrire_run(tmp_path, "anomalies-v1", 0.586))
    b = ce.lire_essai(ecrire_run(tmp_path, "anomalies-e1", 0.631, imgsz=1280, reeq=0.3, petites=(6, 10)))
    texte = ce.tableau([a, b])
    assert "| **anomalies-e1** | yolo11s | 1280 | 0.3 | 2.0 | 0.631 | 0.631 / 0.400 | 6/10 |" in texte
    assert "| anomalies-v1 | yolo11s | 1024 | — | 2.0 | 0.586 | 0.586 / 0.400 | 3/10 |" in texte
    assert "comparaison invalide" not in texte


def test_decoupages_differents_signales(tmp_path):
    a = ce.lire_essai(ecrire_run(tmp_path, "a", 0.5))
    b = ce.lire_essai(ecrire_run(tmp_path, "b", 0.6, empreinte="autre"))
    assert "comparaison invalide" in ce.tableau([a, b])


def test_refuse_une_evaluation_du_test(tmp_path):
    with pytest.raises(SystemExit, match="validation"):
        ce.lire_essai(ecrire_run(tmp_path, "t", 0.5, split="test"))
    with pytest.raises(SystemExit, match="evaluate.py --split val"):
        ce.lire_essai(tmp_path / "inexistant")
