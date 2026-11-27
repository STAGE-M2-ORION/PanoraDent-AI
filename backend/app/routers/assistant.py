"""Assistant documentaire (sprint 9) : poser une question, régler la recherche.

`POST /assistant/questions` : réponse sourcée, ou refus motivé ; la question
peut venir d'une analyse, dont le contexte ANONYME est alors joint (voir
`services/assistant.py`). Réservé à `assistant:use` : le lecteur, en lecture
seule, ne pose pas de question (chaque question est inscrite au journal).

`GET` / `PUT /assistant/parametres` : nombre de passages et seuil de
similarité, réservés à `document:manage`.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Analysis
from ..permissions import ASSISTANT_USE, DOCUMENT_MANAGE
from ..schemas import _nom
from ..services import assistant, attributions

router = APIRouter(prefix="/assistant", tags=["assistant"])


class QuestionIn(BaseModel):
    question: str = Field(max_length=2000)
    analyse_id: str | None = None


class ParametresIn(BaseModel):
    passages: int = Field(ge=1, le=10)
    seuil: float = Field(ge=0.0, le=1.0)


def parametres_out(p) -> dict:
    return {"passages": p.passages, "seuil": p.seuil, "maj_le": p.maj_le, "maj_par_nom": _nom(p.maj_par)}


@router.post("/questions")
def poser(
    corps: QuestionIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    analyse = None
    if corps.analyse_id:
        analyse = attributions.analyse_visible(db, utilisateur, corps.analyse_id)
    reponse = assistant.poser_question(db, corps.question, utilisateur_id=utilisateur.id, analyse=analyse,
                                       request=request)
    return reponse.en_json()


@router.get("/parametres")
def lire_parametres(_: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)), db: Session = Depends(get_db)):
    p = assistant.parametres(db)
    db.commit()
    return parametres_out(p)


@router.put("/parametres")
def modifier_parametres(
    corps: ParametresIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    p = assistant.parametres(db)
    seuil = round(corps.seuil, 2)
    if (p.passages, p.seuil) != (corps.passages, seuil):
        p.passages, p.seuil = corps.passages, seuil
        p.maj_le, p.maj_par_id = datetime.utcnow(), utilisateur.id
        journal.inscrire(db, "assistant_parametres", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                         details={"passages": p.passages, "seuil": p.seuil}, commit=False)
    db.commit()
    db.refresh(p)
    return parametres_out(p)
