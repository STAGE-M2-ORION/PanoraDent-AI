"""Tableau de bord d'administration (sprint 11) : indicateurs agrégés.

`GET /administration/indicateurs` (`user:manage`) : comptes par rôle et par
état, analyses du mois, connexions et échecs de la semaine, nouveaux comptes
par mois. L'espace occupé et l'état des services se lisent sur `/stockage` et
`/health`.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth_deps import exiger
from ..database import get_db
from ..permissions import USER_MANAGE
from ..services import indicateurs

router = APIRouter(prefix="/administration", tags=["administration"])


@router.get("/indicateurs", dependencies=[Depends(exiger(USER_MANAGE))])
def lire_indicateurs(db: Session = Depends(get_db)):
    return indicateurs.indicateurs(db)
