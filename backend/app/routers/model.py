import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select
from ..database import get_db
from ..models import ModelVersion

router = APIRouter(prefix="/model", tags=["model"])


@router.get("/versions")
def list_versions(db: Session = Depends(get_db)):
    rows = db.execute(select(ModelVersion).order_by(ModelVersion.created_at.desc())).scalars().all()
    return [
        {
            "version": m.version,
            "dataset": m.dataset,
            "metrics": json.loads(m.metrics_json or "{}"),
            "notes": m.notes,
            "created_at": m.created_at,
        } for m in rows
    ]
