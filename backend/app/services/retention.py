"""Rétention du journal d'audit et purge (sprint 11).

Le journal est en écriture seule : aucune entrée ne se modifie ni ne se
supprime à l'unité. La SEULE suppression possible est la purge par rétention,
et elle est tenue de trois façons :

1. bornée : seules les entrées plus anciennes que la durée de conservation
   partent ; la durée ne descend jamais sous 6 mois ;
2. refusée dans la session qui vient d'abaisser la durée : abaisser puis
   purger dans la foulée est précisément le geste par lequel on efface une
   trace gênante ;
3. inscrite elle-même au journal, avec le nombre de lignes effacées et la
   date limite — l'entrée de la purge, postérieure à cette date, reste.

Les verdicts de la relecture ne sont pas des entrées du journal : ce sont des
données cliniques, jamais purgées ici.
"""
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Journal
from ..errors import ApiError
from ..models import ParametresCabinet

RETENTION_DEFAUT = 365
RETENTION_MIN = 180      # 6 mois
RETENTION_MAX = 3650     # 10 ans


def date_limite(p: ParametresCabinet, maintenant: datetime | None = None) -> datetime:
    """Les entrées antérieures à cette date (UTC) sont purgeables."""
    maintenant = maintenant or datetime.now(timezone.utc)
    return maintenant - timedelta(days=p.retention_jours or RETENTION_DEFAUT)


def apercu(db: Session, p: ParametresCabinet, session_id=None) -> dict:
    limite = date_limite(p)
    lignes, plus_ancienne = db.execute(
        select(func.count(Journal.id), func.min(Journal.horodatage)).where(Journal.horodatage < limite)).one()
    return {
        "retention_jours": p.retention_jours or RETENTION_DEFAUT,
        "minimum": RETENTION_MIN, "maximum": RETENTION_MAX, "defaut": RETENTION_DEFAUT,
        "date_limite": limite.replace(tzinfo=None),
        "lignes": lignes,
        "plus_ancienne": plus_ancienne.replace(tzinfo=None) if plus_ancienne else None,
        "abaissee_le": p.retention_abaissee_le,
        "purge_bloquee": session_id is not None and p.retention_abaissee_session_id == session_id,
    }


def modifier(db: Session, p: ParametresCabinet, jours: int, *, utilisateur_id, session_id,
             request: Request | None = None) -> bool:
    """Nouvelle durée ; renvoie True si elle a changé. Ne valide pas la transaction."""
    if not RETENTION_MIN <= jours <= RETENTION_MAX:
        raise ApiError(422, "retention_invalide",
                       f"La durée de conservation doit être comprise entre {RETENTION_MIN} et {RETENTION_MAX} jours.")
    avant = p.retention_jours or RETENTION_DEFAUT
    if jours == avant:
        return False
    if jours < avant:
        p.retention_abaissee_le = datetime.utcnow()
        p.retention_abaissee_session_id = session_id
    p.retention_jours = jours
    journal.inscrire(db, "retention_journal", journal.SUCCES, request=request, utilisateur_id=utilisateur_id,
                     details={"avant": avant, "apres": jours}, commit=False)
    return True


def purger(db: Session, p: ParametresCabinet, *, utilisateur_id, session_id, request: Request | None = None) -> dict:
    """Supprime les entrées antérieures à la date limite, puis l'inscrit au journal."""
    if session_id is not None and p.retention_abaissee_session_id == session_id:
        raise ApiError(
            409, "retention_abaissee_dans_la_session",
            "La durée de conservation vient d'être abaissée dans cette session : la purge y est refusée. "
            "Elle reste possible depuis une autre session.")
    limite = date_limite(p)
    lignes = db.execute(delete(Journal).where(Journal.horodatage < limite)).rowcount or 0
    journal.inscrire(db, "purge_journal", journal.SUCCES, request=request, utilisateur_id=utilisateur_id,
                     details={"lignes": lignes, "date_limite": limite.replace(tzinfo=None).isoformat(timespec="seconds"),
                              "retention_jours": p.retention_jours or RETENTION_DEFAUT},
                     commit=False)
    db.commit()
    return {"lignes": lignes, "date_limite": limite.replace(tzinfo=None)}
