"""Demandes d'accès (sprint 13) : il n'y a pas d'inscription libre.

1. Un visiteur dépose sa demande depuis la page d'accueil (route publique,
   limitée par poste). La réponse est **toujours la même** : qu'un compte
   existe déjà pour l'adresse, qu'une demande soit déjà en attente ou que la
   file soit pleine, rien ne se lit de l'extérieur.
2. Chaque administrateur actif est prévenu (cloche et, selon sa préférence,
   e-mail).
3. Un administrateur **accepte** — il choisit le rôle et les modes de
   connexion ; le compte est créé et le demandeur reçoit le lien de première
   connexion habituel — ou **refuse**, avec un motif facultatif transmis au
   demandeur. La décision passe « lue » chez les autres administrateurs.
4. Tout est au journal. Les demandes traitées, qui portent des données
   personnelles, sont supprimées 90 jours après leur traitement.

Aucun e-mail n'est envoyé au dépôt : on pourrait sinon faire écrire la
plateforme à n'importe quelle adresse.
"""
from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Utilisateur
from ..auth_schemas import UtilisateurCreation
from ..errors import ApiError
from ..models import DemandeAcces, Notification, StatutDemande
from . import auth_service, courriel, notifications

# Deux profils : le chirurgien-dentiste (rôle proposé : Praticien) et le
# patient (rôle proposé : Lecteur, qui ne voit que les analyses qu'on lui confie).
PROFILS = ("Chirurgien-dentiste", "Patient")
EN_ATTENTE_MAX = 200
CONSERVATION_JOURS = 90


def deposer(db: Session, *, nom: str, email: str, profil: str, etablissement: str = "", ville: str = "",
            message: str = "", request: Request | None = None) -> DemandeAcces | None:
    """La demande créée, ou None quand elle est écartée (sans que le visiteur
    le sache : même réponse dans tous les cas)."""
    email = auth_service.normaliser_email(email)

    def ecarter(motif: str) -> None:
        journal.inscrire(db, "demande_acces_recue", journal.REFUS, request=request,
                         details={"adresse": email, "motif": motif})
        return None

    if auth_service.par_email(db, email) is not None:
        return ecarter("compte_existant")
    if db.scalar(select(DemandeAcces.id).where(DemandeAcces.email == email,
                                               DemandeAcces.statut == StatutDemande.EN_ATTENTE)):
        return ecarter("demande_en_attente")
    if nombre_en_attente(db) >= EN_ATTENTE_MAX:
        return ecarter("file_pleine")

    d = DemandeAcces(nom=nom.strip(), email=email, profil=profil, etablissement=etablissement.strip(),
                     ville=ville.strip(), message=message.strip(), cree_le=datetime.utcnow())
    db.add(d)
    db.flush()
    notifications.notifier_demande_acces(db, d)
    journal.inscrire(db, "demande_acces_recue", journal.SUCCES, request=request, cible=f"demande:{d.id}",
                     details={"adresse": email, "profil": profil}, commit=False)
    db.commit()
    return d


def nombre_en_attente(db: Session) -> int:
    return db.scalar(select(func.count(DemandeAcces.id)).where(
        DemandeAcces.statut == StatutDemande.EN_ATTENTE)) or 0


def lister(db: Session, statut: str | None = None) -> list[DemandeAcces]:
    """Les demandes en attente d'abord, puis les plus récentes."""
    q = select(DemandeAcces)
    if statut:
        q = q.where(DemandeAcces.statut == statut)
    attente = (DemandeAcces.statut != StatutDemande.EN_ATTENTE)
    return list(db.scalars(q.order_by(attente, DemandeAcces.cree_le.desc())))


def obtenir_en_attente(db: Session, demande_id: str) -> DemandeAcces:
    d = db.get(DemandeAcces, demande_id, with_for_update=True)
    if d is None:
        raise ApiError(404, "introuvable", "Demande d'accès introuvable.")
    if d.statut != StatutDemande.EN_ATTENTE:
        raise ApiError(409, "demande_deja_traitee", "Cette demande a déjà été traitée.")
    return d


