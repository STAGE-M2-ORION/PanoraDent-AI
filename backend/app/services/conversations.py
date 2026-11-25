"""Fil de l'assistant par analyse et par auteur (sprint 10).

Une conversation est un raisonnement en cours : elle appartient à son auteur,
et deux praticiens qui ouvrent la même analyse ont chacun la leur. Les
réponses jugées utiles passent dans la conclusion de l'analyse, qui est,
elle, partagée.

Le fil n'enregistre que des réponses VÉRIFIÉES : une réponse sans source
valide n'y entre jamais, seul son message d'échec. Dès que l'analyse est
clôturée, le fil est en lecture seule (ni question, ni effacement) : il fait
partie de ce que la clôture fige.
"""
import asyncio
from datetime import datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..models import Analysis, Conversation, Message
from . import assistant, revue

SUGGESTIONS_MAX = 4


def fil(db: Session, analyse: Analysis, auteur_id) -> Conversation | None:
    return db.scalar(select(Conversation).where(Conversation.analysis_id == analyse.id,
                                                Conversation.auteur_id == auteur_id))


def suggestions(analyse: Analysis) -> list[str]:
    """Questions suggérées, tirées des anomalies RETENUES de l'analyse."""
    anomalies = assistant.contexte_analyse(analyse)["anomalies"]
    proposees: list[str] = []
    for a in sorted(anomalies, key=lambda a: -(a["confiance"] or 0)):
        if a["dent"]:
            proposees.append(f"Comment lire la {a['type']} signalée sur la dent {a['dent']} ?")
            break
    for type_ in dict.fromkeys(a["type"] for a in anomalies):
        proposees.append(f"Que signifie une {type_} sur une panoramique ?")
    if not anomalies:
        proposees.append("Comment lire une radiographie panoramique ?")
    proposees.append("Comment interpréter l’indice de confiance ?")
    return list(dict.fromkeys(proposees))[:SUGGESTIONS_MAX]


def message_out(m: Message) -> dict:
    return {"id": m.id, "role": m.role, "statut": m.statut, "texte": m.texte, "sources": m.sources or [],
            "cree_le": m.cree_le}


def conversation_out(analyse: Analysis, conv: Conversation | None) -> dict:
    messages = conv.messages if conv is not None else []
    return {
        "messages": [message_out(m) for m in messages],
        "suggestions": suggestions(analyse),
        "lecture_seule": analyse.cloturee,
        "avertissement": assistant.AVERTISSEMENT,
    }


def poser(db: Session, analyse: Analysis, *, auteur_id, question: str, request: Request | None = None,
          **reglages) -> tuple[Message, Message]:
    """Question posée dans le fil : réponse vérifiée (ou refus, ou échec),
    journalisée, puis les deux messages ajoutés au fil."""
    revue.verifier_modifiable(analyse)
    question = assistant.question_valide(question)
    p = assistant.parametres(db)
    reglages.setdefault("nombre", p.passages)
    reglages.setdefault("seuil", p.seuil)
    reponse = assistant.repondre(db, question, analyse=analyse, **reglages)
    return _enregistrer(db, analyse, auteur_id, question, reponse, request)


def effacer(db: Session, analyse: Analysis, *, auteur_id, request: Request | None = None) -> int:
    """Efface le fil de son auteur ; renvoie le nombre de messages effacés."""
    revue.verifier_modifiable(analyse)
    conv = fil(db, analyse, auteur_id)
    if conv is None:
        return 0
    n = len(conv.messages)
    db.delete(conv)
    journal.inscrire(db, "conversation_effacee", journal.SUCCES, request=request, utilisateur_id=auteur_id,
                     cible=f"analyse:{analyse.id}", details={"messages": n, "reference": analyse.reference},
                     commit=False)
    db.commit()
    return n


# --- Au fil de l'eau (sprint 10, lot B) ------------------------------------------

def _enregistrer(db: Session, analyse: Analysis, auteur_id, question: str, reponse: "assistant.Reponse",
                 request: Request | None) -> tuple[Message, Message]:
    """Journal, puis les deux messages ajoutés au fil, dans la même transaction."""
    assistant.journaliser(db, question, reponse, utilisateur_id=auteur_id, analyse=analyse, request=request,
                          commit=False)
    conv = fil(db, analyse, auteur_id)
    if conv is None:
        conv = Conversation(analysis_id=analyse.id, auteur_id=auteur_id)
        db.add(conv)
        db.flush()
    rang, maintenant = len(conv.messages), datetime.utcnow()
    q = Message(rang=rang, role="question", texte=question, cree_le=maintenant)
    r = Message(rang=rang + 1, role="reponse", statut=reponse.statut, texte=reponse.texte,
                sources=reponse.sources, cree_le=maintenant)
    conv.messages.extend([q, r])
    conv.maj_le = maintenant
    db.commit()
    return q, r


async def repondre_en_flux(fabrique, analyse_id: str, auteur_id, question: str, request: Request | None = None,
                           *, vectoriseur=None, redacteur=None):
    """Événements d'une réponse au fil de l'eau : (« debut », n passages),
    (« fragment », texte)…, puis (« fin », (question, réponse)) une fois la
    réponse vérifiée et enregistrée.

    Le texte des fragments n'est qu'un brouillon : seule la réponse vérifiée
    entre dans le fil. Si le flux est coupé (arrêt demandé, navigateur
    fermé), la rédaction s'arrête côté serveur et le fil garde la question
    avec une réponse « interrompue », sans le brouillon.

    La session vient de `fabrique` : celle de la requête est déjà fermée
    quand la réponse en flux commence.
    """
    from starlette.concurrency import run_in_threadpool

    with fabrique() as db:
        analyse = db.get(Analysis, analyse_id)
        p = assistant.parametres(db)
        db.commit()
        # Recherche (vectorisation de la question) : appel bloquant, hors de la boucle.
        prep = await run_in_threadpool(assistant.preparer, db, question, analyse=analyse,
                                       vectoriseur=vectoriseur, nombre=p.passages, seuil=p.seuil)
        reponse = prep.reponse
        try:
            if reponse is None:
                yield "debut", len(prep.extraits)
                async for genre, valeur in assistant.rediger_en_flux(prep, question, redacteur):
                    if genre == "fragment":
                        yield "fragment", valeur
                    else:
                        reponse = valeur
        except (asyncio.CancelledError, GeneratorExit):
            db.rollback()
            _enregistrer(db, analyse, auteur_id, question,
                         assistant.Reponse("interrompue", assistant.INTERROMPUE), request)
            raise
        yield "fin", _enregistrer(db, analyse, auteur_id, question, reponse, request)
