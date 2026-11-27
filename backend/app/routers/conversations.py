"""Fil de l'assistant d'une analyse (sprint 10) : chacun ne voit que le sien.

`GET /analyses/{id}/conversation` : messages, questions suggérées, lecture seule.
`POST /analyses/{id}/conversation/messages` : question, réponse vérifiée.
`DELETE /analyses/{id}/conversation` : efface son fil (journalisé).
`POST /analyses/{id}/conversation/flux` : la même question, réponse au fil de
l'eau (flux d'événements `text/event-stream`) ; couper le flux arrête la
rédaction côté serveur.

Réservé à `assistant:use`. Après clôture, le fil se lit mais ne s'écrit plus.
"""
import json
from contextlib import aclosing

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db, get_session_factory
from ..errors import ApiError
from ..models import Analysis
from ..permissions import ASSISTANT_USE
from ..services import assistant, attributions, conversations, revue

router = APIRouter(prefix="/analyses", tags=["assistant"])


class MessageIn(BaseModel):
    question: str = Field(max_length=2000)


def _analyse(db: Session, analysis_id: str, utilisateur: Utilisateur) -> Analysis:
    return attributions.analyse_visible(db, utilisateur, analysis_id)


@router.get("/{analysis_id}/conversation")
def lire(
    analysis_id: str,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, utilisateur)
    return conversations.conversation_out(a, conversations.fil(db, a, utilisateur.id))


@router.post("/{analysis_id}/conversation/messages", status_code=201)
def poser(
    analysis_id: str,
    corps: MessageIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, utilisateur)
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
    conversations.effacer(db, _analyse(db, analysis_id, utilisateur), auteur_id=utilisateur.id, request=request)
    return Response(status_code=204)


def _evenement(genre: str, donnees: dict) -> str:
    return f"event: {genre}\ndata: {json.dumps(donnees, ensure_ascii=False, default=str)}\n\n"


@router.post("/{analysis_id}/conversation/flux")
def poser_en_flux(
    analysis_id: str,
    corps: MessageIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
    fabrique=Depends(get_session_factory),
):
    """Réponse au fil de l'eau. Les refus (droits, analyse clôturée, question
    invalide) sont des réponses JSON ordinaires, AVANT l'ouverture du flux.

    Événements : `debut` {passages}, `fragment` {texte} (brouillon non
    vérifié), puis `fin` {question, reponse, avertissement} (réponse vérifiée,
    enregistrée dans le fil)."""
    a = _analyse(db, analysis_id, utilisateur)
    revue.verifier_modifiable(a)
    question = assistant.question_valide(corps.question)
    # Lus maintenant : la session de la requête est fermée quand le flux commence.
    analyse_id, auteur_id = a.id, utilisateur.id

    async def evenements():
        flux = conversations.repondre_en_flux(fabrique, analyse_id, auteur_id, question, request)
        async with aclosing(flux):   # coupé : le générateur interne est fermé, la rédaction s'arrête
            async for genre, valeur in flux:
                if genre == "debut":
                    yield _evenement("debut", {"passages": valeur})
                elif genre == "fragment":
                    yield _evenement("fragment", {"texte": valeur})
                else:
                    q, r = valeur
                    yield _evenement("fin", {"question": conversations.message_out(q),
                                             "reponse": conversations.message_out(r),
                                             "avertissement": assistant.AVERTISSEMENT})

    # X-Accel-Buffering : nginx relaie chaque événement sans le retenir.
    return StreamingResponse(evenements(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