def _clore(db: Session, d: DemandeAcces, statut: str, auteur: Utilisateur) -> None:
    d.statut, d.traitee_le, d.traitee_par_id = statut, datetime.utcnow(), auteur.id
    # La décision est prise : la notification n'attend plus personne.
    db.execute(update(Notification).where(
        Notification.lien == f"/admin/demandes-acces?demande={d.id}", Notification.lue_le.is_(None)
    ).values(lue_le=datetime.utcnow()))


def accepter(db: Session, d: DemandeAcces, *, role_id, modes_connexion: list[str], nom: str | None,
             prenom: str | None, auteur: Utilisateur, request: Request | None = None):
    """(compte créé, e-mail de première connexion à envoyer après la réponse)."""
    utilisateur = auth_service.creer_utilisateur(db, UtilisateurCreation(
        email=d.email, nom=(nom if nom is not None else d.nom), prenom=prenom or "",
        role_id=role_id, modes_connexion=modes_connexion))
    message = auth_service.message_premier_acces(db, utilisateur)
    d.utilisateur_id = utilisateur.id
    _clore(db, d, StatutDemande.ACCEPTEE, auteur)
    journal.inscrire(db, "demande_acces_acceptee", journal.SUCCES, request=request, utilisateur_id=auteur.id,
                     cible=f"demande:{d.id}", details={"adresse": d.email, "role": utilisateur.role.libelle},
                     commit=False)
    journal.inscrire(db, "creation_compte", journal.SUCCES, request=request, utilisateur_id=auteur.id,
                     cible=f"utilisateur:{utilisateur.id}",
                     details={"adresse": utilisateur.email, "role": utilisateur.role.libelle,
                              "modes_connexion": utilisateur.modes_connexion, "depuis": "demande_acces"},
                     commit=False)
    db.commit()
    return utilisateur, message


def refuser(db: Session, d: DemandeAcces, *, motif: str | None, auteur: Utilisateur,
            request: Request | None = None) -> courriel.Courriel:
    d.motif_refus = (motif or "").strip()[:500]
    _clore(db, d, StatutDemande.REFUSEE, auteur)
    journal.inscrire(db, "demande_acces_refusee", journal.SUCCES, request=request, utilisateur_id=auteur.id,
                     cible=f"demande:{d.id}", details={"adresse": d.email, "motif": d.motif_refus},
                     commit=False)
    db.commit()
    return courriel.refus_demande_acces(d.email, d.nom, d.motif_refus)


def purger(db: Session, maintenant: datetime | None = None) -> int:
    """Supprime les demandes traitées depuis plus de 90 jours (données personnelles)."""
    limite = (maintenant or datetime.utcnow()) - timedelta(days=CONSERVATION_JOURS)
    r = db.execute(delete(DemandeAcces).where(DemandeAcces.statut != StatutDemande.EN_ATTENTE,
                                              DemandeAcces.traitee_le < limite))
    if r.rowcount:
        journal.inscrire(db, "demandes_acces_purgees", journal.SUCCES,
                         details={"supprimees": r.rowcount, "traitees_avant": limite.date().isoformat()},
                         commit=False)
    db.commit()
    return r.rowcount or 0


def en_dict(d: DemandeAcces) -> dict:
    return {"id": d.id, "nom": d.nom, "email": d.email, "profil": d.profil, "etablissement": d.etablissement,
            "ville": d.ville, "message": d.message, "statut": d.statut, "cree_le": d.cree_le.isoformat() + "Z",
            "traitee_le": d.traitee_le.isoformat() + "Z" if d.traitee_le else None,
            "motif_refus": d.motif_refus, "utilisateur_id": str(d.utilisateur_id) if d.utilisateur_id else None}
