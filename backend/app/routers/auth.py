"""Connexion par mot de passe, parcours OAuth Google (code d'autorisation +
PKCE, mené côté serveur) et session.

La route de retour est une NAVIGATION du navigateur, pas un appel JSON : elle
redirige toujours, vers l'application en cas de succès, sinon vers
`/connexion?erreur=<code>` que la page de connexion traduit en message.
"""
import hmac
import logging

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .. import auth_security as sec
from .. import journal
from ..auth_deps import (
    CHEMIN_ACCES, CHEMIN_OAUTH, CHEMIN_RAFRAICHISSEMENT, COOKIE_ACCES, COOKIE_OAUTH,
    COOKIE_RAFRAICHISSEMENT, publique, session_ouverte,
)
from ..auth_models import Utilisateur
from ..auth_schemas import ConnexionEntree, UtilisateurOut
from ..config import settings
from ..database import get_db
from ..identity import ErreurEchange, ErreurJetonIdentite, fournisseur, verifier_jeton_identite
from ..services import auth_service
from ..services.auth_service import RefusConnexion

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/auth", tags=["auth"])
router_moi = APIRouter(tags=["auth"])

# Motifs de refus du jeton qui relèvent d'une requête rejouée ou forgée.
_MOTIFS_ETAT = {"nonce_invalide"}


def _cookie(response: Response, nom: str, valeur: str, chemin: str, max_age: int) -> None:
    response.set_cookie(
        nom, valeur, max_age=max_age, path=chemin,
        httponly=True, secure=settings.cookie_secure, samesite="lax",
    )


def _effacer(response: Response, nom: str, chemin: str) -> None:
    response.delete_cookie(nom, path=chemin, httponly=True, secure=settings.cookie_secure, samesite="lax")


def poser_session(response: Response, acces: str, rafraichissement: str | None = None) -> None:
    _cookie(response, COOKIE_ACCES, acces, CHEMIN_ACCES, int(sec.access_ttl().total_seconds()))
    if rafraichissement is not None:
        _cookie(
            response, COOKIE_RAFRAICHISSEMENT, rafraichissement, CHEMIN_RAFRAICHISSEMENT,
            int(sec.refresh_ttl().total_seconds()),
        )


def effacer_session(response: Response) -> None:
    _effacer(response, COOKIE_ACCES, CHEMIN_ACCES)
    _effacer(response, COOKIE_RAFRAICHISSEMENT, CHEMIN_RAFRAICHISSEMENT)


# --- Connexion par mot de passe ----------------------------------------------

@router.post("/connexion", response_model=UtilisateurOut, dependencies=[Depends(publique)])
def connexion(body: ConnexionEntree, request: Request, response: Response, db: Session = Depends(get_db)):
    """Adresse e-mail et mot de passe. Succès : profil, rôle et permissions,
    cookies de session posés. Refus : 401 neutre, 423 verrouillé, 403 désactivé."""
    utilisateur = auth_service.connexion_mot_de_passe(db, body.email, body.mot_de_passe, request)
    acces, rafraichissement, _ = auth_service.ouvrir_session(db, utilisateur, request)
    journal.inscrire(
        db, "connexion", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        details={"mode": "mot_de_passe", "adresse": utilisateur.email}, commit=False,
    )
    db.commit()
    poser_session(response, acces, rafraichissement)
    return UtilisateurOut.depuis(utilisateur)


# --- Parcours Google -------------------------------------------------------

@router.get("/google/demarrer", dependencies=[Depends(publique)])
def demarrer():
    """Tire `state`, `nonce` et le couple PKCE ; les garde dans un cookie de
    courte durée et renvoie le navigateur chez Google."""
    if not settings.fournisseur_factice and not (
        settings.google_client_id and settings.google_client_secret
    ):
        # Sans client OAuth, Google afficherait « Missing required parameter:
        # client_id » : on reste sur la page de connexion avec un message.
        logger.error(
            "Connexion Google impossible : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET "
            "doivent être définis dans .env (voir README, « Authentification »)."
        )
        return RedirectResponse(
            f"{settings.app_url}/connexion?erreur=echec_google", status_code=status.HTTP_302_FOUND
        )
    state, nonce = sec.random_token(), sec.random_token()
    verifier, challenge = sec.pkce_pair()
    response = RedirectResponse(
        fournisseur().url_autorisation(state, nonce, challenge), status_code=status.HTTP_302_FOUND
    )
    _cookie(
        response, COOKIE_OAUTH, sec.create_oauth_token(state, nonce, verifier),
        CHEMIN_OAUTH, int(sec.OAUTH_TTL.total_seconds()),
    )
    return response


