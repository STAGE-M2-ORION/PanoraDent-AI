"""Historique des analyses (sprint 8) : liste filtrée et paginée, export CSV,
fiche d'historique d'une analyse.

- `GET /historique` : recherche plein texte (référence, note, conclusion ; en
  français et sans accents sous PostgreSQL, index GIN) ou par n°, filtres
  combinés (état, déposant, période, type d'anomalie retenue, dent, compte
  rendu téléchargé ou non), tri sur une à trois colonnes, pagination PAR CLÉ :
  la page suivante part des valeurs de tri de la dernière ligne vue, et reste
  rapide quel que soit le nombre d'analyses.
- `GET`, `POST`, `DELETE /moi/vues-historique` : vues enregistrées, jeux de
  filtres nommés propres à leur auteur (sprint 12).
- `GET /historique.csv` : les mêmes filtres, toutes les lignes, pour un suivi
  d'activité ; l'export est journalisé.
- `GET /analyses/{id}/historique` : la fiche — import, traitement, verdicts,
  clôture, réouverture, comptes rendus produits — lue dans le JOURNAL et dans
  la table des verdicts (jamais modifiée), pas dans des champs recopiés.
"""
import base64
import csv
import io
import json
import uuid
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import Date, and_, case, exists, func, literal, literal_column, or_, select
from sqlalchemy.orm import Session, aliased

from .. import journal
from ..auth_deps import exiger, session_ouverte
from ..auth_models import Journal, Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import (
    LABEL_DENT, LABELS, Analysis, Detection, EtatDetection, StatutAnalyse, Verdict, VueHistorique,
)
from ..permissions import ANALYSIS_READ
from ..schemas import _nom
from ..services import attributions, revue
from .analyses import _ou_404, resume_analyse

router = APIRouter(tags=["historique"])

ETATS = ("queued", "running", "pending", "inprogress", "closed", "failed")
COMPTES_RENDUS = ("telecharge", "non_telecharge")
FDI_VALIDES = frozenset(q * 10 + n for q in (1, 2, 3, 4) for n in range(1, 9))

# Tri : une à trois colonnes, « -colonne » pour l'ordre décroissant. L'identifiant
# départage toujours les égalités : la pagination par clé ne saute ni ne répète rien.
EXAMEN_VIDE = date(1, 1, 1)   # analyses sans date d'examen : en tête en croissant
# État : dans l'ordre du traitement, et non dans l'ordre alphabétique des codes.
RANG_STATUT = {s: i for i, s in enumerate(StatutAnalyse.TOUS)}
CHAMPS_TRI = {
    "date": lambda: Analysis.created_at,
    "reference": lambda: Analysis.reference,
    "statut": lambda: case(RANG_STATUT, value=Analysis.statut, else_=len(RANG_STATUT)),
    "examen": lambda: func.coalesce(Analysis.date_examen, literal(EXAMEN_VIDE, Date)),
}
TRIS_ANCIENS = {"recent": "-date", "ancien": "date"}
TRI_MAX = 3


def cles_tri(tri: str) -> list[tuple[str, bool]]:
    """« -statut,date » → [("statut", True), ("date", False)] ; (nom, décroissant)."""
    tri = TRIS_ANCIENS.get(tri, tri or "-date")
    cles = []
    for morceau in tri.split(","):
        nom = morceau.strip().lstrip("-")
        if nom not in CHAMPS_TRI or any(n == nom for n, _ in cles):
            raise ApiError(422, "filtre_invalide", f"Tri inconnu : {tri}.")
        cles.append((nom, morceau.strip().startswith("-")))
    if len(cles) > TRI_MAX:
        raise ApiError(422, "filtre_invalide", f"Tri sur {TRI_MAX} colonnes au plus.")
    return cles


# Doit rester identique à l'index de la migration 0019 (sinon l'index ne sert pas).
FRANCAIS = literal_column("'french'::regconfig")


