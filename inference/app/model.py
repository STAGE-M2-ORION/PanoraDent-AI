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


def _boites(modele, image, garder, imgsz: int | None = None) -> list[dict]:
    """Détections d'un modèle YOLO, en pixels de l'image source.

    `imgsz` (taille d'entraînement du modèle) redimensionne en letterbox pour
    l'inférence ; ultralytics remet les boîtes à l'échelle de l'image
    d'origine. `garder(label)` filtre les classes.
    """
    noms = noms_des_classes(modele)
    dets = []
    for r in modele.predict(image, imgsz=imgsz or config.MODEL_IMAGE_SIZE,
                            conf=config.MODEL_CONF_THRESHOLD, verbose=False):
        for box in r.boxes:
            cls_id = int(box.cls[0])
            nom = noms[cls_id] if cls_id < len(noms) else str(cls_id)
            label, rang = classe_et_rang(nom)
            if not garder(label):
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            det = {
                "label": label,
                "fdi": None,  # renseigné ensuite par la numérotation (fdi.py)
                "confidence": round(float(box.conf[0]), 2),
                "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
            }
            if rang is not None:
                det["rang"] = rang
            dets.append(det)
    return dets


def noms_des_classes(modele) -> list[str]:
    """Classes du modèle, lues dans ses poids (ultralytics les y enregistre) :
    contrat (`CLASSES`) ou rangs (`CLASSES_RANGS`, sprint 7). Repli sur le
    contrat pour un modèle qui ne les porte pas."""
    noms = getattr(modele, "names", None)
    if isinstance(noms, dict) and noms:
        return [noms[i] for i in sorted(noms)]
    if isinstance(noms, (list, tuple)) and noms:
        return list(noms)
    return list(config.CLASSES)


def classe_et_rang(nom: str) -> tuple[str, int | None]:
    """`dent_6` -> (`tooth`, 6) ; une classe du contrat -> (classe, None)."""
    if nom in config.CLASSES_RANGS:
        return config.CLASSES[0], config.CLASSES_RANGS.index(nom) + 1
    return nom, None


def _numeroter(dets, width: int, height: int) -> tuple[list[dict], list[dict]]:
    """Détections numérotées et incohérences signalées (fdi.py)."""
    if not config.ASSIGN_FDI:
        return dets, []
    return dets, fdi.numeroter(dets, width, height)


def predict_paire(paire, image, width: int, height: int) -> tuple[list[dict], list[dict]]:
    """Une version = deux modèles. Chacun ne garde que ses propres classes :
    le modèle « dents » n'a appris que `tooth`, le modèle « anomalies » que les
    diagnostics ; une sortie hors de son rôle serait du bruit. Les dents
    servent ensuite à numéroter, et les anomalies héritent du numéro de la
    dent qu'elles recouvrent."""
    dents = _boites(paire.dents, image, lambda label: label == config.CLASSES[0], paire.imgsz["dents"])
    anomalies = _boites(paire.anomalies, image, lambda label: label != config.CLASSES[0],
                        paire.imgsz["anomalies"])
    return _numeroter(dents + anomalies, width, height)


def predict(image, width: int, height: int):
    """Mode historique (un seul fichier `MODEL_WEIGHTS_PATH`) ou mock."""
    if _mode == "real" and _model is not None:
        return _numeroter(_boites(_model, image, lambda label: True), width, height)[0]
    return _mock_detections(width, height)