@router.get("/google/retour", dependencies=[Depends(publique)])
def retour(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    def refus(code_erreur: str, motif: str, utilisateur_id=None) -> RedirectResponse:
        db.rollback()
        journal.inscrire(
            db, "connexion", journal.REFUS, request=request, utilisateur_id=utilisateur_id,
            details={"mode": "google", "code": code_erreur, "motif": motif},
        )
        response = RedirectResponse(
            f"{settings.app_url}/connexion?erreur={code_erreur}", status_code=status.HTTP_302_FOUND
        )
        _effacer(response, COOKIE_OAUTH, CHEMIN_OAUTH)
        return response

    # 1. La transaction doit venir de CE navigateur : state identique au cookie.
    try:
        transaction = sec.decode_token(request.cookies.get(COOKIE_OAUTH) or "", sec.OAUTH)
    except sec.TokenError:
        return refus("etat_invalide", "cookie_oauth_absent_ou_expire")
    if not state or not hmac.compare_digest(state.encode(), str(transaction.get("state", "")).encode()):
        return refus("etat_invalide", "state_different")
    if error:
        # Refus de consentement ou erreur côté Google.
        return refus("echec_google", f"google_error={error[:60]}")
    if not code:
        return refus("echec_google", "code_absent")

    # 2. Échange du code (avec le code_verifier PKCE) puis vérification du jeton.
    fourn = fournisseur()
    try:
        jeton = fourn.echanger_code(code, transaction["cv"])
        claims = verifier_jeton_identite(fourn, jeton, transaction["nonce"])
    except ErreurEchange as exc:
        return refus("echec_google", str(exc))
    except ErreurJetonIdentite as exc:
        if exc.motif == "adresse_non_verifiee":
            return refus("adresse_non_verifiee", exc.motif)
        return refus("etat_invalide" if exc.motif in _MOTIFS_ETAT else "echec_google", exc.motif)

    # 3. Rattachement à un compte existant — jamais de création ici.
    try:
        utilisateur, details = auth_service.rattacher_identite(db, claims)
    except RefusConnexion as exc:
        return refus(exc.code, exc.motif, exc.utilisateur_id)

    acces, rafraichissement, _ = auth_service.ouvrir_session(db, utilisateur, request)
    journal.inscrire(
        db, "connexion", journal.SUCCES, request=request,
        utilisateur_id=utilisateur.id, details=details, commit=False,
    )
    db.commit()

    response = RedirectResponse(f"{settings.app_url}/", status_code=status.HTTP_302_FOUND)
    _effacer(response, COOKIE_OAUTH, CHEMIN_OAUTH)
    poser_session(response, acces, rafraichissement)
    return response


# --- Session ---------------------------------------------------------------

@router.post("/rafraichir", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(publique)])
def rafraichir(request: Request, db: Session = Depends(get_db)):
    """Nouveau jeton d'accès à partir du cookie de rafraîchissement."""
    acces, _ = auth_service.rafraichir(db, request.cookies.get(COOKIE_RAFRAICHISSEMENT))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    poser_session(response, acces)
    return response


@router.post("/deconnexion", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(publique)])
def deconnexion(request: Request, db: Session = Depends(get_db)):
    """Révoque la session côté serveur et efface les deux cookies. Répond 204
    même sans session valide : le navigateur doit toujours être nettoyé."""
    session = auth_service.session_depuis_rafraichissement(
        db, request.cookies.get(COOKIE_RAFRAICHISSEMENT)
    )
    if session is None:
        # Cookie de rafraîchissement absent : on se rabat sur la session du jeton d'accès.
        try:
            payload = sec.decode_token(request.cookies.get(COOKIE_ACCES) or "", sec.ACCESS)
            session = auth_service.session_depuis_id(db, payload.get("sid"))
        except sec.TokenError:
            session = None
    if session is not None and session.revoquee_le is None:
        auth_service.revoquer_session(session)
        journal.inscrire(
            db, "deconnexion", journal.SUCCES, request=request,
            utilisateur_id=session.utilisateur_id, cible=f"session:{session.id}", commit=False,
        )
        db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    effacer_session(response)
    return response


@router_moi.get("/moi", response_model=UtilisateurOut)
def moi(utilisateur: Utilisateur = Depends(session_ouverte)):
    """Profil, rôle et permissions de l'utilisateur connecté."""
    return UtilisateurOut.depuis(utilisateur)
