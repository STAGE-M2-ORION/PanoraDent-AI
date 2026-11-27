"""Demandes d'accès (sprint 13).

- `POST /demandes-acces` — **publique**, limitée par poste : la réponse est
  toujours la même (rien ne dit si un compte existe déjà) ;
- `GET  /administration/demandes-acces` — `user:manage` ;
- `POST /administration/demandes-acces/{id}/accepter` — crée le compte (rôle et
  modes choisis par l'administrateur), lien de première connexion envoyé ;
- `POST /administration/demandes-acces/{id}/refuser` — motif facultatif,
  transmis au demandeur.
"""
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from ..auth_deps import exiger, publique
from ..auth_models import MODES_CONNEXION, Utilisateur
from ..auth_schemas import ModeConnexion, UtilisateurOut
from ..database import get_db
from ..errors import ApiError
from ..models import StatutDemande
from ..permissions import USER_MANAGE
from ..services import courriel
from ..services import demandes_acces as service

router = APIRouter(tags=["demandes d'accès"])
REPONSE = ("Demande transmise. L'administrateur du cabinet l'examinera ; si elle est acceptée, "
           "vous recevrez un e-mail pour activer votre compte.")


class DemandeIn(BaseModel):
    model_config = {"extra": "forbid"}

    nom: str = Field(min_length=2, max_length=120)
    email: EmailStr = Field(max_length=255)
    profil: Literal["Chirurgien-dentiste", "Patient"]
    etablissement: str = Field(default="", max_length=160)
    ville: str = Field(default="", max_length=80)
    message: str = Field(default="", max_length=1000)

    @field_validator("nom")
    @classmethod
    def _nom_non_vide(cls, v: str) -> str:
        if len(v.strip()) < 2:
            raise ValueError("Indiquez votre nom.")
        return v


class AcceptationIn(BaseModel):
    model_config = {"extra": "forbid"}

    role_id: uuid.UUID
    modes_connexion: list[ModeConnexion] = Field(default_factory=lambda: list(MODES_CONNEXION), min_length=1)
    nom: str | None = Field(default=None, max_length=120)
    prenom: str | None = Field(default=None, max_length=120)


class RefusIn(BaseModel):
    model_config = {"extra": "forbid"}

    motif: str = Field(default="", max_length=500)


@router.post("/demandes-acces", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(publique)])
def deposer(corps: DemandeIn, request: Request, db=Depends(get_db)):
    service.deposer(db, nom=corps.nom, email=corps.email, profil=corps.profil, etablissement=corps.etablissement,
                    ville=corps.ville, message=corps.message, request=request)
    return {"message": REPONSE}


@router.get("/administration/demandes-acces")
def lister(statut: str | None = None, _: Utilisateur = Depends(exiger(USER_MANAGE)), db=Depends(get_db)):
    if statut and statut not in StatutDemande.TOUS:
        raise ApiError(422, "filtre_invalide", "État : en_attente, acceptee ou refusee.")
    return {"en_attente": service.nombre_en_attente(db),
            "demandes": [service.en_dict(d) for d in service.lister(db, statut)]}


@router.post("/administration/demandes-acces/{demande_id}/accepter", status_code=status.HTTP_201_CREATED)
def accepter(demande_id: str, corps: AcceptationIn, request: Request, taches: BackgroundTasks,
             auteur: Utilisateur = Depends(exiger(USER_MANAGE)), db=Depends(get_db)):
    d = service.obtenir_en_attente(db, demande_id)
    utilisateur, message = service.accepter(db, d, role_id=corps.role_id, modes_connexion=list(corps.modes_connexion),
                                            nom=corps.nom, prenom=corps.prenom, auteur=auteur, request=request)
    taches.add_task(courriel.envoyer, message)
    return {"demande": service.en_dict(d), "utilisateur": UtilisateurOut.depuis(utilisateur).model_dump(mode="json")}


@router.post("/administration/demandes-acces/{demande_id}/refuser")
def refuser(demande_id: str, corps: RefusIn, request: Request, taches: BackgroundTasks,
            auteur: Utilisateur = Depends(exiger(USER_MANAGE)), db=Depends(get_db)):
    d = service.obtenir_en_attente(db, demande_id)
    message = service.refuser(db, d, motif=corps.motif, auteur=auteur, request=request)
    taches.add_task(courriel.envoyer, message)
    return {"demande": service.en_dict(d)}
