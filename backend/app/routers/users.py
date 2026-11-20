"""Comptes utilisateurs, gérés par l'administrateur (`user:manage`).

Pas d'inscription publique et pas de suppression : un compte se désactive, ce
qui garde ses lignes de journal rattachées. À la création, l'intéressé reçoit
par e-mail son lien de première connexion (ou, pour un compte Google seul, une
invitation à « Continuer avec Google »).
"""
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import MODE_GOOGLE, MODE_MOT_DE_PASSE, TypeJeton, Utilisateur
from ..auth_schemas import UtilisateurCreation, UtilisateurModification, UtilisateurOut
from ..database import get_db
from ..errors import ApiError
from ..permissions import USER_MANAGE
from ..config import settings
from ..services import auth_service, courriel, jetons

router = APIRouter(prefix="/utilisateurs", tags=["utilisateurs"])


def _ou_404(db: Session, utilisateur_id: uuid.UUID) -> Utilisateur:
    utilisateur = db.get(Utilisateur, utilisateur_id)
    if utilisateur is None:
        raise ApiError(404, "introuvable", "Utilisateur introuvable.")
    return utilisateur


@router.get("", response_model=list[UtilisateurOut])
def lister(_: Utilisateur = Depends(exiger(USER_MANAGE)), db: Session = Depends(get_db)):
    utilisateurs = db.scalars(select(Utilisateur).order_by(Utilisateur.cree_le)).all()
    return [UtilisateurOut.depuis(u) for u in utilisateurs]


@router.post("", response_model=UtilisateurOut, status_code=status.HTTP_201_CREATED)
def creer(
    body: UtilisateurCreation,
    request: Request,
    taches: BackgroundTasks,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    utilisateur = auth_service.creer_utilisateur(db, body)
    if utilisateur.autorise(MODE_MOT_DE_PASSE):
        jeton = jetons.emettre(db, utilisateur, TypeJeton.premiere_connexion)
        message = courriel.premiere_connexion(
            utilisateur.email, utilisateur.prenom, jetons.lien(TypeJeton.premiere_connexion, jeton),
            google=utilisateur.autorise(MODE_GOOGLE),
        )
    else:
        message = courriel.invitation_google(
            utilisateur.email, utilisateur.prenom, f"{settings.app_url.rstrip('/')}/connexion"
        )
    journal.inscrire(
        db, "creation_compte", journal.SUCCES, request=request, utilisateur_id=auteur.id,
        cible=f"utilisateur:{utilisateur.id}",
        details={
            "adresse": utilisateur.email, "role": utilisateur.role.libelle,
            "modes_connexion": utilisateur.modes_connexion,
        },
        commit=False,
    )
    db.commit()
    # Envoyé après la réponse : la lenteur du serveur de messagerie ne bloque pas l'écran.
    taches.add_task(courriel.envoyer, message)
    return UtilisateurOut.depuis(utilisateur)


@router.get("/{utilisateur_id}", response_model=UtilisateurOut)
def lire(
    utilisateur_id: uuid.UUID,
    _: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    return UtilisateurOut.depuis(_ou_404(db, utilisateur_id))


@router.patch("/{utilisateur_id}", response_model=UtilisateurOut)
def modifier(
    utilisateur_id: uuid.UUID,
    body: UtilisateurModification,
    request: Request,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    utilisateur = auth_service.modifier_utilisateur(db, _ou_404(db, utilisateur_id), body, auteur)
    journal.inscrire(
        db, "modification_compte", journal.SUCCES, request=request, utilisateur_id=auteur.id,
        cible=f"utilisateur:{utilisateur.id}",
        details={"champs": sorted(body.model_dump(exclude_none=True))}, commit=False,
    )
    db.commit()
    return UtilisateurOut.depuis(utilisateur)