def _texte_indexe():
    vide, espace = literal_column("''"), literal_column("' '")
    return func.to_tsvector(FRANCAIS, func.f_unaccent(
        func.coalesce(Analysis.reference, vide).op("||")(espace).op("||")(func.coalesce(Analysis.note, vide))
        .op("||")(espace).op("||")(func.coalesce(Analysis.conclusion, vide))))


def _recherche(q: str, dialecte: str):
    """Référence (partielle), n° d'analyse, ou plein texte sur référence, note et conclusion."""
    motif = f"%{q.replace('%', '').replace('_', '')}%"
    if dialecte == "postgresql":
        texte = _texte_indexe().op("@@")(func.websearch_to_tsquery(FRANCAIS, func.f_unaccent(q)))
    else:   # SQLite (tests) : même champs, sans langue ni accents normalisés
        texte = or_(Analysis.note.ilike(motif), Analysis.conclusion.ilike(motif))
    return or_(Analysis.reference.ilike(motif), texte)


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


def _filtres(rang, utilisateur, p: dict, dialecte: str) -> list:
    q, deposant, etat, du, au, types = (p["q"], p["deposant"], p["etat"], p["du"], p["au"], p["types"])
    # Un lecteur ne voit que les analyses qui lui sont confiées : la première
    # condition, avant tout filtre choisi à l'écran.
    visibles = attributions.condition(utilisateur)
    conditions = [] if visibles is None else [visibles]
    q = (q or "").strip()
    if q:
        conditions.append(or_(_recherche(q, dialecte), rang.c.numero == int(q)) if q.isdigit()
                          else _recherche(q, dialecte))
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
    if p.get("dent"):
        # Anomalie non rejetée portant ce numéro : proposé, retenu par un verdict, ou celui de sa dent hôte.
        dent, hote = p["dent"], aliased(Detection)
        conditions.append(exists().where(
            Detection.analysis_id == Analysis.id, Detection.label != LABEL_DENT,
            Detection.etat != EtatDetection.REJETEE,
            or_(Detection.fdi == dent,
                exists().where(Verdict.detection_id == Detection.id, Verdict.annule_le.is_(None), Verdict.fdi == dent),
                exists().where(hote.id == Detection.dent_id, hote.fdi == dent))))
    if p.get("compte_rendu"):
        telecharge = exists().where(Journal.action == "compte_rendu_telecharge",
                                    Journal.cible == literal("analyse:") + Analysis.id)
        conditions.append(telecharge if p["compte_rendu"] == "telecharge" else ~telecharge)
    return conditions


def _requete(rang, conditions, cles: list[tuple[str, bool]]):
    ordre = [CHAMPS_TRI[n]().desc() if desc else CHAMPS_TRI[n]().asc() for n, desc in cles]
    ordre.append(Analysis.id.desc() if cles[0][1] else Analysis.id.asc())
    return select(Analysis, rang.c.numero).join(rang, rang.c.id == Analysis.id).where(*conditions).order_by(*ordre)


# --- Curseur -------------------------------------------------------------------------------------

def _valeur(a: Analysis, nom: str):
    return {"date": a.created_at, "reference": a.reference, "statut": RANG_STATUT.get(a.statut, len(RANG_STATUT)),
            "examen": a.date_examen or EXAMEN_VIDE}[nom]


def _curseur(a: Analysis, cles) -> str:
    valeurs = [v.isoformat() if isinstance(v, (date, datetime)) else v for v in (_valeur(a, n) for n, _ in cles)]
    return base64.urlsafe_b64encode(json.dumps({"v": valeurs, "id": a.id}).encode()).decode()


