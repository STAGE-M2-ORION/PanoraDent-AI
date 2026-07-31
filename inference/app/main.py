import io
from fastapi import FastAPI, UploadFile, File
from PIL import Image

from . import model, config

app = FastAPI(title="PanoraDent Inference", version=config.MODEL_VERSION)


@app.on_event("startup")
def _startup():
    model.load_model()


@app.get("/health")
def health():
    return {"status": "ok", "mode": model.mode(), "version": config.MODEL_VERSION}


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    raw = await file.read()
    image = Image.open(io.BytesIO(raw)).convert("L")  # niveaux de gris
    width, height = image.size
    detections = model.predict(image, width, height)
    return {
        "mode": model.mode(),
        "model_version": config.MODEL_VERSION,
        "image_size": {"width": width, "height": height},
        "detections": detections,
    }
