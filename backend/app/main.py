from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import auth_models  # noqa: F401  (enregistre les tables RBAC sur Base.metadata)
from .config import settings
from .routers import health, analyses, model, auth, users, roles

app = FastAPI(
    title="PanoraDent AI — Backend",
    description="Aide au diagnostic par analyse IA des panoramiques. Prototype de recherche.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,   # ALLOWED_ORIGINS (JSON)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(analyses.router, prefix="/api")
app.include_router(model.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(roles.router, prefix="/api")


@app.get("/")
def root():
    return {"service": "panoradent-backend", "docs": "/docs"}
