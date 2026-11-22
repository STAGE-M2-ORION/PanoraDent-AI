"""Worker de la file de traitement : `python -m app.worker`.

Processus séparé du serveur web (une tâche d'arrière-plan du serveur mourrait
avec lui, et l'analyse resterait « en cours » pour toujours). La file est la
table `analyses` elle-même : le statut en base fait foi.

- Prise d'une tâche : `SELECT … FOR UPDATE SKIP LOCKED` sur la plus ancienne
  analyse « en file » — deux workers ne prennent jamais la même.
- Traitement : lecture de l'image anonymisée (pleine résolution), appel du
  service d'inférence, enregistrement des détections au-dessus de 0,10 en
  fractions de l'image, avec la version du modèle et la durée.
- Échec (service d'inférence arrêté, image illisible…) : statut « échouée »
  et message affichable ; le praticien peut relancer.
- Au démarrage : les analyses restées « en cours » (worker arrêté en plein
  traitement) repartent en file au lieu de rester bloquées. Un seul worker
  est prévu ; à plusieurs, seules les tâches plus vieilles que
  `REPRISE_APRES` seraient reprises.
"""
import io
import logging
import signal
import time
from datetime import datetime, timedelta

from PIL import Image
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import auth_models  # noqa: F401  (enregistre les tables liées : utilisateur)
from .config import settings
from .database import SessionLocal
from .models import Analysis, Detection, StatutAnalyse
from .services import inference_client, storage

logger = logging.getLogger("panoradent.worker")

SEUIL_ENREGISTREMENT = 0.10   # tout ce qui est au-dessus est gardé ; l'écran filtre
REPRISE_APRES = timedelta(minutes=10)
ATTENTE_VIDE = 1.0            # secondes entre deux regards sur une file vide


class EchecAnalyse(Exception):
    """Échec attendu : son message s'affiche tel quel au praticien."""


def reprendre_les_taches_interrompues(db: Session, avant: datetime | None = None) -> int:
    """Remet en file les analyses restées « en cours » (démarrées avant `avant`)."""
    condition = Analysis.statut == StatutAnalyse.EN_COURS
    if avant is not None:
        condition = condition & (Analysis.demarre_le < avant)
    resultat = db.execute(
        update(Analysis).where(condition).values(statut=StatutAnalyse.EN_FILE, demarre_le=None)
    )
    db.commit()
    return resultat.rowcount or 0


def prendre_une_tache(db: Session) -> Analysis | None:
    """Plus ancienne analyse en file, passée « en cours » dans la même transaction."""
    analyse = db.scalar(
        select(Analysis)
        .where(Analysis.statut == StatutAnalyse.EN_FILE)
        .order_by(Analysis.lance_le, Analysis.created_at)
        .limit(1)
        .with_for_update(skip_locked=True, of=Analysis)
    )
    if analyse is None:
        db.rollback()
        return None
    analyse.statut = StatutAnalyse.EN_COURS
    analyse.demarre_le = datetime.utcnow()
    analyse.tentatives = (analyse.tentatives or 0) + 1
    analyse.erreur = ""
    db.commit()
    return analyse


def _detections(resultat: dict, largeur: int, hauteur: int, version: str) -> list[Detection]:
    sortie = []
    for d in resultat.get("detections", []):
        if float(d.get("confidence", 0)) < SEUIL_ENREGISTREMENT:
            continue
        x, y, w, h = (float(v) for v in d["bbox"])
        # Pixels de l'image envoyée → fractions, bornées à l'image.
        x0, y0 = max(0.0, x / largeur), max(0.0, y / hauteur)
        x1, y1 = min(1.0, (x + w) / largeur), min(1.0, (y + h) / hauteur)
        if x1 <= x0 or y1 <= y0:
            continue
        r = lambda v: round(v, 6)  # noqa: E731 — fractions lisibles, sans bruit flottant
        sortie.append(Detection(
            label=d["label"], fdi=d.get("fdi"), confidence=float(d["confidence"]),
            x=r(x0), y=r(y0), w=r(x1 - x0), h=r(y1 - y0), source="model", model_version=version,
        ))
    return sortie


