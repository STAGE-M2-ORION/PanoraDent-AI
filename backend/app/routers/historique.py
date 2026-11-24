"""Historique des analyses (sprint 8) : liste filtrée et paginée, export CSV,
fiche d'historique d'une analyse.

- `GET /historique` : recherche (référence ou n°), filtres (état, déposant,
  période, type d'anomalie retenue), tri (plus récentes ou plus anciennes
  d'abord), pagination PAR CLÉ (date, id) : la page suivante part de la
  dernière ligne vue, et reste rapide quel que soit le nombre d'analyses
  (index sur la date, l'état et le déposant).
- `GET /historique.csv` : les mêmes filtres, toutes les lignes, pour un suivi
  d'activité ; l'export est journalisé.
- `GET /analyses/{id}/historique` : la fiche — import, traitement, verdicts,
  clôture, réouverture, comptes rendus produits — lue dans le JOURNAL et dans
  la table des verdicts (jamais modifiée), pas dans des champs recopiés.
"""
import base64
import csv
import io
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Journal, Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import LABEL_DENT, LABELS, Analysis, Detection, EtatDetection, StatutAnalyse
from ..permissions import ANALYSIS_READ
from ..schemas import _nom
from ..services import revue
from .analyses import _ou_404, resume_analyse

router = APIRouter(tags=["historique"])

ETATS = ("queued", "running", "pending", "inprogress", "closed", "failed")
TRIS = ("recent", "ancien")


# --- Filtres -------------------------------------------------------------------------------------

def _revue_commencee():
    """Au moins une anomalie a reçu un verdict."""
    return exists().where(Detection.analysis_id == Analysis.id, Detection.label != LABEL_DENT,
                          Detection.etat != EtatDetection.A_REVOIR)


def _condition_etat(etat: str):
    terminee_ouverte = and_(Analysis.statut == StatutAnalyse.TERMINEE, Analysis.cloturee_le.is_(None))
    return {
        "queued": Analysis.statut == StatutAnalyse.EN_FILE,
        "running": Analysis.statut == StatutAnalyse.EN_COURS,
        "failed": Analysis.statut == StatutAnalyse.ECHOUEE,
        "closed": and_(Analysis.statut == StatutAnalyse.TERMINEE, Analysis.cloturee_le.is_not(None)),
        "pending": and_(terminee_ouverte, ~_revue_commencee()),
        "inprogress": and_(terminee_ouverte, _revue_commencee()),
    }[etat]


def _rang():
    """N° d'analyse : rang de l'analyse dans le cabinet, de la plus ancienne (1) à la plus récente."""
    return select(Analysis.id.label("id"),
                  func.row_number().over(order_by=(Analysis.created_at, Analysis.id)).label("numero")).subquery()


def _filtres(rang, utilisateur, q, deposant, etat, du, au, types) -> list:
    conditions = []
    q = (q or "").strip()
    if q:
        motif = f"%{q.replace('%', '').replace('_', '')}%"
        conditions.append(or_(Analysis.reference.ilike(motif), rang.c.numero == int(q)) if q.isdigit()
                          else Analysis.reference.ilike(motif))
    if deposant:
        if deposant == "moi":
            conditions.append(Analysis.utilisateur_id == utilisateur.id)
        else:
            try:
                conditions.append(Analysis.utilisateur_id == uuid.UUID(deposant))
            except ValueError as exc:
                raise ApiError(422, "filtre_invalide", "Déposant inconnu.") from exc
    if etat:
        if etat not in ETATS:
            raise ApiError(422, "filtre_invalide", f"État inconnu : {etat}.")
        conditions.append(_condition_etat(etat))
    if du:
        conditions.append(Analysis.created_at >= datetime.combine(du, time.min))
    if au:
        conditions.append(Analysis.created_at < datetime.combine(au + timedelta(days=1), time.min))
    if types:
        inconnus = set(types) - set(LABELS) | ({LABEL_DENT} & set(types))
        if inconnus:
            raise ApiError(422, "filtre_invalide", f"Type d'anomalie inconnu : {', '.join(sorted(inconnus))}.")
        # Anomalie de ce type, non rejetée par le praticien.
        conditions.append(exists().where(Detection.analysis_id == Analysis.id, Detection.label.in_(types),
                                         Detection.etat != EtatDetection.REJETEE))
    return conditions


def _requete(rang, conditions, tri: str):
    ordre = (Analysis.created_at.desc(), Analysis.id.desc()) if tri == "recent" else (Analysis.created_at, Analysis.id)
    return select(Analysis, rang.c.numero).join(rang, rang.c.id == Analysis.id).where(*conditions).order_by(*ordre)


