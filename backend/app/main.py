from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth_models, errors  # noqa: F401  (auth_models enregistre les tables)
from .auth_deps import publique
from .config import settings
from .routers import analyses, auth, fake_idp, health, model, photos, roles, users

API_V1 = "/api/v1"

app = FastAPI(
    title="PanoraDent AI — Backend",
    description="Aide au diagnostic par analyse IA des panoramiques. Prototype de recherche.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,   # ALLOWED_ORIGINS (JSON)
    allow_credentials=True,                   # cookies de session
    allow_methods=["*"],
    allow_headers=["*"],
)

errors.install(app)

for module in (health, analyses, model, users, roles, photos):
    app.include_router(module.router, prefix=API_V1)
app.include_router(auth.router, prefix=API_V1)
app.include_router(auth.router_moi, prefix=API_V1)

if settings.fournisseur_factice:
    # Garde-fou redondant avec la validation de `config.py` : jamais hors test.
    assert settings.app_env.lower() == "test"
    app.include_router(fake_idp.router, prefix=API_V1)


@app.get("/", dependencies=[Depends(publique)])
def root():
    return {"service": "panoradent-backend", "docs": "/docs"}