def traiter(db: Session, analyse: Analysis) -> None:
    """Analyse une tâche déjà « en cours ». Termine en « terminee » ou « echouee ».
    L'analyse peut être supprimée pendant le traitement : on la relit par son
    identifiant, et l'on s'arrête sans rien recréer si elle a disparu."""
    debut = time.monotonic()
    # Identifiant lu sans recharger la ligne (elle a pu disparaître entre-temps).
    ident = sa_inspect(analyse).identity[0]
    db.expunge_all()
    analyse = db.get(Analysis, ident)
    if analyse is None:
        return
    image_key = analyse.image_key
    try:
        try:
            png = storage.get(image_key)
        except Exception as exc:  # noqa: BLE001
            raise EchecAnalyse("L'image anonymisée est introuvable dans le stockage.") from exc
        with Image.open(io.BytesIO(png)) as image:
            largeur, hauteur = image.size
        try:
            resultat = inference_client.infer_sync(png)
        except Exception as exc:  # noqa: BLE001
            raise EchecAnalyse(
                "Le service d'analyse ne répond pas. Réessayez dans un instant ; si cela persiste, "
                "prévenez l'administrateur."
            ) from exc
        mode = resultat.get("mode", "unknown")
        if mode == "mock" and settings.app_env.lower() == "production":
            raise EchecAnalyse(
                "Le service d'analyse tourne sans modèle entraîné : refusé en production. "
                "Prévenez l'administrateur."
            )
        version = resultat.get("model_version", "unknown")

        db.expire_all()
        analyse = db.get(Analysis, ident)
        if analyse is None:
            db.rollback()
            return
        analyse.detections = _detections(resultat, largeur, hauteur, version)
        analyse.model_version = version
        analyse.inference_mode = mode
        analyse.statut = StatutAnalyse.TERMINEE
    except EchecAnalyse as exc:
        db.rollback()
        logger.warning("Analyse %s échouée : %s", ident, exc.__cause__ or exc)
        db.expire_all()
        analyse = db.get(Analysis, ident)
        if analyse is None:
            return
        analyse.statut = StatutAnalyse.ECHOUEE
        analyse.erreur = str(exc)
    except Exception:  # noqa: BLE001 — jamais de tâche bloquée « en cours »
        db.rollback()
        logger.exception("Analyse %s : erreur inattendue", ident)
        db.expire_all()
        analyse = db.get(Analysis, ident)
        if analyse is None:
            return
        analyse.statut = StatutAnalyse.ECHOUEE
        analyse.erreur = "Erreur inattendue pendant l'analyse. Relancez ; si cela persiste, prévenez l'administrateur."
    analyse.termine_le = datetime.utcnow()
    analyse.duree_ms = int((time.monotonic() - debut) * 1000)
    db.commit()


def traiter_une(fabrique=SessionLocal) -> bool:
    """Prend et traite une tâche ; renvoie False si la file est vide."""
    with fabrique() as db:
        analyse = prendre_une_tache(db)
        if analyse is None:
            return False
        logger.info("Analyse %s (%s) : tentative %s", analyse.reference, analyse.id, analyse.tentatives)
        traiter(db, analyse)
        return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(message)s")
    arret = {"demande": False}

    def demander_arret(*_):
        arret["demande"] = True

    signal.signal(signal.SIGTERM, demander_arret)
    signal.signal(signal.SIGINT, demander_arret)

    # La base peut ne pas être prête (migrations au démarrage du backend).
    while not arret["demande"]:
        try:
            with SessionLocal() as db:
                n = reprendre_les_taches_interrompues(db)
            if n:
                logger.info("%s analyse(s) interrompue(s) remise(s) en file.", n)
            break
        except Exception as exc:  # noqa: BLE001
            logger.info("Base pas encore prête (%s) ; nouvel essai.", exc.__class__.__name__)
            time.sleep(3)

    logger.info("Worker prêt.")
    while not arret["demande"]:
        try:
            if not traiter_une():
                time.sleep(ATTENTE_VIDE)
        except Exception:  # noqa: BLE001
            logger.exception("Erreur de la boucle du worker")
            time.sleep(3)
    logger.info("Worker arrêté.")


if __name__ == "__main__":
    main()
