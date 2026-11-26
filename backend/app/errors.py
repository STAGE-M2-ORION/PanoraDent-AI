"""Forme unique des erreurs de l'API : `{"code": ..., "message": ...}`.

Le `message` est en français et s'affiche tel quel dans l'interface ; le
`code` sert aux tests et aux journaux. Ainsi l'interface n'a qu'un seul cas
d'erreur à traiter, quelle que soit la route.
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None, headers=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


# Codes par défaut pour les `HTTPException` levées sans code explicite.
_CODES = {
    400: "requete_invalide",
    401: "non_authentifie",
    403: "acces_refuse",
    404: "introuvable",
    405: "methode_non_autorisee",
    409: "conflit",
    413: "fichier_trop_volumineux",
    429: "trop_de_requetes",
    422: "champ_invalide",
}


def corps(code: str, message: str, details=None) -> dict:
    body = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def _champ(loc) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "cookie", "header")]
    return ".".join(parts) or "requête"


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(
            corps(exc.code, exc.message, exc.details), status_code=exc.status, headers=exc.headers
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = _CODES.get(exc.status_code, "erreur_serveur" if exc.status_code >= 500 else "erreur")
        message = exc.detail if isinstance(exc.detail, str) else "Requête refusée."
        return JSONResponse(
            corps(code, message), status_code=exc.status_code, headers=getattr(exc, "headers", None)
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        erreurs = exc.errors()
        champs = sorted({_champ(e.get("loc", ())) for e in erreurs})
        details = [{"champ": _champ(e.get("loc", ())), "message": e.get("msg", "")} for e in erreurs]
        return JSONResponse(
            corps("champ_invalide", f"Champ invalide : {', '.join(champs)}.", details),
            status_code=422,
        )
