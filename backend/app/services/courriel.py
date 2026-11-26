"""Envoi des e-mails : gabarits et trois modes (COURRIEL_MODE).

- `console` (développement) : le message, lien compris, est écrit dans les
  journaux du conteneur ;
- `memoire` (tests, APP_ENV=test seulement) : le message est gardé dans
  `BOITE`, où les tests et le parcours navigateur viennent le lire ;
- `smtp` (obligatoire en production) : envoi réel, STARTTLS par défaut.

Les routes appellent `envoyer` en tâche de fond (`BackgroundTasks`) : la
réponse part avant l'envoi, si bien que la lenteur ou la panne du serveur de
messagerie ne se lit pas dans le temps de réponse, et qu'une adresse inconnue
répond aussi vite qu'une adresse connue. Un échec d'envoi est journalisé,
jamais renvoyé à l'utilisateur.
"""
import html
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from ..config import settings

logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class Courriel:
    destinataire: str
    sujet: str
    texte: str
    html: str


# Boîte de réception du mode `memoire`.
BOITE: list[Courriel] = []


def envoyer(courriel: Courriel, lever: bool = False) -> None:
    """`lever=True` : l'échec remonte à l'appelant (notifications, qui
    l'inscrivent au journal) ; sinon il est seulement journalisé."""
    mode = settings.courriel_mode.lower()
    try:
        if mode == "memoire":
            BOITE.append(courriel)
        elif mode == "smtp":
            _smtp(courriel)
        else:
            logger.info(
                "[courriel] À : %s | Objet : %s\n%s", courriel.destinataire, courriel.sujet, courriel.texte
            )
    except Exception:  # noqa: BLE001 — l'envoi ne doit jamais faire tomber la requête
        if lever:
            raise
        logger.exception("[courriel] échec de l'envoi à %s (%s)", courriel.destinataire, courriel.sujet)


def _smtp(courriel: Courriel) -> None:
    message = EmailMessage()
    message["From"] = settings.courriel_expediteur
    message["To"] = courriel.destinataire
    message["Subject"] = courriel.sujet
    message.set_content(courriel.texte)
    message.add_alternative(courriel.html, subtype="html")
    with smtplib.SMTP(settings.smtp_hote, settings.smtp_port, timeout=15) as serveur:
        if settings.smtp_starttls:
            serveur.starttls()
        if settings.smtp_utilisateur:
            serveur.login(settings.smtp_utilisateur, settings.smtp_mot_de_passe)
        serveur.send_message(message)


# --- Gabarits ------------------------------------------------------------------

def _gabarit(destinataire: str, sujet: str, salutation: str, paragraphes: list[str],
             bouton: str, lien: str, pied: str) -> Courriel:
    texte = "\n\n".join([salutation, *paragraphes, f"{bouton} : {lien}", pied, "— PanoraDent AI"])
    corps = "".join(f"<p>{html.escape(p)}</p>" for p in paragraphes)
    page = (
        '<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1b2430">'
        f"<p>{html.escape(salutation)}</p>{corps}"
        f'<p><a href="{html.escape(lien, quote=True)}" style="display:inline-block;padding:10px 18px;'
        'background:#0b5cad;color:#fff;border-radius:6px;text-decoration:none">'
        f"{html.escape(bouton)}</a></p>"
        f'<p style="font-size:13px;color:#5a6472">{html.escape(pied)}</p>'
        '<p style="font-size:13px;color:#5a6472">— PanoraDent AI</p></div>'
    )
    return Courriel(destinataire=destinataire, sujet=sujet, texte=texte, html=page)


def _bonjour(prenom: str | None) -> str:
    return f"Bonjour {prenom.strip()}," if prenom and prenom.strip() else "Bonjour,"


def premiere_connexion(destinataire: str, prenom: str | None, lien: str, google: bool) -> Courriel:
    paragraphes = [
        "Un compte PanoraDent AI vient d'être créé pour vous par l'administrateur du cabinet.",
        "Pour l'activer, choisissez votre mot de passe en suivant le lien ci-dessous. "
        "Il est valable 24 heures et ne sert qu'une fois.",
    ]
    if google:
        paragraphes.append(
            "Vous pourrez aussi vous connecter avec « Continuer avec Google », "
            f"depuis l'adresse {destinataire}."
        )
    return _gabarit(
        destinataire, "Votre compte PanoraDent AI", _bonjour(prenom), paragraphes,
        "Choisir mon mot de passe", lien,
        "Si vous n'attendiez pas ce message, ignorez-le : aucun accès n'est ouvert sans ce lien.",
    )


def invitation_google(destinataire: str, prenom: str | None, lien_connexion: str) -> Courriel:
    """Compte qui se connecte uniquement avec Google : pas de mot de passe à choisir."""
    return _gabarit(
        destinataire, "Votre compte PanoraDent AI", _bonjour(prenom),
        [
            "Un compte PanoraDent AI vient d'être créé pour vous par l'administrateur du cabinet.",
            "Ce compte se connecte avec Google : sur la page de connexion, choisissez "
            f"« Continuer avec Google » et utilisez l'adresse {destinataire}.",
        ],
        "Ouvrir PanoraDent AI", lien_connexion,
        "Si vous n'attendiez pas ce message, ignorez-le.",
    )


def reinitialisation_par_admin(destinataire: str, prenom: str | None, lien: str) -> Courriel:
    return _gabarit(
        destinataire, "Votre mot de passe PanoraDent AI a été réinitialisé", _bonjour(prenom),
        [
            "L'administrateur du cabinet a réinitialisé le mot de passe de votre compte. "
            "Vos sessions ouvertes ont été fermées.",
            "Choisissez un nouveau mot de passe avec le lien ci-dessous : il est valable une heure "
            "et ne sert qu'une fois. Passé ce délai, utilisez « Mot de passe oublié ».",
        ],
        "Choisir un nouveau mot de passe", lien,
        "Si vous ne comprenez pas pourquoi, contactez l'administrateur de votre cabinet.",
    )


def refus_demande_acces(destinataire: str, nom: str | None, motif: str) -> Courriel:
    paragraphes = ["Votre demande d'accès à PanoraDent AI n'a pas été acceptée par l'administrateur."]
    if motif:
        paragraphes.append(f"Motif indiqué : {motif}")
    paragraphes.append("Pour en parler, adressez-vous directement à l'administrateur du cabinet.")
    return _gabarit(
        destinataire, "Votre demande d'accès à PanoraDent AI", _bonjour(nom), paragraphes,
        "Voir PanoraDent AI", settings.app_url.rstrip("/"),
        "Si vous n'avez fait aucune demande, ignorez ce message.",
    )


def reinitialisation(destinataire: str, prenom: str | None, lien: str) -> Courriel:
    return _gabarit(
        destinataire, "Réinitialisation de votre mot de passe PanoraDent AI", _bonjour(prenom),
        [
            "Une demande de réinitialisation du mot de passe a été faite pour votre compte.",
            "Le lien ci-dessous est valable une heure et ne sert qu'une fois. "
            "Une fois le nouveau mot de passe choisi, toutes vos sessions ouvertes sont fermées.",
        ],
        "Choisir un nouveau mot de passe", lien,
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : "
        "votre mot de passe actuel reste valable.",
    )
