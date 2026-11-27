"""Tableau de bord d'administration (sprint 11) : indicateurs agrégés.

`GET /administration/indicateurs` (`user:manage`) : comptes par rôle et par
état, analyses du mois, connexions et échecs de la semaine, nouveaux comptes
par mois. L'espace occupé et l'état des services se lisent sur `/stockage` et
`/health`.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..permissions import ANALYSIS_CREATE, ANALYSIS_READ, USER_MANAGE
from ..services import activite, attributions, indicateurs

router = APIRouter(tags=["administration"])


@router.get("/administration/indicateurs", dependencies=[Depends(exiger(USER_MANAGE))])
def lire_indicateurs(db: Session = Depends(get_db)):
    return indicateurs.indicateurs(db)


# --- Tableau de bord du praticien et du lecteur (sprint 12) ------------------------

@router.get("/tableau-de-bord/activite")
def lire_activite(
    portee: str = "",
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)),
    db: Session = Depends(get_db),
):
    """Indicateurs d'activité. Portée par défaut : « moi » pour qui dépose des
    analyses (ses analyses), « cabinet » pour les autres (lecteur)."""
    portee = portee or ("moi" if utilisateur.a_permission(ANALYSIS_CREATE) else "cabinet")
    if portee not in ("moi", "cabinet"):
        raise ApiError(422, "filtre_invalide", "Portée : « moi » ou « cabinet ».")
    return activite.indicateurs(db, utilisateur.id, portee, attributions.condition(utilisateur))
