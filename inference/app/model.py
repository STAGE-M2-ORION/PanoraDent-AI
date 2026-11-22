"""Chargement du modèle et inférence.

Deux modes :
- RÉEL : si un fichier de poids existe, on charge YOLO (ultralytics) et on infère.
- MOCK : sinon, on renvoie des détections factices mais plausibles, ce qui
  permet de valider toute la chaîne AVANT d'avoir entraîné un modèle.
"""
import os
import random
from . import config, fdi

_model = None
_mode = "mock"


def load_model():
    global _model, _mode
    if os.path.exists(config.MODEL_WEIGHTS_PATH):
        try:
            from ultralytics import YOLO  # import tardif : inutile en mode mock
            _model = YOLO(config.MODEL_WEIGHTS_PATH)
            _mode = "real"
        except Exception as exc:  # pragma: no cover
            if config.MODEL_STRICT:
                raise RuntimeError(
                    f"MODEL_STRICT=1 : poids présents à {config.MODEL_WEIGHTS_PATH} "
                    f"mais illisibles ({exc}). Refus de servir des détections factices."
                ) from exc
            print(f"[inference] échec du chargement du modèle, bascule en mock : {exc}")
            _mode = "mock"
    else:
        if config.MODEL_STRICT:
            raise RuntimeError(
                f"MODEL_STRICT=1 : aucun poids à {config.MODEL_WEIGHTS_PATH}. "
                f"Déposer model.pt ou désactiver MODEL_STRICT."
            )
        _mode = "mock"
    print(f"[inference] mode={_mode} version={config.MODEL_VERSION}")


def mode() -> str:
    return _mode


def _mock_detections(width: int, height: int):
    """Génère quelques boîtes plausibles réparties sur l'arcade."""
    rng = random.Random(width * 7919 + height)  # déterministe par taille d'image
    dets = []
    n_teeth = rng.randint(6, 12)
    for i in range(n_teeth):
        w = width / 16
        h = height / 6
        x = (i / n_teeth) * (width - w)
        y = height / 2 - h / 2 + rng.uniform(-height * 0.05, height * 0.05)
        quadrant = 1 + (i % 4)
        position = 1 + (i % 8)
        dets.append({
            "label": "tooth",
            "fdi": quadrant * 10 + position,
            "confidence": round(rng.uniform(0.80, 0.99), 2),
            "bbox": [round(x), round(y), round(w), round(h)],
        })
    # Quelques anomalies factices sur certaines dents.
    for det in rng.sample(dets, k=min(3, len(dets))):
        anomaly = rng.choice(config.CLASSES[1:])
        x, y, w, h = det["bbox"]
        dets.append({
            "label": anomaly,
            "fdi": det["fdi"],
            "confidence": round(rng.uniform(0.55, 0.90), 2),
            "bbox": [x, y, w, h],
        })
    return dets


def _boites(modele, image, garder) -> list[dict]:
    """Détections d'un modèle YOLO, en pixels de l'image source.

    `imgsz` redimensionne en letterbox pour l'inférence ; ultralytics remet les
    boîtes à l'échelle de l'image d'origine. `garder(label)` filtre les classes.
    """
    dets = []
    for r in modele.predict(image, imgsz=config.MODEL_IMAGE_SIZE,
                            conf=config.MODEL_CONF_THRESHOLD, verbose=False):
        for box in r.boxes:
            cls_id = int(box.cls[0])
            label = config.CLASSES[cls_id] if cls_id < len(config.CLASSES) else str(cls_id)
            if not garder(label):
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            dets.append({
                "label": label,
                "fdi": None,  # renseigné ensuite par déduction géométrique
                "confidence": round(float(box.conf[0]), 2),
                "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
            })
    return dets


def _numeroter(dets, width: int, height: int):
    return fdi.assign_fdi(dets, width, height) if config.ASSIGN_FDI else dets


def predict_paire(paire, image, width: int, height: int):
    """Une version = deux modèles. Chacun ne garde que ses propres classes :
    le modèle « dents » n'a appris que `tooth`, le modèle « anomalies » que les
    diagnostics ; une sortie hors de son rôle serait du bruit. Les dents
    servent ensuite à numéroter, et les anomalies héritent du numéro de la
    dent qu'elles recouvrent."""
    dents = _boites(paire.dents, image, lambda label: label == config.CLASSES[0])
    anomalies = _boites(paire.anomalies, image, lambda label: label != config.CLASSES[0])
    return _numeroter(dents + anomalies, width, height)


def predict(image, width: int, height: int):
    """Mode historique (un seul fichier `MODEL_WEIGHTS_PATH`) ou mock."""
    if _mode == "real" and _model is not None:
        return _numeroter(_boites(_model, image, lambda label: True), width, height)
    return _mock_detections(width, height)
