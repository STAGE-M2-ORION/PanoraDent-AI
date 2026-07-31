from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, analyses, model

app = FastAPI(
    title="PanoraDent AI — Backend",
    description="Aide au diagnostic par analyse IA des panoramiques. Prototype de recherche.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # à restreindre en production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(analyses.router, prefix="/api")
app.include_router(model.router, prefix="/api")


@app.get("/")
def root():
    return {"service": "panoradent-backend", "docs": "/docs"}
