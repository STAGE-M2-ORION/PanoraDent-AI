"""Santé de la plateforme (sprint 11).

`GET /health` : publique, pour un outil de supervision extérieur. Un état par
service (`ok`, `degrade`, `panne`) et un statut global, rien d'autre : ni
version, ni trace d'erreur, ni nom de machine. Réponse 503 si la base est
injoignable (l'API ne peut alors rien servir), 200 sinon, même dégradée.

`GET /supervision` : réservée à l'administration (`user:manage`). Les mêmes
sondes avec leur latence et leur explication, et les indicateurs
d'exploitation (analyses par jour, durée moyenne, taux d'échec).
"""
import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth_deps import exiger, publique
from ..database import get_session_factory
from ..permissions import USER_MANAGE
from ..services import supervision

router = APIRouter()


@router.get("/health", dependencies=[Depends(publique)])
async def health(fabrique=Depends(get_session_factory)):
    services = await supervision.sonder(fabrique)
    corps = supervision.etat_public(services)
    return JSONResponse(corps, status_code=503 if services["base"]["etat"] == supervision.PANNE else 200,
                        headers={"Cache-Control": "no-store"})


def _indicateurs(fabrique) -> dict | None:
    try:
        with fabrique() as db:
            return supervision.indicateurs(db)
    except Exception:  # noqa: BLE001 — base en panne : la sonde le dit déjà
        return None


@router.get("/supervision", dependencies=[Depends(exiger(USER_MANAGE))])
async def lire_supervision(fabrique=Depends(get_session_factory)):
    services = await supervision.sonder(fabrique)
    try:
        indicateurs = await asyncio.wait_for(asyncio.to_thread(_indicateurs, fabrique), timeout=supervision.DELAI)
    except asyncio.TimeoutError:
        indicateurs = None
    return {"statut": supervision.etat_global(services), "services": services, "indicateurs": indicateurs}
