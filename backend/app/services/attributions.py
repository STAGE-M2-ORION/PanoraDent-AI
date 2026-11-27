"""Analyses confiées à un lecteur : qui voit quoi.

Règle unique, appliquée par toutes les routes qui lisent une analyse :

- un compte qui a `analysis:read_all` (administrateur, praticien) voit toutes
  les analyses du cabinet ;
- un compte qui ne l'a pas (le lecteur) ne voit que celles qui lui sont
  confiées. Une autre lui répond « introuvable » (404), jamais « interdit » :
  il n'apprend pas qu'elle existe.

Confier ou retirer une analyse : son déposant, ou un administrateur ; avant
comme après la clôture (cela ne touche pas au résultat). Chaque changement est
journalisé.
"""
import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Utilisateur
from ..errors import ApiError
from ..models import Analysis, Attribution
from ..permissions import ADMIN_CAPABILITIES, ANALYSIS_READ, ANALYSIS_READ_ALL

MAX_LECTEURS = 20


def voit_tout(u: Utilisateur) -> bool:
    return u.a_permission(ANALYSIS_READ_ALL)


def condition(u: Utilisateur):
    """Condition SQL des analyses visibles par `u` ; None : toutes."""
    if voit_tout(u):
        return None
    return Analysis.id.in_(select(Attribution.analysis_id).where(Attribution.lecteur_id == u.id))


def filtrer(q, u: Utilisateur):
    c = condition(u)
    return q if c is None else q.where(c)


def visible(db: Session, u: Utilisateur, a: Analysis) -> bool:
    if voit_tout(u):
        return True
    return db.scalar(select(Attribution.id).where(Attribution.analysis_id == a.id,
                                                  Attribution.lecteur_id == u.id)) is not None


def analyse_visible(db: Session, u: Utilisateur, analysis_id: str, *, verrou: bool = False) -> Analysis:
    """L'analyse si `u` peut la voir ; sinon 404, qu'elle existe ou non."""
    q = select(Analysis).where(Analysis.id == analysis_id)
    if verrou:  # deux praticiens sur la même analyse : écritures sérialisées
        q = q.with_for_update(of=Analysis)
    a = db.execute(q).unique().scalar_one_or_none()
    if a is None or not visible(db, u, a):
        raise ApiError(404, "introuvable", "Analyse introuvable.")
    return a


def est_lecteur(u: Utilisateur) -> bool:
    """Compte à qui l'on peut confier une analyse : il lit, sans tout voir."""
    return bool(u.actif) and u.a_permission(ANALYSIS_READ) and not voit_tout(u)


def lecteurs_attribuables(db: Session) -> list[Utilisateur]:
    comptes = db.scalars(select(Utilisateur).where(Utilisateur.actif.is_(True))).unique().all()
    return sorted((u for u in comptes if est_lecteur(u)),
                  key=lambda u: (f"{u.nom or ''} {u.prenom or ''}".strip() or u.email).lower())


def peut_attribuer(u: Utilisateur, a: Analysis) -> bool:
    return a.utilisateur_id == u.id or ADMIN_CAPABILITIES <= set(u.permission_codes)


def valider(db: Session, ids: list) -> list[Utilisateur]:
    """Comptes désignés, tous lecteurs actifs ; sinon 422 (rien n'est écrit)."""
    try:
        uids = list(dict.fromkeys(uuid.UUID(str(i)) for i in ids))
    except ValueError as exc:
        raise ApiError(422, "lecteur_invalide", "Lecteur inconnu.") from exc
    if len(uids) > MAX_LECTEURS:
        raise ApiError(422, "lecteur_invalide", f"Au plus {MAX_LECTEURS} lecteurs par analyse.")
    comptes = {u.id: u for u in db.scalars(select(Utilisateur).where(Utilisateur.id.in_(uids))).unique()} if uids else {}
    for i in uids:
        u = comptes.get(i)
        if u is None or not est_lecteur(u):
            raise ApiError(422, "lecteur_invalide",
                           "Une analyse ne se confie qu'à un compte actif de lecteur (qui ne voit pas déjà tout).")
    return [comptes[i] for i in uids]


def nom(u: Utilisateur) -> str:
    return f"{u.prenom or ''} {u.nom or ''}".strip() or u.email


def definir(db: Session, a: Analysis, lecteurs: list[Utilisateur], auteur: Utilisateur,
            request: Request | None = None) -> tuple[list[Utilisateur], list[Utilisateur]]:
    """Remplace les lecteurs de `a` par `lecteurs` ; renvoie (ajoutés, retirés).
    Ne valide pas la transaction : l'appelant le fait."""
    actuels = {at.lecteur_id: at for at in a.attributions}
    voulus = {u.id: u for u in lecteurs}
    ajoutes = [u for i, u in voulus.items() if i not in actuels]
    retires = [at.lecteur for i, at in actuels.items() if i not in voulus]
    for at in [at for i, at in actuels.items() if i not in voulus]:
        a.attributions.remove(at)
    for u in ajoutes:
        a.attributions.append(Attribution(lecteur_id=u.id, attribue_par_id=auteur.id))
    if ajoutes or retires:
        journal.inscrire(
            db, "attribution_analyse", journal.SUCCES, request=request, utilisateur_id=auteur.id,
            cible=f"analyse:{a.id}",
            details={"reference": a.reference, "ajoutes": [nom(u) for u in ajoutes],
                     "retires": [nom(u) for u in retires]},
            commit=False,
        )
    return ajoutes, retires
