"""E-mails de notification (sprint 13, lot C), envoyés par le worker.

Seuls deux événements partent aussi par e-mail : **analyse échouée** et
**analyse rouverte**, chacun selon sa case dans les préférences du profil.
« Analyse terminée » reste dans l'application : elle arrive quelques secondes
après le dépôt, un e-mail serait du bruit.

Règles, dans l'ordre :

1. un compte désactivé ou supprimé ne reçoit rien ;
2. préférence décochée : rien (`refuse`) ;
3. **délai de grâce** (2 min par défaut) : le praticien en ligne lit la
   notification dans l'application ; si elle est lue avant la fin du délai,
   pas d'e-mail (`lue_avant`) ;
4. **pas de rafale** : au plus un e-mail toutes les 5 minutes par
   destinataire ; ce qui arrive entre-temps part ensemble, dans un seul
   message.

Chaque notification donne lieu à au plus un e-mail (son état est gardé sur la
ligne). Le message ne contient que les références anonymes et un lien vers
l'application, jamais d'image, de note ni de conclusion. Un échec d'envoi est
journalisé et n'est pas retenté : la notification reste visible dans
l'application.
"""
import logging
from datetime import datetime, timedelta
from itertools import groupby

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Utilisateur
from ..auth_schemas import preferences_completes
from ..config import settings
from ..models import Notification, TypeNotification
from . import courriel

logger = logging.getLogger("uvicorn.error")

# Type de notification → case des préférences.
PREFERENCE = {
    TypeNotification.ANALYSE_ECHOUEE: "courriel_analyse_echouee",
    TypeNotification.ANALYSE_ROUVERTE: "courriel_analyse_rouverte",
}


class Statut:
    ENVOYE = "envoye"
    LUE_AVANT = "lue_avant"
    REFUSE = "refuse"
    SANS_OBJET = "sans_objet"
    ECHEC = "echec"


def statut_initial(type_: str) -> str | None:
    """À la création : None (à décider) pour un type qui peut partir par e-mail."""
    return None if type_ in PREFERENCE else Statut.SANS_OBJET


def _lien(analyse_id: str | None) -> str:
    base = settings.app_url.rstrip("/")
    return f"{base}/analyse?id={analyse_id}" if analyse_id else f"{base}/tableau-de-bord"


def gabarit(utilisateur: Utilisateur, notifications: list[Notification]) -> courriel.Courriel:
    une = len(notifications) == 1
    sujet = notifications[0].titre if une else f"PanoraDent AI : {len(notifications)} notifications"
    paragraphes = [f"{n.titre}. {n.message}" for n in notifications]
    return courriel._gabarit(
        utilisateur.email, sujet, courriel._bonjour(utilisateur.prenom), paragraphes,
        "Ouvrir l'analyse" if une else "Ouvrir PanoraDent AI", _lien(notifications[0].analyse_id if une else None),
        "Vous recevez ce message selon vos préférences : Profil › Préférences pour choisir les "
        "e-mails que vous recevez. Seule la référence anonyme de l'analyse y figure.",
    )


def envoyer_en_attente(db: Session, maintenant: datetime | None = None) -> int:
    """Décide pour chaque notification en attente, envoie ce qui doit l'être ;
    renvoie le nombre d'e-mails envoyés. Appelé régulièrement par le worker."""
    maintenant = maintenant or datetime.utcnow()
    grace = timedelta(seconds=settings.notif_courriel_grace_s)
    intervalle = timedelta(seconds=settings.notif_courriel_intervalle_s)
    en_attente = db.scalars(
        select(Notification).where(Notification.courriel_statut.is_(None))
        .order_by(Notification.utilisateur_id, Notification.cree_le)
        .with_for_update(skip_locked=True)
    ).all()
    envoyes = 0
    for utilisateur_id, lot in groupby(en_attente, key=lambda n: n.utilisateur_id):
        lot = list(lot)
        utilisateur = db.get(Utilisateur, utilisateur_id)
        if utilisateur is None or not utilisateur.actif:
            for n in lot:
                n.courriel_statut = Statut.SANS_OBJET
            continue
        preferences = preferences_completes(utilisateur.preferences)
        restantes = []
        for n in lot:
            if n.type not in PREFERENCE:
                n.courriel_statut = Statut.SANS_OBJET
            elif not preferences.get(PREFERENCE[n.type]):
                n.courriel_statut = Statut.REFUSE
            elif n.lue_le is not None:
                n.courriel_statut = Statut.LUE_AVANT
            else:
                restantes.append(n)
        if not restantes or restantes[0].cree_le > maintenant - grace:
            continue                                        # le délai de grâce court encore
        dernier = db.scalar(select(func.max(Notification.courriel_le)).where(
            Notification.utilisateur_id == utilisateur_id, Notification.courriel_statut == Statut.ENVOYE))
        if dernier is not None and dernier > maintenant - intervalle:
            continue                                        # pas de rafale : elles partiront ensemble
        message = gabarit(utilisateur, restantes)
        try:
            courriel.envoyer(message, lever=True)
            statut, resultat = Statut.ENVOYE, journal.SUCCES
            envoyes += 1
        except Exception:  # noqa: BLE001 — la notification reste visible dans l'application
            logger.exception("[courriel] notifications non envoyées à %s", utilisateur.email)
            statut, resultat = Statut.ECHEC, journal.ECHEC
        for n in restantes:
            n.courriel_statut, n.courriel_le = statut, maintenant
        journal.inscrire(db, "notifications_envoyees", resultat, cible=f"utilisateur:{utilisateur_id}",
                         details={"nombre": len(restantes), "references": [n.reference for n in restantes]},
                         commit=False)
    db.commit()
    return envoyes
