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
    reponse = assistant.poser_question(db, question, utilisateur_id=auteur_id, analyse=analyse,
                                       request=request, **reglages)
    conv = fil(db, analyse, auteur_id)
    if conv is None:
        conv = Conversation(analysis_id=analyse.id, auteur_id=auteur_id)
        db.add(conv)
        db.flush()
    rang = len(conv.messages)
    maintenant = datetime.utcnow()
    q = Message(rang=rang, role="question", texte=" ".join(question.split()), cree_le=maintenant)
    r = Message(rang=rang + 1, role="reponse", statut=reponse.statut, texte=reponse.texte,
                sources=reponse.sources, cree_le=maintenant)
    conv.messages.extend([q, r])
    conv.maj_le = maintenant
    db.commit()
    return q, r


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
