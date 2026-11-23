from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartParser

from . import auth_models, errors  # noqa: F401  (auth_models enregistre les tables)
from .auth_deps import publique
from .config import settings
from .routers import analyses, auth, boite_courriels, cabinet, essais_modeles, fake_idp, health, model, moi, photos, revue, roles, stockage, users
from .services.anonymize import TAILLE_MAX

API_V1 = "/api/v1"

# Une radiographie reçue ne doit JAMAIS être écrite sur le disque, même
# temporairement. Starlette garde en mémoire les fichiers jusqu'à ce seuil,
# puis les déverse dans un fichier temporaire : on le place au-dessus de la
# taille maximale acceptée (20 Mo, plus le formulaire autour).
CORPS_MAX = TAILLE_MAX + 1024 * 1024
MultiPartParser.max_file_size = CORPS_MAX

app = FastAPI(
    title="PanoraDent AI — Backend",
    description="Aide au diagnostic par analyse IA des panoramiques. Prototype de recherche.",
    version="1.0.0",
)


@app.middleware("http")
async def refuser_les_envois_trop_gros(request, call_next):
    """Refuse d'emblée (413) un import plus gros que permis, d'après la taille
    annoncée, AVANT de lire le corps : un fichier refusé n'est donc jamais
    déversé sur le disque non plus. (nginx borne aussi la taille en amont.)"""
    if request.method == "POST" and request.url.path.startswith(f"{API_V1}/analyses"):
        try:
            taille = int(request.headers.get("content-length") or 0)
        except ValueError:
            taille = 0
        if taille > CORPS_MAX:
            return JSONResponse(
                {"code": "fichier_trop_volumineux", "message": "Le fichier dépasse 20 Mo."}, status_code=413
            )
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,   # ALLOWED_ORIGINS (JSON)
    allow_credentials=True,                   # cookies de session
    allow_methods=["*"],
    allow_headers=["*"],
)

errors.install(app)

for module in (health, analyses, revue, model, users, roles, photos, moi, stockage, cabinet):
    app.include_router(module.router, prefix=API_V1)
app.include_router(auth.router, prefix=API_V1)
app.include_router(auth.router_moi, prefix=API_V1)

if settings.fournisseur_factice:
    # Garde-fou redondant avec la validation de `config.py` : jamais hors test.
    assert settings.app_env.lower() == "test"
    app.include_router(fake_idp.router, prefix=API_V1)

if settings.courriel_mode.lower() == "memoire":
    # Même garde-fou : `config.py` refuse ce mode hors APP_ENV=test.
    assert settings.app_env.lower() == "test"
    app.include_router(boite_courriels.router, prefix=API_V1)

if settings.app_env.lower() == "test":
    # Publication de versions factices pour le parcours Playwright du registre.
    app.include_router(essais_modeles.router, prefix=API_V1)


@app.get("/", dependencies=[Depends(publique)])
def root():
    return {"service": "panoradent-backend", "docs": "/docs"}
