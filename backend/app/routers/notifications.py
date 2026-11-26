"""Notifications de l'utilisateur connecté (sprint 13).

- `GET  /moi/notifications` : les plus récentes et le nombre de non lues ;
  `?avant=<curseur>` pour la page suivante ;
- `POST /moi/notifications/{id}/lue` : une notification lue ;
- `POST /moi/notifications/lues` : toutes lues ;
- `WS   /moi/notifications/flux` : arrivée en temps réel (lot B).

Chacun ne voit et ne modifie que les siennes : session ouverte suffit, comme
pour les préférences. Une notification d'autrui répond 404, comme une absente.
"""
import asyncio
import base64
import binascii
from datetime import datetime
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Response, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth_deps import COOKIE_ACCES, session_encore_valide, session_ouverte, utilisateur_du_jeton
from ..auth_models import Utilisateur
from ..config import settings
from ..database import get_db, get_session_factory
from ..errors import ApiError
from ..models import Notification
from ..services import diffusion
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


# --- Flux temps réel (lot B) -----------------------------------------------------------------

CONTROLE_S = 30          # revérification de la session et rappel du compte des non lues


def origine_autorisee(origine: str | None, hote: str | None) -> bool:
    """Contre le détournement de WebSocket entre sites : le navigateur envoie
    les cookies de session à l'ouverture, quel que soit le site qui l'ouvre.
    Seule la page de PanoraDent elle-même (même hôte, ou origine déclarée) peut
    s'abonner."""
    if not origine:
        return False
    origine = origine.rstrip("/")
    if origine in {o.rstrip("/") for o in settings.allowed_origins} | {settings.app_url.rstrip("/")}:
        return True
    return bool(hote) and urlparse(origine).netloc == hote


@router.websocket("/flux")
async def flux(websocket: WebSocket, fabrique=Depends(get_session_factory)):
    """Notifications en temps réel. Messages envoyés :
    `{"type": "etat", "non_lues": n}` à l'ouverture puis toutes les 30 s ;
    `{"type": "notification", "notification": {...}, "non_lues": n}` à chaque
    nouvelle. Fermeture 4401 : session absente, expirée ou révoquée ; 4429 :
    trop d'onglets ouverts."""
    if not origine_autorisee(websocket.headers.get("origin"), websocket.headers.get("host")):
        await websocket.close(code=1008)          # refus de la poignée de main (403)
        return

    def identifier():
        with fabrique() as db:
            utilisateur, session_id = utilisateur_du_jeton(db, websocket.cookies.get(COOKIE_ACCES))
            return utilisateur.id, session_id

    try:
        utilisateur_id, session_id = await run_in_threadpool(identifier)
    except ApiError:
        await websocket.accept()
        await websocket.close(code=4401)
        return

    await websocket.accept()
    file = diffusion.DIFFUSEUR.abonner(utilisateur_id)
    if file is None:
        await websocket.close(code=4429)
        return

    def etat() -> dict | None:
        with fabrique() as db:
            if not session_encore_valide(db, session_id, utilisateur_id):
                return None
            return {"type": "etat", "non_lues": service.non_lues(db, utilisateur_id)}

    def charger(notification_id: str) -> dict | None:
        with fabrique() as db:
            n = db.get(Notification, notification_id)
            if n is None or n.utilisateur_id != utilisateur_id:
                return None
            return {"type": "notification", "notification": service.en_dict(n),
                    "non_lues": service.non_lues(db, utilisateur_id)}

    try:
        message = await run_in_threadpool(etat)
        while message is not None:
            await websocket.send_json(message)
            try:
                notification_id = await asyncio.wait_for(file.get(), timeout=CONTROLE_S)
                # Introuvable ou d'un autre : on renvoie simplement l'état.
                message = await run_in_threadpool(charger, notification_id) or await run_in_threadpool(etat)
            except asyncio.TimeoutError:
                message = await run_in_threadpool(etat)
        await websocket.close(code=4401)          # session fermée pendant la connexion
    except WebSocketDisconnect:
        pass
    finally:
        diffusion.DIFFUSEUR.desabonner(utilisateur_id, file)
