"""Comptes utilisateurs, gérés par l'administrateur (`user:manage`).

Pas d'inscription publique et pas de suppression : un compte se désactive, ce
qui garde ses lignes de journal rattachées. À la création, l'intéressé reçoit
par e-mail son lien de première connexion (ou, pour un compte Google seul, une
invitation à « Continuer avec Google »). L'administrateur ne voit ni ne choisit
jamais un mot de passe : il peut renvoyer le lien, ou réinitialiser l'accès.
"""
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import SessionUtilisateur, Utilisateur, en_utc, maintenant
from ..auth_schemas import SessionOut, UtilisateurCreation, UtilisateurModification, UtilisateurOut
from ..database import get_db
from ..errors import ApiError
from ..permissions import USER_MANAGE
from ..services import auth_service, courriel

router = APIRouter(prefix="/utilisateurs", tags=["utilisateurs"])


def _ou_404(db: Session, utilisateur_id: uuid.UUID) -> Utilisateur:
    utilisateur = db.get(Utilisateur, utilisateur_id)
    if utilisateur is None:
        raise ApiError(404, "introuvable", "Utilisateur introuvable.")
    return utilisateur


def _journaliser(db, request, auteur, action, cible: Utilisateur, details=None) -> None:
    journal.inscrire(
        db, action, journal.SUCCES, request=request, utilisateur_id=auteur.id,
        cible=f"utilisateur:{cible.id}", details=details or {}, commit=False,
    )


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
    message = auth_service.message_premier_acces(db, utilisateur)
    _journaliser(db, request, auteur, "creation_compte", utilisateur, {
        "adresse": utilisateur.email, "role": utilisateur.role.libelle,
        "modes_connexion": utilisateur.modes_connexion,
    })
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
    """Nom, prénom, rôle, modes de connexion, activation. Désactivation et
    changement de rôle exigent un `motif`, inscrit au journal ; le contrôle du
    dernier administrateur se fait dans cette transaction, sous verrou."""
    utilisateur, details = auth_service.modifier_utilisateur(db, _ou_404(db, utilisateur_id), body, auteur)
    _journaliser(db, request, auteur, "modification_compte", utilisateur, details)
    db.commit()
    return UtilisateurOut.depuis(utilisateur)


@router.get("/{utilisateur_id}/sessions", response_model=list[SessionOut])
def sessions(
    utilisateur_id: uuid.UUID,
    _: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Sessions encore valides du compte, la plus récente d'abord."""
    cible = _ou_404(db, utilisateur_id)
    instant = maintenant()
    ouvertes = db.scalars(
        select(SessionUtilisateur)
        .where(SessionUtilisateur.utilisateur_id == cible.id, SessionUtilisateur.revoquee_le.is_(None))
        .order_by(SessionUtilisateur.cree_le.desc())
    ).all()
    return [
        SessionOut(id=s.id, agent=s.agent, ip=s.ip, cree_le=en_utc(s.cree_le),
                   expire_le=en_utc(s.expire_le), courante=False)
        for s in ouvertes if s.valide(instant)
    ]


@router.delete("/{utilisateur_id}/sessions", status_code=status.HTTP_204_NO_CONTENT)
def fermer_sessions(
    utilisateur_id: uuid.UUID,
    request: Request,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Ferme toutes les sessions ouvertes du compte (appareil perdu, départ…)."""
    cible = _ou_404(db, utilisateur_id)
    if cible.id == auteur.id:
        raise ApiError(400, "action_sur_soi", "Fermez vos propres sessions depuis votre profil.")
    nombre = auth_service.revoquer_sessions_compte(db, cible)
    _journaliser(db, request, auteur, "revocation_sessions", cible, {"sessions": nombre})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{utilisateur_id}/renvoyer-lien", status_code=status.HTTP_204_NO_CONTENT)
def renvoyer_lien(
    utilisateur_id: uuid.UUID,
    request: Request,
    taches: BackgroundTasks,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Nouveau lien de première connexion (24 h) ; les précédents deviennent
    inutilisables. Compte Google seul : nouvelle invitation."""
    cible = _ou_404(db, utilisateur_id)
    message = auth_service.renvoyer_premier_acces(db, cible)
    _journaliser(db, request, auteur, "renvoi_lien", cible)
    db.commit()
    taches.add_task(courriel.envoyer, message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{utilisateur_id}/reinitialiser-mot-de-passe", status_code=status.HTTP_204_NO_CONTENT)
def reinitialiser_mot_de_passe(
    utilisateur_id: uuid.UUID,
    request: Request,
    taches: BackgroundTasks,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Ferme les sessions du compte, lui envoie un lien de réinitialisation
    (1 h) et lui impose un nouveau mot de passe à sa prochaine connexion."""
    cible = _ou_404(db, utilisateur_id)
    message = auth_service.reinitialiser_par_admin(db, cible, auteur)
    _journaliser(db, request, auteur, "reinitialisation_par_admin", cible)
    db.commit()
    taches.add_task(courriel.envoyer, message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
