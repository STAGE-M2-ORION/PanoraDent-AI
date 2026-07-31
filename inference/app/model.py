"""Chargement du modèle et inférence.

Deux modes :
- RÉEL : si un fichier de poids existe, on charge YOLO (ultralytics) et on infère.
- MOCK : sinon, on renvoie des détections factices mais plausibles, ce qui
  permet de valider toute la chaîne AVANT d'avoir entraîné un modèle.
"""
import os
import random
from . import config

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
            print(f"[inference] échec du chargement du modèle, bascule en mock : {exc}")
            _mode = "mock"
    else:
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


def predict(image, width: int, height: int):
    """Retourne une liste de détections normalisées."""
    if _mode == "real" and _model is not None:
        results = _model.predict(image, verbose=False)
        dets = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                xyxy = box.xyxy[0].tolist()
                x1, y1, x2, y2 = xyxy
                dets.append({
                    "label": config.CLASSES[cls_id] if cls_id < len(config.CLASSES) else str(cls_id),
                    "fdi": None,  # à mapper via une logique de numérotation dédiée
                    "confidence": round(float(box.conf[0]), 2),
                    "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                })
        return dets
    return _mock_detections(width, height)
