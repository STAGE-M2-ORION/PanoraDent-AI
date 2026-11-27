"""Analyses confiées à un lecteur.

- `GET /lecteurs` : comptes à qui l'on peut confier une analyse (lecteurs
  actifs, qui ne voient pas déjà tout) ;
- `GET /analyses/{id}/lecteurs` : à qui l'analyse est confiée, et si
  l'appelant peut le changer ;
- `PUT /analyses/{id}/lecteurs` : remplace la liste. Réservé au déposant et à
  l'administrateur, possible après la clôture.

La règle de visibilité elle-même est dans `services/attributions.py`.
"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Analysis
from ..permissions import ANALYSIS_CREATE, ANALYSIS_READ_ALL
from ..services import attributions

router = APIRouter(tags=["attributions"])


class LecteursIn(BaseModel):
    lecteurs: list[str] = Field(default_factory=list, max_length=attributions.MAX_LECTEURS)


def _lecteur(u: Utilisateur) -> dict:
    return {"id": str(u.id), "nom": attributions.nom(u), "email": u.email}


def _etat(a: Analysis, utilisateur: Utilisateur) -> dict:
    return {
        "lecteurs": [{**_lecteur(at.lecteur), "confie_le": at.cree_le.isoformat()} for at in a.attributions],
        "modifiable": attributions.peut_attribuer(utilisateur, a),
    }


@router.get("/lecteurs")
def lecteurs(_: Utilisateur = Depends(exiger(ANALYSIS_CREATE)), db: Session = Depends(get_db)):
    return [_lecteur(u) for u in attributions.lecteurs_attribuables(db)]


@router.get("/analyses/{analysis_id}/lecteurs")
def lecteurs_de_l_analyse(
    analysis_id: str,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ_ALL)),
    db: Session = Depends(get_db),
):
    return _etat(attributions.analyse_visible(db, utilisateur, analysis_id), utilisateur)


@router.put("/analyses/{analysis_id}/lecteurs")
def confier(
    analysis_id: str,
    corps: LecteursIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_CREATE)),
    db: Session = Depends(get_db),
):
    a = attributions.analyse_visible(db, utilisateur, analysis_id, verrou=True)
    if not attributions.peut_attribuer(utilisateur, a):
        raise ApiError(403, "acces_refuse",
                       "Seul le praticien qui a déposé cette analyse, ou un administrateur, peut la confier.")
    attributions.definir(db, a, attributions.valider(db, corps.lecteurs), utilisateur, request)
    db.commit()
    db.refresh(a)
    return _etat(a, utilisateur)
