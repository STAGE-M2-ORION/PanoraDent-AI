"""Service d'inférence isolé : il ne reçoit que des pixels, jamais de base.

Deux façons de servir :

- **par version** (registre, sprint 6) : le backend envoie `version` et les
  empreintes attendues des poids ; la paire dents + anomalies de cette version
  est chargée une fois puis gardée en mémoire. Une version demandée qui n'est
  pas installée est une erreur : jamais de repli silencieux sur le mock ;
- **historique** (aucune version demandée) : le fichier unique
  `MODEL_WEIGHTS_PATH`, ou le mock s'il est absent. En mode strict
  (production) sans ce fichier, le service tourne en mode « registre » : une
  demande sans version est refusée (503), jamais servie par le mock.

Les erreurs sortent sous la forme `{"code", "message"}`, comme celles du backend.
"""
import io
import threading

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import config, model
from .registre import AucuneVersionActive, ErreurModele, Registre

if config.MODELES_FACTICES and config.APP_ENV != "test":
    raise RuntimeError("MODELES_FACTICES=1 est réservé aux tests (APP_ENV=test) : refus de démarrer.")

app = FastAPI(title="PanoraDent Inference", version=config.MODEL_VERSION)
registre = Registre()
# Une prédiction à la fois : les prédicteurs ultralytics ne sont pas prévus pour
# être appelés en parallèle sur le même modèle, et un seul worker alimente le service.
_predire = threading.Lock()


@app.exception_handler(ErreurModele)
def _erreur_modele(_, exc: ErreurModele):
    return JSONResponse(status_code=exc.statut, content={"code": exc.code, "message": exc.message})


@app.on_event("startup")
def _startup():
    model.load_model(registre.installees())


@app.get("/health")
def health():
    return {"status": "ok", "mode": model.mode(), "version": config.MODEL_VERSION,
            "versions_chargees": registre.chargees()}


def _attendu(sha_dents: str | None, sha_anomalies: str | None) -> dict:
    return {"dents": sha_dents, "anomalies": sha_anomalies}


@app.post("/infer")
async def infer(
    file: UploadFile = File(...),
    version: str | None = Form(default=None),
    sha_dents: str | None = Form(default=None),
    sha_anomalies: str | None = Form(default=None),
):
    raw = await file.read()
    image = Image.open(io.BytesIO(raw)).convert("L")  # niveaux de gris
    width, height = image.size

    if version:
        paire = await run_in_threadpool(registre.obtenir, version, _attendu(sha_dents, sha_anomalies))

        def predire():
            with _predire:
                return model.predict_paire(paire, image, width, height)

        detections, signales = await run_in_threadpool(predire)
        return {"mode": "real", "model_version": paire.version, "poids_sha256": paire.sha256,
                "image_size": {"width": width, "height": height}, "detections": detections,
                "incoherences": signales}

    if model.mode() == "registre":
        # Production sans modèle historique : seule une version publiée est servie.
        raise AucuneVersionActive(
            "Aucune version de modèle active : activez-en une dans Administration › Modèles.")

    def predire_historique():
        with _predire:
            return model.predict(image, width, height)

    detections = await run_in_threadpool(predire_historique)
    return {"mode": model.mode(), "model_version": config.MODEL_VERSION,
            "image_size": {"width": width, "height": height}, "detections": detections}


class Chargement(BaseModel):
    version: str
    sha_dents: str | None = None
    sha_anomalies: str | None = None


@app.post("/charger")
async def charger(demande: Chargement):
    """Charge (et vérifie) une version avant que le backend ne la rende active :
    une bascule vers des poids absents ou altérés échoue ici, pas sur une analyse."""
    paire = await run_in_threadpool(
        registre.obtenir, demande.version, _attendu(demande.sha_dents, demande.sha_anomalies))
    return {"version": paire.version, "poids_sha256": paire.sha256,
            "versions_chargees": registre.chargees()}
