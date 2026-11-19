"""Fournisseurs d'identité et vérification du jeton d'identité OpenID Connect.

Deux fournisseurs partagent la même interface et, surtout, la même
vérification (`verifier_jeton_identite`) :

- `FournisseurGoogle` : le vrai, avec PKCE ; clés publiques de Google mises en
  cache selon `Cache-Control` et rechargées si un `kid` inconnu se présente ;
- `FournisseurFactice` : le fournisseur de remplacement des tests automatisés.
  Il signe localement ses jetons avec une clé RSA tirée au démarrage. Il n'est
  instanciable qu'avec APP_ENV=test (contrôlé dans `config.py` ET ici).

La signature, `aud` et `exp` sont vérifiés par la bibliothèque officielle
`google-auth` ; `iss`, `nonce` et `email_verified` le sont ensuite ici. Les six
contrôles sont tous obligatoires.
"""
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt as google_crypt
from google.auth import jwt as google_jwt
from jose import jwt as jose_jwt

from . import auth_security as sec
from .config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs"
# Google émet l'une ou l'autre forme (documentation OpenID Connect de Google).
EMETTEURS_GOOGLE = frozenset({"https://accounts.google.com", "accounts.google.com"})
TOLERANCE_HORLOGE_S = 10


class ErreurJetonIdentite(Exception):
    """Jeton d'identité refusé. `motif` part au journal, jamais à l'utilisateur."""

    def __init__(self, motif: str):
        super().__init__(motif)
        self.motif = motif


class ErreurEchange(Exception):
    """L'échange du code d'autorisation contre un jeton a échoué."""


# --- Vérification commune --------------------------------------------------

def _classer(exc: Exception) -> str:
    texte = str(exc).lower()
    if "audience" in texte:
        return "aud_invalide"
    if "expired" in texte or "too early" in texte or "required claim" in texte:
        return "jeton_expire"
    return "signature_invalide"


def verifier_jeton_identite(fournisseur, jeton: str, nonce_attendu: str) -> dict:
    """Vérifie le jeton d'identité ; renvoie ses revendications ou lève
    `ErreurJetonIdentite`. L'ordre compte : rien n'est lu dans le jeton avant
    que sa signature soit établie."""
    try:
        kid = jose_jwt.get_unverified_header(jeton).get("kid")
    except Exception as exc:  # jeton qui n'a pas la forme d'un JWT
        raise ErreurJetonIdentite("jeton_illisible") from exc

    certs = fournisseur.certificats()
    if kid not in certs:
        # Google fait tourner ses clés : une clé inconnue impose un rechargement.
        certs = fournisseur.certificats(forcer=True)
    try:
        claims = google_jwt.decode(
            jeton,
            certs=certs,
            audience=settings.google_client_id,  # 1. signature  2. aud  3. exp
            clock_skew_in_seconds=TOLERANCE_HORLOGE_S,
        )
    except Exception as exc:
        raise ErreurJetonIdentite(_classer(exc)) from exc

    if claims.get("iss") not in EMETTEURS_GOOGLE:  # 4. iss
        raise ErreurJetonIdentite("emetteur_invalide")
    nonce = claims.get("nonce")
    if not nonce or not hmac.compare_digest(str(nonce), nonce_attendu):  # 5. nonce
        raise ErreurJetonIdentite("nonce_invalide")
    if claims.get("email_verified") is not True:  # 6. email_verified
        raise ErreurJetonIdentite("adresse_non_verifiee")
    if not claims.get("sub") or not claims.get("email"):
        raise ErreurJetonIdentite("revendications_manquantes")
    return claims


# --- Google ----------------------------------------------------------------

_MAX_AGE = re.compile(r"max-age=(\d+)")


