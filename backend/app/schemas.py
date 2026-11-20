import uuid
from datetime import date, datetime
from pydantic import BaseModel


def _nom(utilisateur) -> str | None:
    if utilisateur is None:
        return None
    nom = " ".join(p for p in (utilisateur.prenom, utilisateur.nom) if p and p.strip())
    return nom or utilisateur.email


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
    reference: str
    date_examen: date | None = None
    note: str = ""
    deposant_id: uuid.UUID | None = None
    deposant_nom: str | None = None
    # Nombre de zones masquées à l'import (automatiques, manuelles).
    zones_masquees: dict = {}
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
    reference: str
    date_examen: date | None = None
    deposant_id: uuid.UUID | None = None
    deposant_nom: str | None = None
    model_version: str
    inference_mode: str
    n_detections: int
    # Classes d'anomalies présentes (sans doublon) : filtres de l'historique.
    labels: list[str] = []
    # Un rapport PDF a été généré : l'analyse est considérée clôturée.
    has_report: bool = False


def analyse_out(a) -> AnalysisOut:
    masques = a.masques or {}
    return AnalysisOut.model_validate({
        **{c: getattr(a, c) for c in (
            "id", "created_at", "reference", "date_examen", "note", "image_key", "report_key",
            "model_version", "inference_mode", "width", "height",
        )},
        "detections": a.detections,
        "deposant_id": a.utilisateur_id,
        "deposant_nom": _nom(a.deposant),
        "zones_masquees": {"auto": len(masques.get("auto", [])), "manuelles": len(masques.get("manuelles", []))},
    })


class ZoneOut(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ApercuOut(BaseModel):
    """Aperçu d'import : rien n'est stocké. Images en data URL JPEG (réduites)."""
    largeur: int
    hauteur: int
    zones_auto: list[ZoneOut]
    zones_manuelles: list[ZoneOut]
    avant: str
    apres: str


class StockageOut(BaseModel):
    objets: int
    octets: int
    seuil_octets: int
    alerte: bool
