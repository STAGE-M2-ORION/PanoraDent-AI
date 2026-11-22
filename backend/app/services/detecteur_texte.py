"""Détection des inscriptions incrustées par réseau de neurones (OpenCV DNN).

Modèle : détecteur de texte DB (PP-OCRv3, anglais) du zoo d'OpenCV,
`modeles_texte/text_detection_en_ppocrv3_2023may.onnx`, licence Apache 2.0
(texte joint). Chargé par `cv2.dnn`, sans PyTorch ; empreinte sha256 vérifiée
au chargement : un fichier altéré n'est jamais utilisé.

Où l'on cherche. Seulement la PÉRIPHÉRIE du cliché : bandes du haut et du bas
(14 % de la hauteur, comme l'heuristique du sprint 3) et bandes latérales
(8 % de la largeur), où les appareils impriment nom, date, cabinet et marque,
parfois à la verticale. Le centre n'est jamais masqué automatiquement : un faux
positif y cacherait des dents. Le praticien vérifie l'aperçu et peut ajouter
des masques à la main.

Ce qu'on écarte. Une ligne de texte est fine et allongée. Une détection à la
fois trapue (allongement < 2) et épaisse (plus de 7 % de la hauteur) est une
tache anatomique (condyle, sinus) : mesuré sur 40 panoramiques DENTEX portant
des inscriptions incrustées, les vraies font au plus 6,4 % de la hauteur, les
faux positifs écartés 8,6 et 12,3 %, pour un allongement de 1,1.
"""
import hashlib
import logging
import os
import threading
from pathlib import Path

import numpy as np

logger = logging.getLogger("uvicorn.error")

MODELE = Path(__file__).resolve().parent.parent / "modeles_texte" / "text_detection_en_ppocrv3_2023may.onnx"
SHA256 = "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587"

BANDE_HAUT = BANDE_BAS = 0.14      # fraction de la hauteur
BANDE_COTE = 0.08                  # fraction de la largeur
EPAISSEUR_MAX = 0.07               # au-delà, et trapue : tache anatomique
ALLONGEMENT_MIN = 2.0
ENTREE_MAX = 2048                  # côté maximal envoyé au réseau (pixels)


class DetecteurIndisponible(RuntimeError):
    """Modèle absent, altéré ou illisible : l'appelant se replie sur l'heuristique."""


class DetecteurTexte:
    def __init__(self, chemin: Path | str | None = None, sha256: str | None = SHA256):
        self.chemin = Path(chemin or os.getenv("TEXTE_MODELE_PATH") or MODELE)
        self.sha256 = sha256
        self._modele = None
        self._verrou = threading.Lock()

    def _charger(self):
        try:
            import cv2
        except ImportError as exc:
            raise DetecteurIndisponible("OpenCV n'est pas installé") from exc
        if not self.chemin.is_file():
            raise DetecteurIndisponible(f"modèle absent : {self.chemin}")
        contenu = self.chemin.read_bytes()
        if self.sha256 and hashlib.sha256(contenu).hexdigest() != self.sha256:
            raise DetecteurIndisponible(f"modèle altéré (empreinte différente) : {self.chemin}")
        try:
            modele = cv2.dnn_TextDetectionModel_DB(cv2.dnn.readNetFromONNX(str(self.chemin)))
        except Exception as exc:  # noqa: BLE001
            raise DetecteurIndisponible(f"modèle illisible : {exc}") from exc
        modele.setBinaryThreshold(0.3)
        modele.setPolygonThreshold(0.5)
        modele.setUnclipRatio(2.0)
        modele.setMaxCandidates(200)
        modele.setInputMean((123.675, 116.28, 103.53))
        modele.setInputScale(1.0 / 255.0 / np.array([0.229, 0.224, 0.225]))
        return modele

    def detecter(self, gris: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Rectangles (x0, y0, x1, y1) en pixels des inscriptions de la périphérie."""
        import cv2

        with self._verrou:  # un modèle cv2.dnn n'est pas prévu pour des appels concurrents
            if self._modele is None:
                self._modele = self._charger()
            hauteur, largeur = gris.shape
            rects = []
            for x0, y0, x1, y1 in bandes(largeur, hauteur):
                bande = gris[y0:y1, x0:x1]
                bh, bw = bande.shape
                echelle = min(1.0, ENTREE_MAX / max(bh, bw))
                if echelle < 1.0:
                    bande = cv2.resize(bande, (round(bw * echelle), round(bh * echelle)), interpolation=cv2.INTER_AREA)
                    bh, bw = bande.shape
                # Le réseau attend des côtés multiples de 32.
                self._modele.setInputSize((-(-bw // 32) * 32, -(-bh // 32) * 32))
                quads, _scores = self._modele.detect(cv2.cvtColor(bande, cv2.COLOR_GRAY2BGR))
                for quad in quads:
                    q = np.asarray(quad, dtype=float) / echelle
                    qx0, qy0, qx1, qy1 = q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()
                    if est_tache(qx1 - qx0, qy1 - qy0, hauteur):
                        continue
                    rects.append((int(x0 + qx0), int(y0 + qy0), int(np.ceil(x0 + qx1)), int(np.ceil(y0 + qy1))))
            return rects


def bandes(largeur: int, hauteur: int) -> list[tuple[int, int, int, int]]:
    """Haut, bas, gauche, droite : la périphérie, jamais le centre."""
    hb, lb = int(hauteur * BANDE_HAUT), int(largeur * BANDE_COTE)
    return [(0, 0, largeur, hb), (0, hauteur - hb, largeur, hauteur),
            (0, 0, lb, hauteur), (largeur - lb, 0, largeur, hauteur)]


def est_tache(largeur_boite: float, hauteur_boite: float, hauteur_image: int) -> bool:
    """Trapue ET épaisse : pas une ligne de texte."""
    court, long_ = sorted((largeur_boite, hauteur_boite))
    if court <= 0:
        return True
    return long_ / court < ALLONGEMENT_MIN and court / hauteur_image > EPAISSEUR_MAX


_detecteur = DetecteurTexte()


def detecteur() -> DetecteurTexte:
    return _detecteur
