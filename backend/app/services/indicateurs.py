"""Indicateurs agrégés du tableau de bord d'administration (sprint 11).

Des comptes, jamais des personnes : aucun nom, aucune image, aucun patient.
Tout est compté à la lecture, sur les tables et le journal ; rien n'est
recopié ni estimé.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Journal, Role, Utilisateur
from ..models import Analysis, StatutAnalyse


def _debut_du_mois(d: datetime, decalage: int = 0) -> datetime:
    mois = d.year * 12 + d.month - 1 + decalage
    return d.replace(year=mois // 12, month=mois % 12 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _connexions(db: Session, depuis: datetime, jusqu_a: datetime) -> tuple[int, int]:
    """(réussies, refusées) entre deux dates."""
    lignes = db.execute(
        select(Journal.resultat, func.count()).where(
            Journal.action == "connexion", Journal.horodatage >= depuis, Journal.horodatage < jusqu_a)
        .group_by(Journal.resultat)).all()
    par = dict(lignes)
    reussies = par.get(journal.SUCCES, 0)
    return reussies, sum(n for r, n in par.items() if r != journal.SUCCES)


def indicateurs(db: Session) -> dict:
    maintenant = datetime.now(timezone.utc)
    naif = maintenant.replace(tzinfo=None)

    comptes = db.scalars(select(Utilisateur)).all()
    roles = {r.id: r.libelle for r in db.scalars(select(Role))}
    par_role: dict[str, dict] = {}
    for u in comptes:
        r = par_role.setdefault(roles.get(u.role_id, "?"), {"role": roles.get(u.role_id, "?"), "total": 0, "actifs": 0})
        r["total"] += 1
        r["actifs"] += int(u.actif)

    mois, mois_precedent = _debut_du_mois(naif), _debut_du_mois(naif, -1)
    analyses_mois = db.scalar(select(func.count(Analysis.id)).where(Analysis.created_at >= mois)) or 0
    analyses_mois_precedent = db.scalar(select(func.count(Analysis.id)).where(
        Analysis.created_at >= mois_precedent, Analysis.created_at < mois)) or 0
    en_attente = db.scalar(select(func.count(Analysis.id)).where(
        Analysis.statut.in_((StatutAnalyse.EN_FILE, StatutAnalyse.EN_COURS)))) or 0

    semaine = maintenant - timedelta(days=7)
    reussies, refusees = _connexions(db, semaine, maintenant + timedelta(seconds=1))
    reussies_avant, refusees_avant = _connexions(db, semaine - timedelta(days=7), semaine)

    # Nouveaux comptes, 12 derniers mois (le mois en cours compris).
    debuts = [_debut_du_mois(naif, -i) for i in range(11, -1, -1)]
    nouveaux = {d.strftime("%Y-%m"): 0 for d in debuts}
    for u in comptes:
        cle = u.cree_le.astimezone(timezone.utc).strftime("%Y-%m") if u.cree_le else None
        if cle in nouveaux:
            nouveaux[cle] += 1

    return {
        "comptes": {
            "total": len(comptes),
            "actifs": sum(u.actif for u in comptes),
            "desactives": sum(not u.actif for u in comptes),
            "jamais_connectes": sum(u.actif and u.derniere_connexion is None for u in comptes),
            "par_role": sorted(par_role.values(), key=lambda r: (-r["total"], r["role"])),
        },
        "analyses": {"ce_mois": analyses_mois, "mois_precedent": analyses_mois_precedent, "en_attente": en_attente},
        "connexions": {
            "semaine": reussies, "semaine_precedente": reussies_avant,
            "echecs_semaine": refusees, "echecs_semaine_precedente": refusees_avant,
        },
        "nouveaux_comptes_par_mois": [{"mois": m, "comptes": n} for m, n in nouveaux.items()],
    }
