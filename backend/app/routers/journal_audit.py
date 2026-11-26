"""Journal d'audit (administration).

`GET /journal` : entrées du journal et verdicts de la période, filtrés,
groupés par session (voir `services/journal_audit.py`).
`GET /journal.csv` : les mêmes, à plat ; l'export est lui-même journalisé.

Réservé à la gestion des comptes (`user:manage`), comme l'écran : le journal
contient des adresses e-mail et des adresses IP.
"""
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..permissions import USER_MANAGE
from ..services import journal_audit

router = APIRouter(prefix="/journal", tags=["journal"])


def _filtres(
    jours: int = Query(default=7, ge=1, le=365),
    auteur: str = "",
    categorie: str = "",
    resultat: str = "",
    action: str = "",
    cible: str = Query(default="", max_length=120),
    avant: str = "",
) -> dict:
    if categorie and categorie not in journal_audit.CATEGORIES:
        raise ApiError(422, "filtre_invalide", f"Catégorie inconnue : {categorie}.")
    if action and action not in journal_audit.ACTIONS:
        raise ApiError(422, "filtre_invalide", f"Action inconnue : {action}.")
    try:
        journal_audit.lire_curseur(avant)
    except ValueError as exc:
        raise ApiError(422, "filtre_invalide", "Curseur de pagination invalide.") from exc
    if resultat not in ("", "succes", "echec"):
        raise ApiError(422, "filtre_invalide", "Résultat : « succes » ou « echec ».")
    try:
        auteur_id = uuid.UUID(auteur) if auteur else None
    except ValueError as exc:
        raise ApiError(422, "filtre_invalide", "Auteur inconnu.") from exc
    depuis = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=jours)
    return {"jours": jours, "depuis": depuis, "auteur": auteur_id, "categorie": categorie or None,
            "echecs": None if not resultat else resultat == "echec", "action": action or None,
            "cible": cible.strip() or None, "avant": avant or None}


@router.get("")
def lire_journal(
    f: dict = Depends(_filtres),
    _: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    resultat = journal_audit.lire(db, depuis=f["depuis"], auteur=f["auteur"], categorie=f["categorie"],
                                  echecs=f["echecs"], action=f["action"], cible=f["cible"], avant=f["avant"])
    return {"jours": f["jours"], **resultat}


@router.get("/entrees/{ident}")
def lire_entree(
    ident: str,
    _: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    """Détail d'une entrée, avec son contexte complet. Le journal ne se lit
    qu'en lecture : aucune route ne modifie ni ne supprime une entrée."""
    entree = journal_audit.detail(db, ident)
    if entree is None:
        raise ApiError(404, "introuvable", "Entrée du journal introuvable.")
    return entree


@router.get(".csv")
def exporter_journal(
    request: Request,
    f: dict = Depends(_filtres),
    utilisateur: Utilisateur = Depends(exiger(USER_MANAGE)),
    db: Session = Depends(get_db),
):
    lu = journal_audit.lire(db, depuis=f["depuis"], auteur=f["auteur"], categorie=f["categorie"],
                            echecs=f["echecs"], action=f["action"], cible=f["cible"], limite=20000)
    sortie = io.StringIO()
    ecrivain = csv.writer(sortie, delimiter=";", lineterminator="\r\n")
    ecrivain.writerow(["Date (UTC)", "Auteur", "Action", "Catégorie", "Cible", "Détail", "Résultat",
                       "Session (poste)", "Adresse IP"])
    lignes = sorted(((g, e) for g in lu["sessions"] for e in g["entrees"]), key=lambda ge: ge[1]["date"], reverse=True)
    for g, e in lignes:
        ecrivain.writerow([e["date"].strftime("%Y-%m-%d %H:%M:%S"), g["utilisateur"]["nom"] or "", e["libelle"],
                           e["categorie"], e["cible"] or "", e["precision"] or "", "Succès" if e["ok"] else "Échec",
                           g["poste"] or g["titre"] or "", e["ip"] or g["ip"] or ""])
    journal.inscrire(db, "export_journal", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     details={"lignes": len(lignes), "jours": f["jours"],
                              **({"categorie": f["categorie"]} if f["categorie"] else {})})
    nom = f"journal-audit-{datetime.now(timezone.utc):%Y-%m-%d}.csv"
    return Response("﻿" + sortie.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{nom}"', "Cache-Control": "no-store"})