class FournisseurGoogle:
    nom = "google"

    def __init__(self):
        self._certs: dict[str, str] = {}
        self._expire_a = 0.0
        self._verrou = threading.Lock()

    def url_autorisation(self, state: str, nonce: str, code_challenge: str) -> str:
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        if settings.google_allowed_domain:
            # Simple indication à l'écran de Google : le contrôle réel est
            # fait au retour, sur la revendication `hd` du jeton vérifié.
            params["hd"] = settings.google_allowed_domain
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    def echanger_code(self, code: str, code_verifier: str) -> str:
        try:
            r = httpx.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            raise ErreurEchange(f"google_injoignable: {type(exc).__name__}") from exc
        if r.status_code != 200:
            raise ErreurEchange(f"echange_refuse: HTTP {r.status_code}")
        jeton = r.json().get("id_token")
        if not jeton:
            raise ErreurEchange("id_token_absent")
        return jeton

    def certificats(self, forcer: bool = False) -> dict[str, str]:
        with self._verrou:
            if forcer or not self._certs or time.monotonic() >= self._expire_a:
                r = httpx.get(GOOGLE_CERTS_URL, timeout=10.0)
                r.raise_for_status()
                self._certs = r.json()
                m = _MAX_AGE.search(r.headers.get("cache-control", ""))
                self._expire_a = time.monotonic() + (int(m.group(1)) if m else 3600)
            return dict(self._certs)


# --- Fournisseur de remplacement (tests uniquement) ------------------------

def _cle_rsa():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _pem_prive(cle) -> str:
    return cle.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")


def _pem_public(cle) -> str:
    return cle.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("ascii")


def sub_factice(email: str) -> str:
    """`sub` stable dérivé de l'adresse, comme Google en délivre un par compte."""
    return "fake-" + hashlib.sha256(email.strip().lower().encode()).hexdigest()[:20]


class FournisseurFactice:
    """Délivre des jetons d'identité signés localement, sans réseau.

    `emettre_code(revendications, code_challenge)` prépare ce que Google
    renverrait ; `echanger_code` vérifie le PKCE puis signe le jeton. Les tests
    peuvent signer avec une clé étrangère (`cle="etrangere"`) pour simuler une
    signature invalide.
    """
    nom = "fake"
    KID = "fake-1"

    def __init__(self):
        if settings.app_env.lower() != "test":
            raise RuntimeError("Fournisseur d'identité de remplacement refusé hors APP_ENV=test.")
        self._cle = _cle_rsa()
        self._cle_etrangere = _cle_rsa()
        self._codes: dict[str, tuple[dict, str, str]] = {}
        self._verrou = threading.Lock()

    def url_autorisation(self, state: str, nonce: str, code_challenge: str) -> str:
        params = {"state": state, "nonce": nonce, "code_challenge": code_challenge}
        return f"/api/v1/auth/fake/autoriser?{urlencode(params)}"

    def revendications(self, email: str, nonce: str | None = None, **surcharges) -> dict:
        now = datetime.now(timezone.utc)
        base = {
            "iss": "https://accounts.google.com",
            "aud": settings.google_client_id,
            "sub": sub_factice(email),
            "email": email,
            "email_verified": True,
            "given_name": "",
            "family_name": "",
            "nonce": nonce,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
        }
        base.update(surcharges)
        return base

    def emettre_code(self, revendications: dict, code_challenge: str, cle: str = "principale") -> str:
        code = secrets.token_urlsafe(24)
        with self._verrou:
            self._codes[code] = (revendications, code_challenge, cle)
        return code

    def signer(self, revendications: dict, cle: str = "principale") -> str:
        prive = self._cle if cle == "principale" else self._cle_etrangere
        signer = google_crypt.RSASigner.from_string(_pem_prive(prive), key_id=self.KID)
        return google_jwt.encode(signer, revendications).decode("ascii")

    def echanger_code(self, code: str, code_verifier: str) -> str:
        with self._verrou:
            entree = self._codes.pop(code, None)  # usage unique, comme chez Google
        if entree is None:
            raise ErreurEchange("code_inconnu")
        revendications, challenge, cle = entree
        if not hmac.compare_digest(sec.pkce_challenge(code_verifier), challenge):
            raise ErreurEchange("pkce_invalide")
        return self.signer(revendications, cle)

    def certificats(self, forcer: bool = False) -> dict[str, str]:
        return {self.KID: _pem_public(self._cle)}


_fournisseur = None
_verrou_fournisseur = threading.Lock()


def fournisseur():
    """Fournisseur actif, selon IDENTITY_PROVIDER (instancié une fois)."""
    global _fournisseur
    with _verrou_fournisseur:
        if _fournisseur is None:
            _fournisseur = FournisseurFactice() if settings.fournisseur_factice else FournisseurGoogle()
        return _fournisseur
