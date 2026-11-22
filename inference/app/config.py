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
# 0,10 (décision du sprint 4) : tout ce qui dépasse 0,10 est enregistré, et le
# curseur de seuil de la visionneuse filtre côté écran, sans aller-retour.
MODEL_CONF_THRESHOLD = float(os.getenv("MODEL_CONF_THRESHOLD", "0.10"))

# Refuse de démarrer en mock si un vrai modèle était attendu. À activer partout
# où l'on mesure quoi que ce soit : une bascule silencieuse ferait passer des
# détections factices pour des résultats.
MODEL_STRICT = _flag("MODEL_STRICT")

# Numérotation FDI dérivée de la géométrie des boîtes (app/fdi.py).
ASSIGN_FDI = _flag("ASSIGN_FDI", "1")

# --- Registre de modèles (sprint 6, lot B) -----------------------------------
# Une VERSION est une paire de modèles : `dents.pt` (classe tooth) et
# `anomalies.pt` (les quatre diagnostics), rangés sous
# <MODEL_WEIGHTS_DIR>/<version>/. Le backend désigne la version à chaque
# requête ; le service n'a ni base ni état partagé : tout vient de la requête
# et du disque. Plusieurs versions restent en mémoire (la plus anciennement
# utilisée est évincée au-delà de MODEL_CACHE_MAX), si bien qu'une bascule
# n'interrompt rien et qu'une file ne mélange jamais deux versions.
MODEL_WEIGHTS_DIR = os.getenv("MODEL_WEIGHTS_DIR", "/weights")
MODEL_CACHE_MAX = max(1, int(os.getenv("MODEL_CACHE_MAX", "3")))

# --- Tests de bout en bout seulement ------------------------------------------
# MODELES_FACTICES=1 : une version du registre est servie par le générateur
# mock au lieu de YOLO (les empreintes des fichiers restent vérifiées). Le
# parcours Playwright peut ainsi publier, activer et comparer des versions sans
# poids réels. Refusé au démarrage si APP_ENV n'est pas « test ».
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
MODELES_FACTICES = _flag("MODELES_FACTICES")
