"""Fil de l'assistant d'une analyse (sprint 10) : chacun ne voit que le sien.

`GET /analyses/{id}/conversation` : messages, questions suggérées, lecture seule.
`POST /analyses/{id}/conversation/messages` : question, réponse vérifiée.
`DELETE /analyses/{id}/conversation` : efface son fil (journalisé).

Réservé à `assistant:use`. Après clôture, le fil se lit mais ne s'écrit plus.
"""
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Analysis
from ..permissions import ASSISTANT_USE
from ..services import conversations

router = APIRouter(prefix="/analyses", tags=["assistant"])


class MessageIn(BaseModel):
    question: str = Field(max_length=2000)


def _analyse(db: Session, analysis_id: str) -> Analysis:
    a = db.get(Analysis, analysis_id)
    if a is None:
        raise ApiError(404, "introuvable", "Analyse introuvable.")
    return a


@router.get("/{analysis_id}/conversation")
def lire(
    analysis_id: str,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id)
    return conversations.conversation_out(a, conversations.fil(db, a, utilisateur.id))


@router.post("/{analysis_id}/conversation/messages", status_code=201)
def poser(
    analysis_id: str,
    corps: MessageIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id)
    question, reponse = conversations.poser(db, a, auteur_id=utilisateur.id, question=corps.question,
                                            request=request)
    return {"question": conversations.message_out(question), "reponse": conversations.message_out(reponse),
            "avertissement": conversations.assistant.AVERTISSEMENT}


@router.delete("/{analysis_id}/conversation", status_code=204)
def effacer(
    analysis_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    conversations.effacer(db, _analyse(db, analysis_id), auteur_id=utilisateur.id, request=request)
    return Response(status_code=204)
