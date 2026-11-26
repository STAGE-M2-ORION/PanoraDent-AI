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


# --- Sprint 11 : export de la liste, renvoi groupé des liens ---------------------

@router.get(".csv")
def exporter_comptes(
    request: Request,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Liste des comptes au format CSV (tableur) ; l'export est journalisé.
    Ni mot de passe, ni jeton, ni photo : identité, rôle, état, dates."""
    import csv
    import io
    from datetime import datetime, timezone

    comptes = db.scalars(select(Utilisateur).order_by(Utilisateur.nom, Utilisateur.prenom, Utilisateur.email)).all()
    sortie = io.StringIO()
    ecrivain = csv.writer(sortie, delimiter=";", lineterminator="\r\n")
    ecrivain.writerow(["Nom", "Prénom", "Adresse e-mail", "Rôle", "État", "Modes de connexion",
                       "Créé le (UTC)", "Dernière connexion (UTC)"])
    for u in comptes:
        ecrivain.writerow([
            u.nom, u.prenom, u.email, u.role.libelle if u.role else "", "Actif" if u.actif else "Désactivé",
            " et ".join("mot de passe" if m == "mot_de_passe" else "Google" for m in u.modes_connexion or []),
            en_utc(u.cree_le).strftime("%Y-%m-%d %H:%M") if u.cree_le else "",
            en_utc(u.derniere_connexion).strftime("%Y-%m-%d %H:%M") if u.derniere_connexion else "Jamais",
        ])
    journal.inscrire(db, "export_comptes", journal.SUCCES, request=request, utilisateur_id=auteur.id,
                     details={"lignes": len(comptes)})
    nom = f"comptes-{datetime.now(timezone.utc):%Y-%m-%d}.csv"
    return Response("﻿" + sortie.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{nom}"', "Cache-Control": "no-store"})


def a_relancer(u: Utilisateur) -> bool:
    """Compte actif, jamais connecté, qui n'a pas encore de quoi se connecter."""
    return u.actif and u.derniere_connexion is None and not (
        u.autorise(auth_service.MODE_MOT_DE_PASSE) and u.mot_de_passe is not None)


@router.post("/renvoyer-liens")
def renvoyer_liens(
    request: Request,
    taches: BackgroundTasks,
    auteur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Renvoi groupé du lien de première connexion à tous les comptes actifs
    jamais connectés qui n'ont pas encore choisi de mot de passe. Chaque
    renvoi est journalisé, comme un renvoi à l'unité."""
    cibles = [u for u in db.scalars(select(Utilisateur)).all() if a_relancer(u)]
    messages = []
    for u in cibles:
        messages.append(auth_service.renvoyer_premier_acces(db, u))
        _journaliser(db, request, auteur, "renvoi_lien", u, {"groupe": True})
    db.commit()
    for m in messages:
        taches.add_task(courriel.envoyer, m)
    return {"envoyes": len(cibles), "comptes": sorted(u.email for u in cibles)}
