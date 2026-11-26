"""Notifications (sprint 13) : qui est prévenu de quoi.

Trois événements, tous rattachés à une analyse :

| Événement | Destinataire |
|---|---|
| analyse terminée | le praticien qui l'a déposée |
| analyse échouée | le praticien qui l'a déposée |
| analyse rouverte | le praticien qui l'avait clôturée (avec le motif) |

Règles :
- on n'est jamais notifié de sa propre action ;
- un compte désactivé ou supprimé ne reçoit rien ;
- seule la **référence anonyme** de l'analyse figure dans la notification :
  jamais d'image, de note ni de conclusion. Le motif d'une réouverture est
  écrit par l'administrateur pour le praticien ; il est tronqué.

`notifier` ajoute la ligne dans la transaction de l'appelant, qui valide :
une notification n'existe que si l'événement a eu lieu.
"""
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth_models import Utilisateur
from ..models import Analysis, Notification, TypeNotification
from . import revue

MOTIF_MAX = 200
LIMITE_MAX = 50

TITRES = {
    TypeNotification.ANALYSE_TERMINEE: "Analyse {reference} terminée",
    TypeNotification.ANALYSE_ECHOUEE: "Analyse {reference} échouée",
    TypeNotification.ANALYSE_ROUVERTE: "Analyse {reference} rouverte",
}


def _message(type_: str, analyse: Analysis, motif: str | None) -> str:
    if type_ == TypeNotification.ANALYSE_TERMINEE:
        # Celles qui attendent un verdict avant la clôture (au-dessus du seuil de leur classe).
        n = len(revue.a_revoir(analyse))
        if n == 0:
            return "Prête à relire : aucune anomalie proposée par le modèle."
        return f"Prête à relire : {n} anomalie{'s' if n > 1 else ''} proposée{'s' if n > 1 else ''} par le modèle."
    if type_ == TypeNotification.ANALYSE_ECHOUEE:
        return "Le traitement a échoué. Vous pouvez la relancer depuis l'analyse, sans la réimporter."
    motif = (motif or "").strip()
    if len(motif) > MOTIF_MAX:
        motif = motif[:MOTIF_MAX - 1].rstrip() + "…"
    return f"Rouverte par l'administrateur. Motif : {motif}" if motif else "Rouverte par l'administrateur."


def notifier(db: Session, destinataire_id: uuid.UUID | None, type_: str, analyse: Analysis, *,
             auteur_id: uuid.UUID | None = None, motif: str | None = None) -> Notification | None:
    """Ajoute la notification (sans valider) ; None si personne n'est à prévenir."""
    if type_ not in TypeNotification.TOUS:
        raise ValueError(f"Type de notification inconnu : {type_}")
    if destinataire_id is None or destinataire_id == auteur_id:
        return None
    destinataire = db.get(Utilisateur, destinataire_id)
    if destinataire is None or not destinataire.actif:
        return None
    n = Notification(
        id=str(uuid.uuid4()), utilisateur_id=destinataire_id, type=type_,
        titre=TITRES[type_].format(reference=analyse.reference or "sans référence"),
        message=_message(type_, analyse, motif), analyse_id=analyse.id, reference=analyse.reference,
        cree_le=datetime.utcnow(),
    )
    db.add(n)
    return n


# --- Lecture par le destinataire ----------------------------------------------------------

def non_lues(db: Session, utilisateur_id: uuid.UUID) -> int:
    return db.scalar(select(func.count(Notification.id)).where(
        Notification.utilisateur_id == utilisateur_id, Notification.lue_le.is_(None))) or 0


def lister(db: Session, utilisateur_id: uuid.UUID, limite: int = 20,
           avant: tuple[datetime, str] | None = None) -> list[Notification]:
    """Les plus récentes d'abord ; pagination par clé (date, id)."""
    q = select(Notification).where(Notification.utilisateur_id == utilisateur_id)
    if avant is not None:
        date, ident = avant
        q = q.where((Notification.cree_le < date) | ((Notification.cree_le == date) & (Notification.id < ident)))
    q = q.order_by(Notification.cree_le.desc(), Notification.id.desc()).limit(max(1, min(limite, LIMITE_MAX)))
    return list(db.scalars(q))


def marquer_lue(db: Session, utilisateur_id: uuid.UUID, notification_id: str) -> Notification | None:
    """None si elle n'existe pas ou appartient à un autre (même réponse : on ne
    révèle pas l'existence d'une notification d'autrui)."""
    n = db.get(Notification, notification_id)
    if n is None or n.utilisateur_id != utilisateur_id:
        return None
    if n.lue_le is None:
        n.lue_le = datetime.utcnow()
    return n


def tout_marquer_lu(db: Session, utilisateur_id: uuid.UUID) -> int:
    r = db.execute(update(Notification).where(
        Notification.utilisateur_id == utilisateur_id, Notification.lue_le.is_(None)
    ).values(lue_le=datetime.utcnow()))
    return r.rowcount or 0


def en_dict(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "titre": n.titre, "message": n.message,
            "analyse_id": n.analyse_id, "reference": n.reference,
            "cree_le": n.cree_le.isoformat() + "Z", "lue": n.lue_le is not None}
