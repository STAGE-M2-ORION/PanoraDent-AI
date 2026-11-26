"""Indicateurs d'activité du tableau de bord (sprint 12) : praticien et lecteur.

Portée « moi » (le praticien : ses analyses déposées, ses clôtures) ou
« cabinet » (le lecteur : toutes les analyses). Tout est compté à la lecture,
sur les analyses, les détections et le journal ; rien n'est estimé. Aucun
patient, aucune image : des nombres.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth_models import Journal
from ..models import LABEL_DENT, Analysis, EtatDetection, StatutAnalyse
from . import revue

SEMAINES = 12


def _debut_semaine(d: datetime) -> datetime:
    """Lundi 0 h de la semaine de `d`."""
    return (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def indicateurs(db: Session, utilisateur_id, portee: str) -> dict:
    maintenant = datetime.utcnow()
    mois = maintenant.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    mois_precedent = (mois - timedelta(days=1)).replace(day=1)
    an = maintenant - timedelta(days=365)
    semaines = [_debut_semaine(maintenant) - timedelta(weeks=i) for i in range(SEMAINES - 1, -1, -1)]

    q = select(Analysis).options(selectinload(Analysis.detections))
    if portee == "moi":
        q = q.where(Analysis.utilisateur_id == utilisateur_id)
    analyses = db.scalars(q).unique().all()

    en_cours = sum(a.statut in (StatutAnalyse.EN_FILE, StatutAnalyse.EN_COURS) for a in analyses)
    a_relire = sum(a.statut == StatutAnalyse.TERMINEE and not a.cloturee for a in analyses)
    cloturees = sum(a.cloturee for a in analyses)
    echouees = sum(a.statut == StatutAnalyse.ECHOUEE for a in analyses)
    ce_mois = sum(a.created_at >= mois for a in analyses)
    mois_prec = sum(mois_precedent <= a.created_at < mois for a in analyses)

    # Détections proposées au praticien sur 12 mois, et celles qui ont reçu un verdict.
    proposees = relues = 0
    types: Counter = Counter()
    for a in analyses:
        if a.created_at < an or a.statut != StatutAnalyse.TERMINEE:
            continue
        for d in a.detections:
            if d.label == LABEL_DENT:
                continue
            # Comme `revue.avancement` : une anomalie sous le seuil compte dès qu'elle a un verdict.
            if revue.proposee(a, d) or d.etat != EtatDetection.A_REVOIR:
                proposees += 1
                relues += d.etat != EtatDetection.A_REVOIR
            if revue.au_compte_rendu(a, d):
                types[d.retenu()["label"]] += 1

    # Délai entre la fin du traitement et la clôture, sur 30 jours.
    depuis = maintenant - timedelta(days=30)
    delais = [(a.cloturee_le - a.termine_le).total_seconds() for a in analyses
              if a.cloturee_le and a.termine_le and a.cloturee_le >= depuis and a.cloturee_le >= a.termine_le]

    # Par semaine : clôtures (du praticien, ou du cabinet) et comptes rendus téléchargés.
    def semaine(d: datetime) -> int | None:
        for i in range(SEMAINES - 1, -1, -1):
            if d >= semaines[i]:
                return i
        return None

    clotures = [0] * SEMAINES
    for a in analyses:
        if a.cloturee_le and (portee != "moi" or a.cloturee_par_id == utilisateur_id):
            i = semaine(a.cloturee_le)
            if i is not None:
                clotures[i] += 1
    # Comptes rendus téléchargés : 12 semaines couvrent les deux périodes de 30 jours.
    cibles = {f"analyse:{a.id}" for a in analyses}
    telechargements = db.execute(
        select(Journal.horodatage, Journal.cible).where(
            Journal.action == "compte_rendu_telecharge",
            Journal.horodatage >= semaines[0].replace(tzinfo=timezone.utc))).all()
    comptes_rendus = [0] * SEMAINES
    recents = precedents = 0
    for quand, cible in telechargements:
        if cible not in cibles:
            continue
        naif = quand.astimezone(timezone.utc).replace(tzinfo=None) if quand.tzinfo else quand
        i = semaine(naif)
        if i is not None:
            comptes_rendus[i] += 1
        if naif >= depuis:
            recents += 1
        elif naif >= depuis - timedelta(days=30):
            precedents += 1

    return {
        "portee": portee,
        "analyses": {"ce_mois": ce_mois, "mois_precedent": mois_prec, "en_cours": en_cours, "a_relire": a_relire,
                     "cloturees": cloturees, "echouees": echouees},
        "detections": {"proposees": proposees, "relues": relues},
        "types": dict(types),
        "delai_moyen_cloture_s": round(sum(delais) / len(delais)) if delais else None,
        "comptes_rendus": {"trente_jours": recents, "trente_jours_precedents": precedents},
        "semaines": [{"debut": s.date().isoformat(), "clotures": c, "comptes_rendus": r}
                     for s, c, r in zip(semaines, clotures, comptes_rendus)],
    }
