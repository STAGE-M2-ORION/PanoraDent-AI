import uuid
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..auth_deps import require_permission
from ..database import get_db
from ..models import Analysis, Detection
from ..permissions import ANALYSIS_CREATE, ANALYSIS_READ, REPORT_GENERATE
from ..schemas import AnalysisOut, AnalysisSummary
from ..services import anonymize, storage, inference_client, report as report_svc
from PIL import Image
import io

router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.post("", response_model=AnalysisOut)
async def create_analysis(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_permission(ANALYSIS_CREATE)),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Fichier vide")

    # 1) Anonymisation (PRD §5.1 / §9)
    image, png_bytes = anonymize.anonymize(raw, file.filename)
    width, height = image.size

    # 2) Stockage de l'image anonymisée
    storage.ensure_bucket()
    image_key = f"images/{uuid.uuid4()}.png"
    storage.put(image_key, png_bytes, "image/png")

    # 3) Inférence (service isolé)
    result = await inference_client.infer(png_bytes, "image.png")

    # 4) Persistance
    analysis = Analysis(
        image_key=image_key,
        model_version=result.get("model_version", "unknown"),
        inference_mode=result.get("mode", "unknown"),
        width=width,
        height=height,
    )
    for d in result.get("detections", []):
        bbox = d["bbox"]
        analysis.detections.append(Detection(
            label=d["label"], fdi=d.get("fdi"), confidence=d["confidence"],
            x=bbox[0], y=bbox[1], w=bbox[2], h=bbox[3], source="model",
        ))
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return analysis


@router.get("", response_model=list[AnalysisSummary])
def list_analyses(
    db: Session = Depends(get_db), _=Depends(require_permission(ANALYSIS_READ))
):
    rows = db.execute(select(Analysis).order_by(Analysis.created_at.desc())).scalars().all()
    return [
        AnalysisSummary(
            id=a.id, created_at=a.created_at, model_version=a.model_version,
            inference_mode=a.inference_mode, n_detections=len(a.detections),
            labels=sorted({d.label for d in a.detections if d.label != "tooth"}),
            has_report=a.report_key is not None,
        ) for a in rows
    ]


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission(ANALYSIS_READ)),
):
    a = db.get(Analysis, analysis_id)
    if not a:
        raise HTTPException(404, "Analyse introuvable")
    return a


@router.get("/{analysis_id}/image")
def get_image_url(
    analysis_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission(ANALYSIS_READ)),
):
    a = db.get(Analysis, analysis_id)
    if not a:
        raise HTTPException(404, "Analyse introuvable")
    return {"url": storage.presigned_url(a.image_key)}


@router.post("/{analysis_id}/report")
def build_report(
    analysis_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission(REPORT_GENERATE)),
):
    a = db.get(Analysis, analysis_id)
    if not a:
        raise HTTPException(404, "Analyse introuvable")
    image = Image.open(io.BytesIO(storage.get(a.image_key))).convert("L")
    dets = [dict(label=d.label, fdi=d.fdi, confidence=d.confidence,
                 x=d.x, y=d.y, w=d.w, h=d.h) for d in a.detections]
    pdf = report_svc.build(image, dets, a.id, a.model_version)
    report_key = f"reports/{a.id}.pdf"
    storage.put(report_key, pdf, "application/pdf")
    a.report_key = report_key
    db.commit()
    return {"url": storage.presigned_url(report_key)}
