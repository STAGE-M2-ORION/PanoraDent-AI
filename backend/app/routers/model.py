"""Registre des modèles : consultation, bascule sans redéploiement, journal.

- `GET /model/versions` (`model:read`) : versions publiées, la plus récente
  d'abord, avec la version active, les mesures et l'empreinte du découpage ;
- `POST /model/versions/{version}/activer` (`model:manage`) : bascule, motif
  obligatoire. Le service d'inférence charge et vérifie la version AVANT
  qu'elle ne devienne active ; les analyses déjà en file gardent la leur ;
- `GET /model/bascules` (`model:read`) : journal des bascules.
"""
import json

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..models import BasculeModele, ModelVersion
from ..permissions import MODEL_MANAGE, MODEL_READ
from ..schemas import _nom
from ..services import registre_modeles

router = APIRouter(prefix="/model", tags=["model"])


def version_out(m: ModelVersion) -> dict:
    return {
        "id": m.id,
        "version": m.version,
        "dataset": m.dataset,
        "metrics": json.loads(m.metrics_json or "{}"),
        "notes": m.notes,
        "created_at": m.created_at,
        "actif": bool(m.actif),
        "active_le": m.active_le,
        "servable": m.servable,
        "empreinte_decoupage": m.empreinte_decoupage,
        "sha256": {"dents": m.sha256_dents, "anomalies": m.sha256_anomalies},
        "seuils": m.seuils,
    }


@router.get("/versions")
def list_versions(db: Session = Depends(get_db), _=Depends(exiger(MODEL_READ))):
    rows = db.scalars(select(ModelVersion).order_by(ModelVersion.created_at.desc())).all()
    return [version_out(m) for m in rows]


class Bascule(BaseModel):
    motif: str = ""


@router.post("/versions/{version}/activer")
def activer(
    version: str,
    corps: Bascule,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(MODEL_MANAGE)),
    db: Session = Depends(get_db),
):
    bascule = registre_modeles.basculer(db, version, corps.motif, utilisateur.id)
    journal.inscrire(
        db, "bascule_modele", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        cible=f"modele:{version}",
        details={"de": bascule.version_precedente, "vers": version, "motif": bascule.motif},
        commit=False,
    )
    db.commit()
    return version_out(registre_modeles.version_active(db))


@router.get("/bascules")
def list_bascules(db: Session = Depends(get_db), _=Depends(exiger(MODEL_READ))):
    rows = db.scalars(select(BasculeModele).order_by(BasculeModele.horodatage.desc())).all()
    return [{
        "horodatage": b.horodatage,
        "version_precedente": b.version_precedente,
        "version": b.version,
        "motif": b.motif,
        "auteur_nom": _nom(b.auteur) if b.auteur else None,
    } for b in rows]