def _apres(curseur: str, cles):
    """Lignes strictement après le curseur, dans l'ordre du tri (comparaison lexicographique)."""
    try:
        donnees = json.loads(base64.urlsafe_b64decode(curseur.encode()).decode())
        valeurs = []
        for (nom, _), v in zip(cles, donnees["v"], strict=True):
            valeurs.append(datetime.fromisoformat(v) if nom == "date" else date.fromisoformat(v) if nom == "examen" else v)
        ident = str(donnees["id"])
    except (ValueError, KeyError, TypeError, UnicodeDecodeError) as exc:
        raise ApiError(422, "curseur_invalide", "Curseur de pagination invalide : rechargez la liste.") from exc
    colonnes = [(CHAMPS_TRI[n](), desc, v) for (n, desc), v in zip(cles, valeurs)]
    colonnes.append((Analysis.id, cles[0][1], ident))
    alternatives = []
    for i, (col, desc, v) in enumerate(colonnes):
        egales = [c == w for c, _, w in colonnes[:i]]
        alternatives.append(and_(*egales, col < v if desc else col > v))
    return or_(*alternatives)


# --- Routes --------------------------------------------------------------------------------------

def _parametres(
    q: str = Query(default="", max_length=120),
    deposant: str = "",
    etat: str = "",
    du: date | None = None,
    au: date | None = None,
    types: list[str] = Query(default=[]),
    dent: int | None = None,
    compte_rendu: str = "",
    tri: str = "recent",
):
    cles_tri(tri)
    if dent is not None and dent not in FDI_VALIDES:
        raise ApiError(422, "filtre_invalide", f"Numéro de dent inconnu : {dent}.")
    if compte_rendu and compte_rendu not in COMPTES_RENDUS:
        raise ApiError(422, "filtre_invalide", "Compte rendu : « telecharge » ou « non_telecharge ».")
    return {"q": q, "deposant": deposant, "etat": etat, "du": du, "au": au, "types": types, "dent": dent,
            "compte_rendu": compte_rendu, "tri": tri}


@router.get("/historique")
def historique(
    p: dict = Depends(_parametres),
    limite: int = Query(default=10, ge=1, le=100),
    apres: str = "",
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)),
    db: Session = Depends(get_db),
):
    rang, cles = _rang(), cles_tri(p["tri"])
    conditions = _filtres(rang, utilisateur, p, db.get_bind().dialect.name)
    total = db.scalar(select(func.count()).select_from(Analysis).join(rang, rang.c.id == Analysis.id).where(*conditions))
    page_conditions = conditions + ([_apres(apres, cles)] if apres else [])
    lignes = db.execute(_requete(rang, page_conditions, cles).limit(limite + 1)).unique().all()
    suite = len(lignes) > limite
    lignes = lignes[:limite]
    deposants = db.execute(
        select(Utilisateur).where(Utilisateur.id.in_(
            attributions.filtrer(select(Analysis.utilisateur_id).distinct(), utilisateur)))
    ).scalars().all()
    return {
        "elements": [resume_analyse(a, numero) for a, numero in lignes],
        "total": total,
        "suivant": _curseur(lignes[-1][0], cles) if suite and lignes else None,
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
    conditions = _filtres(rang, utilisateur, p, db.get_bind().dialect.name)
    lignes = db.execute(_requete(rang, conditions, cles_tri(p["tri"]))).unique().all()
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
    "attribution_analyse": "Lecteurs de l'analyse modifiés",
}
VERDICTS = {"valider": "Détection validée", "corriger": "Détection corrigée", "rejeter": "Détection rejetée",
            "ajouter": "Détection ajoutée par le praticien"}
TYPES_FR = {"tooth": "dent", "caries": "carie", "deep_caries": "carie profonde",
            "periapical_lesion": "lésion péri-apicale", "impacted_tooth": "dent incluse"}


def _naif(dt: datetime) -> datetime:
    """Le journal est horodaté avec fuseau, les verdicts en UTC naïf : on compare en UTC naïf."""
    return dt.replace(tzinfo=None) - (dt.utcoffset() or timedelta()) if dt.tzinfo else dt


@router.get("/analyses/{analysis_id}/historique")
def fiche(analysis_id: str, utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)), db: Session = Depends(get_db)):
    a = _ou_404(db, analysis_id, utilisateur)
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


# --- Vues enregistrées (sprint 12) ---------------------------------------------------------------
# Réglage personnel, comme les préférences : ouvert à toute session. Une vue ne
# donne accès à rien — l'historique revérifie les droits à chaque lecture.

