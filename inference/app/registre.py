"""Registre des paires de modèles chargées en mémoire.

Le chargement est vérifié : si le backend fournit l'empreinte sha256 attendue
d'un fichier de poids, le fichier présent sur le disque doit la porter, sinon
la version est refusée. Un fichier remplacé après la publication ne sert donc
jamais des détections attribuées à une version qui n'est plus la sienne.
"""
import hashlib
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from . import config

#: Un nom de version est un nom de dossier : aucune séparation de chemin.
VERSION_VALIDE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
ROLES = ("dents", "anomalies")


class ErreurModele(Exception):
    """Erreur attendue, renvoyée au backend avec un code stable."""
    statut = 500
    code = "erreur_modele"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class VersionInvalide(ErreurModele):
    statut, code = 422, "version_invalide"


class ModeleIntrouvable(ErreurModele):
    statut, code = 404, "modele_introuvable"


class PoidsDifferents(ErreurModele):
    statut, code = 409, "poids_differents"


class ModeleIllisible(ErreurModele):
    statut, code = 500, "modele_illisible"


class AucuneVersionActive(ErreurModele):
    statut, code = 503, "aucune_version_active"


@dataclass
class Paire:
    version: str
    dents: object
    anomalies: object
    sha256: dict
    imgsz: dict  # taille d'entraînement de chaque modèle, lue dans ses poids


def taille_d_entrainement(modele) -> int:
    """`imgsz` de l'entraînement, enregistré par ultralytics dans les poids.

    Une inférence à une autre taille que celle de l'entraînement dégrade les
    détections sans aucune erreur : on ne se fie donc pas à un réglage global,
    qui deviendrait faux à la première bascule vers un modèle entraîné
    autrement. Repli sur MODEL_IMAGE_SIZE si les poids ne la portent pas.
    """
    taille = (getattr(modele, "overrides", None) or {}).get("imgsz")
    if isinstance(taille, (list, tuple)):
        taille = max(taille)
    return int(taille) if taille else config.MODEL_IMAGE_SIZE


def sha256_de(chemin: Path) -> str:
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def _charger_yolo(chemin: Path):
    from ultralytics import YOLO  # import tardif : inutile en mode mock
    return YOLO(str(chemin))


class _BoiteFactice:
    def __init__(self, cls_id, xyxy, conf):
        self.cls, self.conf = [cls_id], [conf]
        self.xyxy = [_Liste(xyxy)]


class _Liste(list):
    def tolist(self):
        return list(self)


class ModeleFactice:
    """Tests de bout en bout : même interface que YOLO, sortie du générateur mock."""

    def __init__(self, chemin: Path):
        self.chemin = chemin
        self.overrides = {}

    def predict(self, image, imgsz, conf, verbose):
        from .model import _mock_detections

        largeur, hauteur = image.size
        boites = []
        for d in _mock_detections(largeur, hauteur):
            x, y, w, h = d["bbox"]
            boites.append(_BoiteFactice(config.CLASSES.index(d["label"]), [x, y, x + w, y + h], d["confidence"]))
        return [type("Resultat", (), {"boxes": boites})()]


def _charger_par_defaut(chemin: Path):
    return ModeleFactice(chemin) if config.MODELES_FACTICES else _charger_yolo(chemin)


class Registre:
    def __init__(self, dossier=None, maximum=None, charger=_charger_par_defaut):
        self.dossier = Path(dossier or config.MODEL_WEIGHTS_DIR)
        self.maximum = maximum or config.MODEL_CACHE_MAX
        self._charger = charger
        self._cache: OrderedDict[tuple, Paire] = OrderedDict()
        self._verrou = threading.Lock()

    def chemin(self, version: str, role: str) -> Path:
        if not VERSION_VALIDE.match(version or ""):
            raise VersionInvalide(f"Nom de version invalide : {version!r}.")
        return self.dossier / version / f"{role}.pt"

    def obtenir(self, version: str, attendu: dict | None = None) -> Paire:
        """Paire chargée (ou à charger) pour cette version.

        `attendu` : {"dents": sha256, "anomalies": sha256} ; les clés absentes
        ne sont pas vérifiées. La clé du cache contient ces empreintes : une
        empreinte différente recharge, elle ne ressert pas l'ancienne paire.
        """
        attendu = {r: (attendu or {}).get(r) or None for r in ROLES}
        cle = (version, attendu["dents"], attendu["anomalies"])
        with self._verrou:
            if cle in self._cache:
                self._cache.move_to_end(cle)
                return self._cache[cle]
            paire = self._charger_paire(version, attendu)
            self._cache[cle] = paire
            while len(self._cache) > self.maximum:
                self._cache.popitem(last=False)
            return paire

    def _charger_paire(self, version: str, attendu: dict) -> Paire:
        modeles, empreintes = {}, {}
        for role in ROLES:
            chemin = self.chemin(version, role)
            if not chemin.is_file():
                raise ModeleIntrouvable(
                    f"Le modèle « {role} » de la version {version} n'est pas installé "
                    f"sur le service d'analyse.")
            empreintes[role] = sha256_de(chemin)
            if attendu[role] and empreintes[role] != attendu[role]:
                raise PoidsDifferents(
                    f"Le fichier « {role} » de la version {version} n'est pas celui qui a été "
                    f"publié (empreinte différente) : refusé.")
            try:
                modeles[role] = self._charger(chemin)
            except Exception as exc:  # noqa: BLE001
                raise ModeleIllisible(
                    f"Le modèle « {role} » de la version {version} est illisible : {exc}") from exc
        return Paire(version, modeles["dents"], modeles["anomalies"], empreintes,
                     {role: taille_d_entrainement(m) for role, m in modeles.items()})

    def installees(self) -> list[str]:
        """Versions dont les DEUX fichiers sont présents dans le dossier des poids."""
        if not self.dossier.is_dir():
            return []
        return sorted(d.name for d in self.dossier.iterdir()
                      if d.is_dir() and VERSION_VALIDE.match(d.name)
                      and all((d / f"{role}.pt").is_file() for role in ROLES))

    def chargees(self) -> list[str]:
        with self._verrou:
            return [cle[0] for cle in self._cache]
