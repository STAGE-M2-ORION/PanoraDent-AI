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
    """Renvoie toujours les mêmes boîtes : (classe, x1, y1, x2, y2, confiance).
    `overrides` imite ce qu'ultralytics relit dans les poids (taille d'entraînement)."""

    def __init__(self, chemin, boites, imgsz=None):
        self.chemin = chemin
        self._boites = [Boite(c, [x1, y1, x2, y2], s) for c, x1, y1, x2, y2, s in boites]
        self.overrides = {"imgsz": imgsz} if imgsz else {}
        self.tailles = []

    def predict(self, image, imgsz, conf, verbose):
        self.tailles.append(imgsz)
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
    dets, _ = model.predict_paire(paire, None, 1000, 1000)
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


def test_mode_strict_demarre_sur_les_versions_publiees(tmp_path, monkeypatch):
    """Production : aucun model.pt historique, une paire publiée. Le service
    démarre, ne sert que des versions demandées, jamais le mock."""
    monkeypatch.setattr(config, "MODEL_STRICT", True)
    monkeypatch.setattr(config, "MODEL_WEIGHTS_PATH", str(tmp_path / "absent.pt"))
    reg = Registre(dossier=tmp_path)
    assert reg.installees() == []
    with pytest.raises(RuntimeError, match="aucune version publiée"):
        model.load_model(reg.installees())

    poser(tmp_path, "dentex-2026.11")
    (tmp_path / "incomplete").mkdir()
    (tmp_path / "incomplete" / "dents.pt").write_bytes(b"x")     # paire incomplète : ignorée
    assert reg.installees() == ["dentex-2026.11"]
    model.load_model(reg.installees())
    assert model.mode() == "registre"
    try:
        r = TestClient(main.app).post("/infer", files={"file": ("x.png", png(), "image/png")})
        assert r.status_code == 503 and r.json()["code"] == "aucune_version_active"
    finally:
        monkeypatch.setattr(config, "MODEL_STRICT", False)
        model.load_model()                                         # retour au mock pour les autres tests


def test_charger_avant_bascule(client, tmp_path):
    empreintes = poser(tmp_path)
    r = client.post("/charger", json={"version": "v1", "sha_dents": empreintes["dents"]})
    assert r.status_code == 200 and r.json()["versions_chargees"] == ["v1"]
    assert client.get("/health").json()["versions_chargees"] == ["v1"]
    r = client.post("/charger", json={"version": "v1", "sha_dents": "0" * 64})
    assert r.status_code == 409 and r.json()["code"] == "poids_differents"


def test_chaque_modele_infere_a_sa_taille_d_entrainement(tmp_path):
    """La taille vient des poids, pas d'un réglage global qui deviendrait faux
    à la première bascule vers un modèle entraîné autrement."""
    poser(tmp_path)
    tailles = {"dents": 1024, "anomalies": None}
    registre = Registre(dossier=tmp_path, charger=lambda c: FauxYolo(c, SORTIES[c.stem], tailles[c.stem]))
    paire = registre.obtenir("v1")
    assert paire.imgsz == {"dents": 1024, "anomalies": config.MODEL_IMAGE_SIZE}
    model.predict_paire(paire, None, 1000, 1000)
    assert paire.dents.tailles == [1024]
    assert paire.anomalies.tailles == [config.MODEL_IMAGE_SIZE]   # poids muets : repli


def test_modeles_factices_pour_les_tests_de_bout_en_bout(tmp_path):
    from app.registre import ModeleFactice

    poser(tmp_path)
    paire = Registre(dossier=tmp_path, charger=ModeleFactice).obtenir("v1")
    image = Image.new("L", (2000, 1000), 40)
    dets, _ = model.predict_paire(paire, image, 2000, 1000)
    attendu = model._mock_detections(2000, 1000)
    assert sorted(d["label"] for d in dets) == sorted(d["label"] for d in attendu)


def test_modeles_factices_refuses_hors_tests(monkeypatch):
    import importlib

    monkeypatch.setattr(config, "MODELES_FACTICES", True)
    monkeypatch.setattr(config, "APP_ENV", "production")
    with pytest.raises(RuntimeError, match="réservé aux tests"):
        importlib.reload(main)
    monkeypatch.setattr(config, "MODELES_FACTICES", False)
    importlib.reload(main)
