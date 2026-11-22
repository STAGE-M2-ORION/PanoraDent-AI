"""Mesure de la numérotation : oracle, bout en bout (faux détecteur), test mesuré une fois."""
import json

import pytest

import mesure_numerotation as mn

W, H = 2000, 1000


def boite(fdi):
    """Dent placée selon son numéro : quadrant et rang déterminent la position."""
    q, r = divmod(fdi, 10)
    cote = -1 if q in (1, 4) else 1                       # droite patient = gauche image
    cx = W / 2 + cote * (50 + 100 * (r - 1))
    cy = 350 if q in (1, 2) else 650
    return {"x": (cx - 45) / W, "y": (cy - 75) / H, "w": 90 / W, "h": 150 / H}


def ecrire(dossier, nom, boites, classe="tooth"):
    (dossier / "fdi").mkdir(parents=True, exist_ok=True)
    (dossier / "images").mkdir(parents=True, exist_ok=True)
    (dossier / "fdi" / f"{nom}.json").write_text(json.dumps({
        "source": nom, "largeur": W, "hauteur": H,
        "boites": [{**b, "fdi": f, "classe": c} for f, b, c in boites]}))


@pytest.fixture
def donnees(tmp_path):
    racine = tmp_path / "yolo"
    complet = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27,
               31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47]
    sans_36 = [f for f in complet if f != 36]
    for split in ("val", "test"):
        ecrire(racine / "dents" / split, "c1", [(f, boite(f), "tooth") for f in complet])
        ecrire(racine / "dents" / split, "c2", [(f, boite(f), "tooth") for f in sans_36])
        ecrire(racine / "anomalies" / split, "c2", [(37, boite(37), "caries")])
    (racine / "rangs").mkdir()
    return racine


class FauxDetecteur:
    """Renvoie la vérité (avec ou sans rang) : isole la règle de numérotation."""

    def __init__(self, donnees, avec_rang):
        self.donnees, self.avec_rang = donnees, avec_rang

    def dents(self, image):
        split = image.parent.parent.name
        v = json.loads((self.donnees / "dents" / split / "fdi" / f"{image.stem}.json").read_text())
        out = []
        for b in v["boites"]:
            d = {"label": "tooth", "confidence": 0.9, "bbox": [b["x"] * W, b["y"] * H, b["w"] * W, b["h"] * H]}
            if self.avec_rang:
                d["rang"] = b["fdi"] % 10
            out.append(d)
        return out


def test_oracle_plafond(donnees, tmp_path):
    sortie = mn.mesurer(mn._parse_args(["--oracle", "--split", "val", "--donnees", str(donnees),
                                        "--out", str(tmp_path / "o")]))
    m = json.loads((sortie / "metrics.json").read_text(encoding="utf-8"))
    assert m["dents"]["numerotation"] == 1.0 and m["dents"]["cliches_sans_erreur"] == 2
    assert m["anomalies"] is None                    # pas d'oracle possible sur les anomalies


@pytest.mark.parametrize("avec_rang, attendu_anomalie", [
    (True, 1.0),       # rang appris : la 36 manquante ne décale rien
    (False, 0.0),      # ancienne règle : 37 numérotée 36 sur le cliché sans 36
])
def test_bout_en_bout_rang_appris_contre_regle_d_ordre(donnees, tmp_path, monkeypatch,
                                                       avec_rang, attendu_anomalie):
    monkeypatch.setattr(mn, "Detecteur", lambda *a, **k: FauxDetecteur(donnees, avec_rang))
    sortie = mn.mesurer(mn._parse_args(["--modele", "x.pt", "--split", "val", "--donnees", str(donnees),
                                        "--out", str(tmp_path / "m")]))
    m = json.loads((sortie / "metrics.json").read_text(encoding="utf-8"))
    # Rang 7 : 8 dents sur les deux clichés ; l'ancienne règle se trompe sur la 37 du cliché sans 36.
    assert m["dents"]["par_rang"]["7"] == (1.0 if avec_rang else 0.875)
    assert m["anomalies"]["justes"] == attendu_anomalie      # la carie de la 37 reçoit-elle 37 ?
    assert "| **Bien numérotées**" in (sortie / "rapport.md").read_text(encoding="utf-8")


def test_test_mesure_une_seule_fois(donnees, tmp_path, monkeypatch):
    monkeypatch.setattr(mn, "Detecteur", lambda *a, **k: FauxDetecteur(donnees, True))
    args = ["--modele", "x.pt", "--split", "test", "--donnees", str(donnees), "--out", str(tmp_path / "t")]
    mn.mesurer(mn._parse_args(args))
    with pytest.raises(SystemExit, match="déjà été mesurée"):
        mn.mesurer(mn._parse_args(args))
    mn.mesurer(mn._parse_args([*args, "--forcer", "nouveau modèle"]))
    assert len((donnees / "rangs" / mn.REGISTRE).read_text().splitlines()) == 2