# --- Curseur -------------------------------------------------------------------------------------

def _curseur(a: Analysis) -> str:
    return base64.urlsafe_b64encode(f"{a.created_at.isoformat()}|{a.id}".encode()).decode()


def _apres(curseur: str, tri: str):
    try:
        horodatage, ident = base64.urlsafe_b64decode(curseur.encode()).decode().split("|", 1)
        quand = datetime.fromisoformat(horodatage)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ApiError(422, "curseur_invalide", "Curseur de pagination invalide : rechargez la liste.") from exc
    if tri == "recent":
        return or_(Analysis.created_at < quand, and_(Analysis.created_at == quand, Analysis.id < ident))
    return or_(Analysis.created_at > quand, and_(Analysis.created_at == quand, Analysis.id > ident))


# --- Routes --------------------------------------------------------------------------------------

def _parametres(
    q: str = "",
    deposant: str = "",
    etat: str = "",
    du: date | None = None,
    au: date | None = None,
    types: list[str] = Query(default=[]),
    tri: str = "recent",
):
    if tri not in TRIS:
        raise ApiError(422, "filtre_invalide", f"Tri inconnu : {tri}.")
    return {"q": q, "deposant": deposant, "etat": etat, "du": du, "au": au, "types": types, "tri": tri}


@router.get("/historique")
def historique(
    p: dict = Depends(_parametres),
    limite: int = Query(default=10, ge=1, le=100),
    apres: str = "",
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)),
    db: Session = Depends(get_db),
):
    rang = _rang()
    conditions = _filtres(rang, utilisateur, p["q"], p["deposant"], p["etat"], p["du"], p["au"], p["types"])
    total = db.scalar(select(func.count()).select_from(Analysis).join(rang, rang.c.id == Analysis.id).where(*conditions))
    page_conditions = conditions + ([_apres(apres, p["tri"])] if apres else [])
    lignes = db.execute(_requete(rang, page_conditions, p["tri"]).limit(limite + 1)).unique().all()
    suite = len(lignes) > limite
    lignes = lignes[:limite]
    deposants = db.execute(
        select(Utilisateur).where(Utilisateur.id.in_(select(Analysis.utilisateur_id).distinct()))
    ).scalars().all()
    return {
        "elements": [resume_analyse(a, numero) for a, numero in lignes],
        "total": total,
        "suivant": _curseur(lignes[-1][0]) if suite and lignes else None,
        "deposants": sorted(({"id": str(u.id), "nom": _nom(u)} for u in deposants), key=lambda d: d["nom"].lower()),
    }


ETAT_LIBELLE = {"queued": "En file d'attente", "running": "Analyse en cours", "pending": "À relire",
                "inprogress": "Relecture en cours", "closed": "Clôturée", "failed": "Échec"}


def etat_affiche(a: Analysis) -> str:
    if a.statut == StatutAnalyse.EN_FILE:
        return "queued"
    if a.statut == StatutAnalyse.EN_COURS:
        return "running"
    if a.statut == StatutAnalyse.ECHOUEE:
        return "failed"
    if a.cloturee:
        return "closed"
    return "inprogress" if revue.avancement(a)["revues"] else "pending"


