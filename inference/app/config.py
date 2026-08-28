import os


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


MODEL_WEIGHTS_PATH = os.getenv("MODEL_WEIGHTS_PATH", "/weights/model.pt")
MODEL_VERSION = os.getenv("MODEL_VERSION", "mock-0.0.0")

# Classes du périmètre PRD (§3 / §5.2).
# ORDRE CONTRACTUEL : l'index renvoyé par le détecteur est mappé sur cette
# liste. L'entraînement DOIT utiliser exactement cet ordre — training/config.py
# le lit ici même pour qu'il n'existe qu'une seule source de vérité.
CLASSES = ["tooth", "caries", "deep_caries", "periapical_lesion", "impacted_tooth"]

# --- Mode réel : le prétraitement doit être IDENTIQUE à l'entraînement -------
# `imgsz` reproduit le redimensionnement letterbox appliqué pendant
# l'entraînement. Une valeur divergente dégrade silencieusement les détections.
MODEL_IMAGE_SIZE = int(os.getenv("MODEL_IMAGE_SIZE", "640"))
MODEL_CONF_THRESHOLD = float(os.getenv("MODEL_CONF_THRESHOLD", "0.25"))

# Refuse de démarrer en mock si un vrai modèle était attendu. À activer partout
# où l'on mesure quoi que ce soit : une bascule silencieuse ferait passer des
# détections factices pour des résultats.
MODEL_STRICT = _flag("MODEL_STRICT")

# Numérotation FDI dérivée de la géométrie des boîtes (app/fdi.py).
ASSIGN_FDI = _flag("ASSIGN_FDI", "1")
