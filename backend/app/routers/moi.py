"""Profil de l'utilisateur connecté : identité, préférences, mot de passe, sessions.

Toutes ces routes exigent une session ouverte (`session_ouverte`) et n'agissent
que sur le compte connecté : aucun identifiant de compte n'y est accepté.
"""
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth_security as sec
from .. import journal
from ..auth_deps import session_ouverte
from ..auth_models import MODE_MOT_DE_PASSE, SessionUtilisateur, Utilisateur, en_utc, maintenant
from ..auth_schemas import (
    ChangementMotDePasse, PreferencesModification, ProfilModification, SessionOut, UtilisateurOut,
    preferences_completes,
)
from ..database import get_db
from ..errors import ApiError
from ..services import auth_service
from .auth import effacer_session

router = APIRouter(prefix="/moi", tags=["profil"])


@router.patch("", response_model=UtilisateurOut)
def modifier_profil(
    body: ProfilModification,
    request: Request,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Identité et coordonnées professionnelles. Un champ envoyé à `null` (ou
    vide) est effacé ; un champ absent est laissé tel quel. L'adresse e-mail
    n'est pas modifiable ici : c'est l'identifiant du compte."""
    champs = body.model_dump(exclude_unset=True)
    for nom, valeur in champs.items():
        if nom in ("nom", "prenom"):
            valeur = valeur or ""
        setattr(utilisateur, nom, valeur)
    journal.inscrire(
        db, "modification_profil", journal.SUCCES, request=request,
        utilisateur_id=utilisateur.id, details={"champs": sorted(champs)}, commit=False,
    )
    db.commit()
    db.refresh(utilisateur)
    return UtilisateurOut.depuis(utilisateur)


@router.patch("/preferences")
def modifier_preferences(
    body: PreferencesModification,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
) -> dict:
    """Thème, langue, seuil de confiance par défaut, notifications. Seuls les
    champs envoyés changent ; renvoie l'ensemble des préférences."""
    # Nouveau dict : une mutation en place d'une colonne JSON passerait inaperçue.
    utilisateur.preferences = {**(utilisateur.preferences or {}), **body.model_dump(exclude_unset=True)}
    db.commit()
    return preferences_completes(utilisateur.preferences)


@router.post("/mot-de-passe", status_code=status.HTTP_204_NO_CONTENT)
def changer_mot_de_passe(
    body: ChangementMotDePasse,
    request: Request,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Changement avec vérification de l'ancien mot de passe. Un compte qui
    n'en a pas encore (connecté par Google) en définit un sans « ancien ».
    Les AUTRES sessions du compte sont révoquées ; celle-ci continue."""
    if not utilisateur.autorise(MODE_MOT_DE_PASSE):
        raise ApiError(
            400, "mode_non_autorise",
            "La connexion par mot de passe n'est pas autorisée pour ce compte. "
            "Demandez-la à l'administrateur.",
        )
    if utilisateur.mot_de_passe is not None and not sec.verifier_mot_de_passe(
        body.ancien or "", utilisateur.mot_de_passe
    ):
        journal.inscrire(
            db, "changement_mot_de_passe", journal.REFUS, request=request,
            utilisateur_id=utilisateur.id, details={"via": "profil", "motif": "ancien_incorrect"},
        )
        raise ApiError(400, "ancien_mot_de_passe_incorrect", "Le mot de passe actuel est incorrect.")
    if body.ancien and body.nouveau == body.ancien:
        raise ApiError(422, "mot_de_passe_trop_faible", "Le nouveau mot de passe doit être différent de l'actuel.")
    try:
        sec.verifier_politique(body.nouveau, utilisateur.email)
    except sec.MotDePasseTropFaible as exc:
        raise ApiError(422, "mot_de_passe_trop_faible", str(exc)) from exc

    definition = utilisateur.mot_de_passe is None
    utilisateur.mot_de_passe = sec.hacher_mot_de_passe(body.nouveau)
    utilisateur.doit_changer_mdp = False
    courante = request.state.session_id
    for session in db.scalars(select(SessionUtilisateur).where(
        SessionUtilisateur.utilisateur_id == utilisateur.id,
        SessionUtilisateur.revoquee_le.is_(None),
        SessionUtilisateur.id != courante,
    )):
        auth_service.revoquer_session(session)
    journal.inscrire(
        db, "changement_mot_de_passe", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        details={"via": "profil", "definition": definition}, commit=False,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[SessionOut])
def lister_sessions(
    request: Request,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Sessions encore valides du compte, la plus récente d'abord ; la
    session courante est signalée."""
    instant = maintenant()
    sessions = db.scalars(
        select(SessionUtilisateur)
        .where(SessionUtilisateur.utilisateur_id == utilisateur.id, SessionUtilisateur.revoquee_le.is_(None))
        .order_by(SessionUtilisateur.cree_le.desc())
    ).all()
    return [
        SessionOut(
            id=s.id, agent=s.agent, ip=s.ip, cree_le=en_utc(s.cree_le), expire_le=en_utc(s.expire_le),
            courante=s.id == request.state.session_id,
        )
        for s in sessions if s.valide(instant)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoquer_session(
    session_id: uuid.UUID,
    request: Request,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Révoque une de SES sessions (404 pour une session d'un autre compte ou
    déjà close). Révoquer la session courante revient à se déconnecter."""
    session = db.get(SessionUtilisateur, session_id)
    if session is None or session.utilisateur_id != utilisateur.id or not session.valide():
        raise ApiError(404, "introuvable", "Session introuvable ou déjà fermée.")
    auth_service.revoquer_session(session)
    journal.inscrire(
        db, "revocation_session", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        cible=f"session:{session.id}", commit=False,
    )
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if session.id == request.state.session_id:
        effacer_session(response)
    return response
