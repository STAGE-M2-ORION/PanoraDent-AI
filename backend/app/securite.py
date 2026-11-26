"""Durcissement de l'API (sprint 12, lot D) : limitation de débit, en-têtes de
sécurité, taille des corps de requête.

Limitation : fenêtres fixes d'une minute, par adresse du poste et par règle,
tenues en mémoire. Le backend tourne en UN seul processus uvicorn (Dockerfile) :
le compteur est donc exact. Plusieurs processus demanderaient un compteur
partagé (Redis, base) ; ce n'est pas le cas au cabinet.

L'adresse est celle que le journal retient (`X-Real-IP`, posé et écrasé par
nginx) : derrière Caddy puis nginx, c'est bien celle du poste.
"""
import threading
import time
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from . import journal
from .config import settings
from .errors import corps

API_V1 = "/api/v1"
FENETRE_S = 60


@dataclass(frozen=True)
class Regle:
    nom: str
    reglage: str                       # nom du réglage (par minute ; 0 : désactivée)
    chemins: tuple[str, ...] = ()      # POST exacts ; vide : toute l'API
    journaliser: bool = False          # premier refus de la fenêtre au journal


REGLES = (
    Regle("connexion", "limite_connexion_minute", (f"{API_V1}/auth/connexion",), journaliser=True),
    Regle("mot_de_passe_oublie", "limite_oubli_minute", (f"{API_V1}/auth/mot-de-passe/oubli",), journaliser=True),
    # Liens reçus par e-mail : un jeton se devine encore moins à 10 essais par minute.
    Regle("liens", "limite_connexion_minute",
          (f"{API_V1}/auth/mot-de-passe/reinitialiser", f"{API_V1}/auth/premiere-connexion"), journaliser=True),
    # Demande d'accès depuis la page d'accueil (sprint 13) : publique, comme l'oubli.
    Regle("demande_acces", "limite_oubli_minute", (f"{API_V1}/demandes-acces",), journaliser=True),
    Regle("api", "limite_api_minute"),
)
# La sonde de santé est interrogée en continu par la supervision : jamais limitée.
HORS_LIMITE = (f"{API_V1}/health",)


class Compteur:
    """Compteurs par (règle, adresse) sur la fenêtre courante."""

    def __init__(self):
        self._verrou = threading.Lock()
        self._fenetre = -1
        self._comptes: dict[tuple[str, str], int] = {}

    def compter(self, regle: str, adresse: str, limite: int, maintenant: float | None = None) -> tuple[bool, int, int]:
        """(accepté, nombre dans la fenêtre, secondes avant la prochaine fenêtre)."""
        t = time.time() if maintenant is None else maintenant
        fenetre = int(t // FENETRE_S)
        with self._verrou:
            if fenetre != self._fenetre:            # nouvelle minute : on repart de zéro
                self._fenetre, self._comptes = fenetre, {}
            n = self._comptes.get((regle, adresse), 0) + 1
            self._comptes[(regle, adresse)] = n
        reste = max(1, int((fenetre + 1) * FENETRE_S - t + 0.999))
        return n <= limite, n, reste

    def vider(self):
        with self._verrou:
            self._fenetre, self._comptes = -1, {}


COMPTEUR = Compteur()


def _regles_de(request: Request):
    chemin = request.url.path
    if not chemin.startswith(f"{API_V1}/") or chemin in HORS_LIMITE:
        return []
    return [r for r in REGLES if not r.chemins or (request.method == "POST" and chemin in r.chemins)]


def _journaliser_refus(request: Request, regle: Regle, adresse: str) -> None:
    from .database import get_session_factory   # import tardif : les tests remplacent la fabrique
    from .main import app

    fabrique = app.dependency_overrides.get(get_session_factory, get_session_factory)()
    db = fabrique()
    try:
        journal.inscrire(db, "limite_depassee", journal.REFUS, request=request,
                         details={"regle": regle.nom, "limite_par_minute": getattr(settings, regle.reglage)})
        db.commit()
    finally:
        db.close()


async def limiter_le_debit(request: Request, call_next):
    adresse = journal.adresse_ip(request) or "inconnue"
    for regle in _regles_de(request):
        limite = getattr(settings, regle.reglage)
        if limite <= 0:
            continue
        accepte, n, reste = COMPTEUR.compter(regle.nom, adresse, limite)
        if not accepte:
            if regle.journaliser and n == limite + 1:   # une entrée par fenêtre, pas une par requête
                _journaliser_refus(request, regle, adresse)
            return JSONResponse(
                corps("trop_de_requetes", f"Trop de demandes : réessayez dans {reste} s."),
                status_code=429, headers={"Retry-After": str(reste)})
    return await call_next(request)


# --- En-têtes de sécurité ----------------------------------------------------------

# L'API ne sert que du JSON, des PDF, des CSV et des images : rien à exécuter,
# rien à encadrer. La documentation interactive (/docs) charge ses scripts :
# elle garde les en-têtes, sans la politique de contenu.
ENTETES = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}
# `form-action 'self'` : la seule page HTML de l'API est le formulaire du
# fournisseur d'identité de TEST (absent en production), qui s'envoie à l'API.
CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
SANS_CSP = ("/docs", "/redoc", "/openapi.json")


async def poser_les_entetes(request: Request, call_next):
    reponse = await call_next(request)
    for nom, valeur in ENTETES.items():
        reponse.headers.setdefault(nom, valeur)
    chemin = request.url.path
    if not chemin.startswith(SANS_CSP):
        reponse.headers.setdefault("Content-Security-Policy", CSP_API)
    if chemin.startswith(f"{API_V1}/"):
        # Données de santé : ni le navigateur ni un proxy ne les gardent.
        reponse.headers.setdefault("Cache-Control", "no-store")
    if "server" in reponse.headers:
        del reponse.headers["server"]
    return reponse