def _date(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if isinstance(dt, datetime) else (dt.isoformat() if dt else "")


@router.get("/historique.csv")
def historique_csv(
    request: Request,
    p: dict = Depends(_parametres),
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)),
    db: Session = Depends(get_db),
):
    """Toutes les analyses qui répondent aux filtres, en CSV (séparateur « ; »,
    UTF-8 avec BOM : s'ouvre tel quel dans un tableur réglé en français).
    Aucune donnée de patient : la référence anonyme seulement."""
    rang = _rang()
    conditions = _filtres(rang, utilisateur, p["q"], p["deposant"], p["etat"], p["du"], p["au"], p["types"])
    lignes = db.execute(_requete(rang, conditions, p["tri"])).unique().all()
    sortie = io.StringIO()
    ecrivain = csv.writer(sortie, delimiter=";", lineterminator="\r\n")
    ecrivain.writerow(["N°", "Référence", "Importée le (UTC)", "Date de l'examen", "État", "Déposée par",
                       "Anomalies retenues", "Détections du modèle", "Modèle", "Clôturée le (UTC)", "Clôturée par"])
    for a, numero in lignes:
        ecrivain.writerow([
            numero, a.reference, _date(a.created_at), _date(a.date_examen), ETAT_LIBELLE[etat_affiche(a)],
            _nom(a.deposant) or "", sum(1 for d in a.detections if d.label != LABEL_DENT and revue.au_compte_rendu(a, d)),
            sum(1 for d in a.detections if d.label != LABEL_DENT and d.source != "human"), a.model_version,
            _date(a.cloturee_le), _nom(a.cloturee_par) or "",
        ])
    journal.inscrire(db, "export_historique", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     details={"lignes": len(lignes), "filtres": {k: (v.isoformat() if isinstance(v, date) else v)
                                                                 for k, v in p.items() if v}})
    nom = f"historique-analyses-{date.today().isoformat()}.csv"
    return Response("﻿" + sortie.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{nom}"', "Cache-Control": "no-store"})


# --- Fiche d'historique d'une analyse ------------------------------------------------------------

LIBELLES = {
    "import_analyse": "Panoramique importée et anonymisée",
    "analyse_traitee": "Analyse par le modèle terminée",
    "analyse_echouee": "Analyse par le modèle échouée",
    "relance_analyse": "Analyse relancée",
    "rejeu_analyse": "Analyse rejouée avec un autre modèle",
    "dent_absente": "Dent déclarée absente",
    "dent_absente_retiree": "Déclaration d'absence retirée",
    "cloture_analyse": "Relecture clôturée",
    "reouverture_analyse": "Analyse rouverte",
    "compte_rendu_genere": "Compte rendu affiché",
    "compte_rendu_telecharge": "Compte rendu téléchargé",
}
VERDICTS = {"valider": "Détection validée", "corriger": "Détection corrigée", "rejeter": "Détection rejetée",
            "ajouter": "Détection ajoutée par le praticien"}
TYPES_FR = {"tooth": "dent", "caries": "carie", "deep_caries": "carie profonde",
            "periapical_lesion": "lésion péri-apicale", "impacted_tooth": "dent incluse"}


def _naif(dt: datetime) -> datetime:
    """Le journal est horodaté avec fuseau, les verdicts en UTC naïf : on compare en UTC naïf."""
    return dt.replace(tzinfo=None) - (dt.utcoffset() or timedelta()) if dt.tzinfo else dt


@router.get("/analyses/{analysis_id}/historique")
def fiche(analysis_id: str, _: Utilisateur = Depends(exiger(ANALYSIS_READ)), db: Session = Depends(get_db)):
    a = _ou_404(db, analysis_id)
    entrees = list(db.scalars(select(Journal).where(Journal.cible == f"analyse:{a.id}")))
    # Imports journalisés avant le sprint 8 sous « analyse:None » : retrouvés par leur référence.
    entrees += [e for e in db.scalars(select(Journal).where(Journal.cible == "analyse:None",
                                                           Journal.action == "import_analyse"))
                if (e.details or {}).get("reference") == a.reference]
    auteurs = {u.id: u for u in db.scalars(select(Utilisateur).where(
        Utilisateur.id.in_({e.utilisateur_id for e in entrees if e.utilisateur_id})))}
    evenements = []
    for e in entrees:
        d = e.details or {}
        precision = None
        if e.action == "analyse_traitee":
            precision = f"Modèle {d.get('modele', '?')} · {d.get('detections', 0)} détections · {d.get('duree_ms', 0) / 1000:.1f} s"
        elif e.action == "analyse_echouee":
            precision = d.get("erreur")
        elif e.action in ("dent_absente", "dent_absente_retiree"):
            precision = f"Dent {d.get('fdi', '?')}"
        elif e.action == "reouverture_analyse":
            precision = f"Motif : {d.get('motif', '')}".strip()
        elif e.action.startswith("compte_rendu_"):
            options = [nom for cle, nom in (("image", "image"), ("commentaires", "commentaires"), ("rejetees", "rejetées")) if d.get(cle)]
            precision = ("Brouillon · " if d.get("brouillon") else "") + ("avec " + ", ".join(options) if options else "sans option")
        evenements.append({"date": _naif(e.horodatage), "action": e.action,
                           "libelle": LIBELLES.get(e.action, e.action.replace("_", " ")),
                           "auteur": _nom(auteurs.get(e.utilisateur_id)), "precision": precision, "annule_le": None})
    for det in a.detections:
        for v in det.verdicts:
            quoi = f"{TYPES_FR.get(v.label, v.label)}{f', dent {v.fdi}' if v.fdi else ''}"
            evenements.append({"date": v.cree_le, "action": f"verdict_{v.action}",
                               "libelle": VERDICTS.get(v.action, v.action), "auteur": _nom(v.auteur),
                               "precision": quoi + (f" — « {v.commentaire} »" if v.commentaire else ""),
                               "annule_le": v.annule_le})
    evenements.sort(key=lambda x: x["date"])
    return {"reference": a.reference, "evenements": evenements}
