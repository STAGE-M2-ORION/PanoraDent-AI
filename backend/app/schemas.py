from datetime import datetime
from pydantic import BaseModel


class DetectionOut(BaseModel):
    id: str
    label: str
    fdi: int | None
    confidence: float
    x: int
    y: int
    w: int
    h: int
    reviewed: bool
    source: str

    class Config:
        from_attributes = True


class AnalysisOut(BaseModel):
    id: str
    created_at: datetime
    image_key: str
    report_key: str | None
    model_version: str
    inference_mode: str
    width: int
    height: int
    detections: list[DetectionOut] = []

    class Config:
        from_attributes = True


class AnalysisSummary(BaseModel):
    id: str
    created_at: datetime
    model_version: str
    inference_mode: str
    n_detections: int
