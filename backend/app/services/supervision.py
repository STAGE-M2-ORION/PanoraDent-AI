"""Sondes de santé et indicateurs d'exploitation (sprint 11).

Quatre sondes : la base, le stockage objet, la file de traitement, le service
d'inférence. Chacune a un délai de garde court (2 s) et échoue SEULE : une base
injoignable n'empêche pas d'afficher l'état du stockage. Une page de
supervision qui attendrait trente secondes sur une base en panne serait
inutilisable au moment précis où elle servirait.

Deux lectures :
- `etat_public` : un état par service, et rien d'autre (page de santé lisible
  sans session par un outil de supervision : ni version, ni trace, ni nom de
  machine) ;
- `etat_detaille` : le même, avec latence et explication, pour l'administration.
"""
import asyncio
import time
from datetime import datetime, timedelta

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Analysis, Document, EtatDocument, StatutAnalyse
from . import storage

DELAI = 2.0                                # secondes, par sonde
RETARD_FILE = timedelta(minutes=10)        # au-delà, le worker ne semble plus traiter la file

OK, DEGRADE, PANNE = "ok", "degrade", "panne"
SERVICES = ("base", "stockage", "file", "inference")


def _resultat(etat: str, detail: str, debut: float) -> dict:
    return {"etat": etat, "detail": detail, "latence_ms": round((time.monotonic() - debut) * 1000)}


def _base(fabrique) -> tuple[str, str]:
    with fabrique() as db:
        db.execute(text("SELECT 1"))
    return OK, "La base répond."


def _stockage() -> tuple[str, str]:
    storage.ensure_bucket()
    return OK, "Le stockage des images répond."


def _file(fabrique) -> tuple[str, str]:
    with fabrique() as db:
        en_file, plus_ancienne = db.execute(
            select(func.count(Analysis.id), func.min(Analysis.lance_le))
            .where(Analysis.statut == StatutAnalyse.EN_FILE)).one()
        documents = db.scalar(select(func.count(Document.id))
                              .where(Document.etat == EtatDocument.EN_ATTENTE)) or 0
    attente = f"{en_file} analyse{'s' if en_file > 1 else ''} et {documents} document{'s' if documents > 1 else ''} en attente"
    if plus_ancienne is not None and datetime.utcnow() - plus_ancienne > RETARD_FILE:
        minutes = int((datetime.utcnow() - plus_ancienne).total_seconds() // 60)
        return DEGRADE, f"{attente} ; la plus ancienne attend depuis {minutes} min : le worker ne semble plus la traiter."
    return OK, f"{attente}."


def _inference() -> tuple[str, str]:
    r = httpx.get(f"{settings.inference_url}/health", timeout=DELAI)
    if r.status_code != 200:
        return PANNE, f"Le service d'inférence répond en erreur (HTTP {r.status_code})."
    if r.json().get("mode") == "mock":
        # Modèle factice : normal en développement et en test, anormal au cabinet.
        if settings.app_env.lower() == "production":
            return DEGRADE, "Le service d'inférence tourne sans modèle entraîné : détections factices."
        return OK, "Modèle factice (développement ou test)."
    return OK, "Modèle chargé."


async def _sonder(nom: str, fonction, *args) -> tuple[str, dict]:
    debut = time.monotonic()
    try:
        etat, detail = await asyncio.wait_for(asyncio.to_thread(fonction, *args), timeout=DELAI)
        return nom, _resultat(etat, detail, debut)
    except asyncio.TimeoutError:
        return nom, _resultat(PANNE, f"Pas de réponse en {DELAI:g} s.", debut)
    except Exception as exc:  # noqa: BLE001 — une sonde qui échoue n'emporte pas les autres
        return nom, _resultat(PANNE, f"Injoignable ({exc.__class__.__name__}).", debut)


async def sonder(fabrique) -> dict[str, dict]:
    """Les quatre sondes, en parallèle ; chacune bornée à DELAI secondes."""
    resultats = await asyncio.gather(
        _sonder("base", _base, fabrique),
        _sonder("stockage", _stockage),
        _sonder("file", _file, fabrique),
        _sonder("inference", _inference),
    )
    return dict(resultats)


def etat_global(services: dict[str, dict]) -> str:
    etats = {s["etat"] for s in services.values()}
    return OK if etats == {OK} else DEGRADE


def etat_public(services: dict[str, dict]) -> dict:
    """Un état par service, et rien d'autre."""
    return {"statut": etat_global(services), "services": {n: services[n]["etat"] for n in SERVICES}}


def indicateurs(db: Session, jours: int = 14) -> dict:
    """Indicateurs d'exploitation : analyses par jour, durée moyenne, taux d'échec."""
    depuis = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=jours - 1)
    lignes = db.execute(
        select(Analysis.lance_le, Analysis.statut, Analysis.duree_ms)
        .where(Analysis.lance_le.is_not(None), Analysis.lance_le >= depuis)).all()
    par_jour = {(depuis + timedelta(days=i)).date().isoformat(): 0 for i in range(jours)}
    terminees, echouees, durees = 0, 0, []
    for lance_le, statut, duree in lignes:
        par_jour[lance_le.date().isoformat()] = par_jour.get(lance_le.date().isoformat(), 0) + 1
        if statut == StatutAnalyse.TERMINEE:
            terminees += 1
            if duree is not None:
                durees.append(duree)
        elif statut == StatutAnalyse.ECHOUEE:
            echouees += 1
    traitees = terminees + echouees
    return {
        "jours": jours,
        "analyses_par_jour": [{"jour": j, "analyses": n} for j, n in sorted(par_jour.items())],
        "duree_moyenne_ms": round(sum(durees) / len(durees)) if durees else None,
        "taux_echec": round(echouees / traitees, 4) if traitees else None,
        "traitees": traitees,
        "echouees": echouees,
    }
