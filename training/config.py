"""Constantes partagées du pipeline d'entraînement.

L'ordre des classes n'est **pas redéfini ici**. Il est lu directement dans
`inference/app/config.py`, qui fait foi : l'index appris par le détecteur et
l'index interprété par le service doivent être le même, ou toutes les
prédictions sont décalées d'une classe sans qu'aucun test ne le signale.
"""
import importlib.util
import subprocess
from pathlib import Path

import numpy as np


def assurer_compat_numpy() -> None:
    """Pont numpy 2 pour ultralytics 8.3.40.

    `np.trapz` a été retiré en numpy 2.0 (renommé `np.trapezoid`, même
    calcul). ultralytics 8.3.40 l'appelle encore pour l'AP (seul appel
    concerné, vérifié dans tout son code) : sans ce pont, la validation casse
    en fin d'époque sur Colab (numpy 2.x). Sans effet sous numpy 1.x, où
    `np.trapz` existe. Appelé à l'import de ce module, que tous les scripts
    importent avant ultralytics.
    """
    if not hasattr(np, "trapz"):
        np.trapz = np.trapezoid


assurer_compat_numpy()

REPO_ROOT = Path(__file__).resolve().parent.parent
INFERENCE_CONFIG = REPO_ROOT / "inference" / "app" / "config.py"


def _inference_config():
    if not INFERENCE_CONFIG.exists():
        raise FileNotFoundError(
            f"{INFERENCE_CONFIG} introuvable : l'ordre des classes ne peut pas "
            f"être garanti. Lancer les scripts depuis le dépôt."
        )
    spec = importlib.util.spec_from_file_location("_panoradent_inference_config",
                                                  INFERENCE_CONFIG)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


#: Ordre contractuel des classes — index YOLO ↔ libellé du service.
CLASSES: list[str] = list(_inference_config().CLASSES)

#: Classes du modèle « rangs » (sprint 7) : rang 1 à 8 de chaque dent.
CLASSES_RANGS: list[str] = list(_inference_config().CLASSES_RANGS)

#: Listes de classes admises pour un jeu : celle du contrat, ou celle des rangs.
LISTES_ADMISES = (CLASSES, CLASSES_RANGS)

#: Classe portant la denture ; les autres sont des anomalies.
TOOTH_CLASS = "tooth"
ANOMALY_CLASSES = [c for c in CLASSES if c != TOOTH_CLASS]


def git_commit() -> str:
    """Empreinte du dépôt, écrite dans chaque run pour la reproductibilité."""
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             cwd=REPO_ROOT, capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or "inconnu"
    except Exception:
        return "inconnu"
