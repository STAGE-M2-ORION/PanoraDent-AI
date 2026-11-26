"""Notifications de l'utilisateur connecté (sprint 13).

- `GET  /moi/notifications` : les plus récentes et le nombre de non lues ;
  `?avant=<curseur>` pour la page suivante ;
- `POST /moi/notifications/{id}/lue` : une notification lue ;
- `POST /moi/notifications/lues` : toutes lues.

Chacun ne voit et ne modifie que les siennes : session ouverte suffit, comme
pour les préférences. Une notification d'autrui répond 404, comme une absente.
"""
import base64
import binascii
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..auth_deps import session_ouverte
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..services import notifications as service

router = APIRouter(prefix="/moi/notifications", tags=["notifications"])


def _curseur(n) -> str:
    return base64.urlsafe_b64encode(f"{n.cree_le.isoformat()}|{n.id}".encode()).decode().rstrip("=")


def _lire_curseur(valeur: str) -> tuple[datetime, str]:
    try:
        brut = base64.urlsafe_b64decode(valeur + "=" * (-len(valeur) % 4)).decode()
        date, ident = brut.split("|", 1)
        return datetime.fromisoformat(date), ident
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise ApiError(422, "curseur_invalide", "Curseur de pagination invalide.") from exc


@router.get("")
def lister(avant: str | None = None, limite: int = 20,
           utilisateur: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    limite = max(1, min(limite, service.LIMITE_MAX))
    page = service.lister(db, utilisateur.id, limite + 1, _lire_curseur(avant) if avant else None)
    suite = len(page) > limite
    page = page[:limite]
    return {"non_lues": service.non_lues(db, utilisateur.id),
            "notifications": [service.en_dict(n) for n in page],
            "suivant": _curseur(page[-1]) if suite else None}


@router.post("/{notification_id}/lue", status_code=204)
def marquer_lue(notification_id: str, utilisateur: Utilisateur = Depends(session_ouverte),
                db: Session = Depends(get_db)):
    if service.marquer_lue(db, utilisateur.id, notification_id) is None:
        raise ApiError(404, "introuvable", "Notification introuvable.")
    db.commit()
    return Response(status_code=204)


@router.post("/lues")
def tout_marquer_lu(utilisateur: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    n = service.tout_marquer_lu(db, utilisateur.id)
    db.commit()
    return {"marquees": n}