VUES_MAX = 20
CLES_FILTRES = {"q", "deposant", "etat", "du", "au", "types", "dent", "compte_rendu", "tri", "periode"}
# Période relative : recalculée à chaque usage de la vue, jamais figée en dates.
PERIODES = ("today", "7", "30")


class VueIn(BaseModel):
    nom: str = Field(min_length=1, max_length=80)
    filtres: dict


def _filtres_valides(filtres: dict) -> dict:
    """Filtres d'une vue : les seules clés connues, des valeurs que l'historique accepterait."""
    inconnues = set(filtres) - CLES_FILTRES
    if inconnues:
        raise ApiError(422, "filtre_invalide", f"Filtre inconnu : {', '.join(sorted(inconnues))}.")
    try:
        f = {k: v for k, v in filtres.items() if v not in (None, "", [])}
        _parametres(q=str(f.get("q", ""))[:120], deposant=str(f.get("deposant", "")), etat=str(f.get("etat", "")),
                    du=date.fromisoformat(f["du"]) if f.get("du") else None,
                    au=date.fromisoformat(f["au"]) if f.get("au") else None,
                    types=[str(t) for t in f.get("types", [])], dent=int(f["dent"]) if f.get("dent") else None,
                    compte_rendu=str(f.get("compte_rendu", "")), tri=str(f.get("tri", "recent")))
        if f.get("periode") and f["periode"] not in PERIODES:
            raise ApiError(422, "filtre_invalide", f"Période inconnue : {f['periode']}.")
        if f.get("etat") and f["etat"] not in ETATS:
            raise ApiError(422, "filtre_invalide", f"État inconnu : {f['etat']}.")
        inconnus = set(f.get("types", [])) - set(LABELS) | ({LABEL_DENT} & set(f.get("types", [])))
        if inconnus:
            raise ApiError(422, "filtre_invalide", f"Type d'anomalie inconnu : {', '.join(sorted(inconnus))}.")
    except (ValueError, TypeError) as exc:
        raise ApiError(422, "filtre_invalide", "Filtres de la vue invalides.") from exc
    return f


def vue_out(v: VueHistorique) -> dict:
    return {"id": v.id, "nom": v.nom, "filtres": v.filtres, "cree_le": v.cree_le}


@router.get("/moi/vues-historique")
def lister_vues(utilisateur: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    vues = db.scalars(select(VueHistorique).where(VueHistorique.utilisateur_id == utilisateur.id)
                      .order_by(VueHistorique.nom)).all()
    return [vue_out(v) for v in vues]


@router.post("/moi/vues-historique", status_code=201)
def enregistrer_vue(corps: VueIn, utilisateur: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    nom = " ".join(corps.nom.split())
    if not nom:
        raise ApiError(422, "nom_requis", "Donnez un nom à la vue.")
    filtres = _filtres_valides(corps.filtres)
    existante = db.scalar(select(VueHistorique).where(VueHistorique.utilisateur_id == utilisateur.id,
                                                      VueHistorique.nom == nom))
    if existante is not None:   # même nom : la vue est mise à jour
        existante.filtres = filtres
        db.commit()
        return vue_out(existante)
    nombre = db.scalar(select(func.count(VueHistorique.id)).where(VueHistorique.utilisateur_id == utilisateur.id))
    if nombre >= VUES_MAX:
        raise ApiError(409, "trop_de_vues", f"{VUES_MAX} vues enregistrées au plus : supprimez-en une.")
    v = VueHistorique(utilisateur_id=utilisateur.id, nom=nom, filtres=filtres)
    db.add(v)
    db.commit()
    return vue_out(v)


@router.delete("/moi/vues-historique/{vue_id}", status_code=204)
def supprimer_vue(vue_id: str, utilisateur: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    v = db.get(VueHistorique, vue_id)
    if v is None or v.utilisateur_id != utilisateur.id:   # la vue d'un autre n'existe pas pour vous
        raise ApiError(404, "introuvable", "Vue introuvable.")
    db.delete(v)
    db.commit()
    return Response(status_code=204)
