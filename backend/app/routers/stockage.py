"""Volume occupé dans le stockage objet, pour l'administration (`user:manage`).

Une alerte est levée au-delà de STOCKAGE_ALERTE_GO : radiographies et comptes
rendus s'accumulent, et un disque plein bloquerait les imports."""
from fastapi import APIRouter, Depends

from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..config import settings
from ..errors import ApiError
from ..permissions import USER_MANAGE
from ..schemas import StockageOut
from ..services import storage

router = APIRouter(prefix="/stockage", tags=["stockage"])


@router.get("", response_model=StockageOut)
def etat_du_stockage(_: Utilisateur = Depends(exiger(USER_MANAGE))):
    try:
        objets, octets = storage.usage()
    except Exception as exc:  # noqa: BLE001
        raise ApiError(503, "stockage_indisponible", "Le stockage objet ne répond pas.") from exc
    seuil = int(settings.stockage_alerte_go * 1024 ** 3)
    return StockageOut(objets=objets, octets=octets, seuil_octets=seuil, alerte=octets >= seuil)
