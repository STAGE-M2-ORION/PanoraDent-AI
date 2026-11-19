import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select
from ..database import get_db
from ..auth_deps import exiger
from ..models import ModelVersion
from ..permissions import MODEL_READ

router = APIRouter(prefix="/model", tags=["model"])


@router.get("/versions")
def list_versions(
    db: Session = Depends(get_db), _=Depends(exiger(MODEL_READ))
):
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
