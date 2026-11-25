"""Publication d'une version de modèle pour les tests de bout en bout.

Montée seulement avec APP_ENV=test (voir `main.py`), comme la boîte de
réception des tests : le parcours Playwright publie des versions sans base de
données accessible ni poids réels (le service d'inférence de test sert alors
des modèles factices, `MODELES_FACTICES=1`). Elle n'existe dans aucun autre
environnement : en vrai, on publie avec `training/publish_model.py`.
"""
import json

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth_deps import publique
from ..database import get_db
from ..errors import ApiError
from ..models import ModelVersion

router = APIRouter(prefix="/test/modeles", tags=["test"], include_in_schema=False)


class Publication(BaseModel):
    version: str
    sha_dents: str
    sha_anomalies: str
    map50: float | None = None
    # Seuils d'exploitation par classe, comme publish_model.py les écrit.
    seuils: dict[str, float] | None = None
    # Mesures complètes (sprint 10, page Performances), au format de
    # publish_model.py ; elles remplacent alors `map50`.
    metrics: dict | None = None
    # Empreinte du découpage : deux versions d'empreintes différentes ne se comparent pas.
    empreinte: str | None = None


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(publique)])
def publier(p: Publication, db: Session = Depends(get_db)):
    if db.scalar(select(ModelVersion).where(ModelVersion.version == p.version)):
        raise ApiError(409, "deja_publiee", "Version déjà publiée.")
    metrics = p.metrics if p.metrics is not None else (
        {"map50": p.map50, "partition": "test"} if p.map50 is not None else {})
    db.add(ModelVersion(
        version=p.version, dataset="Tests de bout en bout (modèles factices)",
        metrics_json=json.dumps(metrics), poids_dents=f"{p.version}/dents.pt",
        poids_anomalies=f"{p.version}/anomalies.pt", sha256_dents=p.sha_dents,
        sha256_anomalies=p.sha_anomalies, empreinte_decoupage=(p.empreinte or "e2e").ljust(64, "0")[:64], seuils=p.seuils,
    ))
    db.commit()
    return {"version": p.version}
