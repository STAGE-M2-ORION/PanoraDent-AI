"""Registre de versions : chargement vérifié, cache, paire dents + anomalies.

De faux modèles remplacent YOLO : ni ultralytics ni poids réels ne sont
nécessaires, et la CI les fait tourner telle quelle.
"""
import hashlib
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, main, model
from app.registre import ModeleIntrouvable, PoidsDifferents, Registre, VersionInvalide


class Boite:
    def __init__(self, cls, xyxy, conf):
        self.cls, self.xyxy, self.conf = [cls], [_Liste(xyxy)], [conf]


class _Liste(list):
    def tolist(self):
        return list(self)


class FauxYolo:
    """Renvoie toujours les mêmes boîtes : (classe, x1, y1, x2, y2, confiance)."""

    def __init__(self, chemin, boites):
        self.chemin = chemin
        self._boites = [Boite(c, [x1, y1, x2, y2], s) for c, x1, y1, x2, y2, s in boites]

    def predict(self, image, imgsz, conf, verbose):
        return [type("R", (), {"boxes": self._boites})()]


DENT, CARIE = config.CLASSES.index("tooth"), config.CLASSES.index("caries")
SORTIES = {
    # Le modèle « dents » sort aussi, par erreur, une carie : elle doit être ignorée.
    "dents": [(DENT, 100, 300, 200, 500, 0.9), (CARIE, 0, 0, 10, 10, 0.8)],
    # Le modèle « anomalies » sort une carie sur cette dent, et une « dent » parasite.
    "anomalies": [(CARIE, 120, 320, 180, 400, 0.7), (DENT, 600, 300, 700, 500, 0.9)],
}


def poser(dossier, version="v1", contenu=None):
    contenu = contenu or {"dents": b"poids-dents", "anomalies": b"poids-anomalies"}
    (dossier / version).mkdir(parents=True, exist_ok=True)
    for role, octets in contenu.items():
        (dossier / version / f"{role}.pt").write_bytes(octets)
    return {role: hashlib.sha256(octets).hexdigest() for role, octets in contenu.items()}


@pytest.fixture
def chargements():
    return []


@pytest.fixture
def registre(tmp_path, chargements):
    def charger(chemin):
        chargements.append(chemin)
        return FauxYolo(chemin, SORTIES[chemin.stem])
    return Registre(dossier=tmp_path, maximum=2, charger=charger)


def test_paire_chargee_une_seule_fois(registre, tmp_path, chargements):
    empreintes = poser(tmp_path)
    a = registre.obtenir("v1", empreintes)
    b = registre.obtenir("v1", empreintes)
    assert a is b
    assert len(chargements) == 2                     # dents + anomalies, une fois
    assert a.sha256 == empreintes


def test_plusieurs_versions_en_memoire_puis_eviction(registre, tmp_path, chargements):
    for v in ("v1", "v2", "v3"):
        poser(tmp_path, v)
    registre.obtenir("v1")
    registre.obtenir("v2")
    registre.obtenir("v1")                           # v1 redevient la plus récente
    registre.obtenir("v3")                           # évince v2, la moins récemment servie
    assert registre.chargees() == ["v1", "v3"]


def test_version_absente_jamais_remplacee_par_le_mock(registre):
    with pytest.raises(ModeleIntrouvable, match="n'est pas installé"):
        registre.obtenir("v9")


def test_poids_alteres_refuses(registre, tmp_path):
    empreintes = poser(tmp_path)
    (tmp_path / "v1" / "anomalies.pt").write_bytes(b"autre chose")
    with pytest.raises(PoidsDifferents, match="anomalies"):
        registre.obtenir("v1", empreintes)


@pytest.mark.parametrize("version", ["../v1", "v1/../../etc", "", ".cache", "a b"])
def test_nom_de_version_qui_sortirait_du_dossier_refuse(registre, version):
    with pytest.raises(VersionInvalide):
        registre.obtenir(version)


def test_paire_chaque_modele_garde_ses_classes_puis_numerotation(registre, tmp_path):
    poser(tmp_path)
    paire = registre.obtenir("v1")
    dets = model.predict_paire(paire, None, 1000, 1000)
    assert sorted(d["label"] for d in dets) == ["caries", "tooth"]
    dent = next(d for d in dets if d["label"] == "tooth")
    carie = next(d for d in dets if d["label"] == "caries")
    assert dent["fdi"] is not None
    assert carie["fdi"] == dent["fdi"]               # la carie hérite du numéro de sa dent


# --- Routes -------------------------------------------------------------------

@pytest.fixture
def client(registre, monkeypatch):
    monkeypatch.setattr(main, "registre", registre)
    return TestClient(main.app)


def png():
    tampon = io.BytesIO()
    Image.new("L", (1000, 1000), 40).save(tampon, "PNG")
    return tampon.getvalue()


def test_infer_par_version(client, tmp_path):
    empreintes = poser(tmp_path)
    r = client.post("/infer", files={"file": ("x.png", png(), "image/png")},
                    data={"version": "v1", "sha_dents": empreintes["dents"],
                          "sha_anomalies": empreintes["anomalies"]})
    assert r.status_code == 200
    corps = r.json()
    assert corps["mode"] == "real" and corps["model_version"] == "v1"
    assert corps["poids_sha256"] == empreintes
    assert {d["label"] for d in corps["detections"]} == {"tooth", "caries"}


def test_infer_version_inconnue_erreur_codee(client):
    r = client.post("/infer", files={"file": ("x.png", png(), "image/png")}, data={"version": "v9"})
    assert r.status_code == 404
    assert r.json()["code"] == "modele_introuvable"


def test_infer_sans_version_reste_le_mode_historique(client):
    r = client.post("/infer", files={"file": ("x.png", png(), "image/png")})
    assert r.status_code == 200
    assert r.json()["mode"] == "mock"                # aucun model.pt dans le conteneur de test


def test_charger_avant_bascule(client, tmp_path):
    empreintes = poser(tmp_path)
    r = client.post("/charger", json={"version": "v1", "sha_dents": empreintes["dents"]})
    assert r.status_code == 200 and r.json()["versions_chargees"] == ["v1"]
    assert client.get("/health").json()["versions_chargees"] == ["v1"]
    r = client.post("/charger", json={"version": "v1", "sha_dents": "0" * 64})
    assert r.status_code == 409 and r.json()["code"] == "poids_differents"
