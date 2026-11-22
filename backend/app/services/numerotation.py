"""Numérotation d'une analyse, côté serveur (sprint 7) : incohérences et dents absentes.

Les incohérences sont recalculées ici à partir des valeurs RETENUES (après
les corrections du praticien), et non reprises telles quelles du service
d'inférence : corriger un doublon doit faire disparaître le signalement.
Elles sont signalées, jamais corrigées d'office.

- **doublon** : deux dents (non rejetées) portent le même numéro ;
- **ordre** : dans un quadrant, une dent plus éloignée de la ligne médiane
  porte un rang plus petit qu'une dent plus proche ;
- **quadrant_surcharge** : plus de huit dents dans un quadrant ;
- **absente_detectee** : une dent déclarée absente porte une détection.
"""
from datetime import datetime
from statistics import mean

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import LABEL_DENT, Analysis, DentAbsente, EtatDetection
from .revue import FDI_VALIDES, verifier_modifiable


def dents_presentes(a: Analysis) -> list:
    """Détections de dents non rejetées, avec leurs valeurs retenues."""
    return [(d, d.retenu()) for d in a.detections
            if d.label == LABEL_DENT and d.etat != EtatDetection.REJETEE]


def _mediane(dents) -> float:
    """Centre des incisives (rangs 1 et 2) ; à défaut, le milieu de l'image."""
    centres = [v["x"] + v["w"] / 2 for _, v in dents if v["fdi"] and v["fdi"] % 10 in (1, 2)]
    return mean(centres) if len(centres) >= 2 else 0.5


def incoherences(a: Analysis) -> tuple[list[dict], set[str]]:
    """Signalements et identifiants des dents douteuses."""
    dents = [(d, v) for d, v in dents_presentes(a) if v["fdi"] in FDI_VALIDES]
    signales, douteuses = [], set()

    par_fdi: dict[int, list] = {}
    for d, v in dents:
        par_fdi.setdefault(v["fdi"], []).append(d)
    for fdi, ds in sorted(par_fdi.items()):
        if len(ds) > 1:
            douteuses |= {d.id for d in ds}
            signales.append({"type": "doublon", "fdi": [fdi], "nombre": len(ds),
                             "message": f"{len(ds)} dents portent le numéro {fdi}."})

    x_mid = _mediane(dents)
    for quadrant in (1, 2, 3, 4):
        du_quadrant = sorted(((abs(v["x"] + v["w"] / 2 - x_mid), d, v) for d, v in dents
                              if v["fdi"] // 10 == quadrant), key=lambda t: t[0])
        if len(du_quadrant) > 8:
            douteuses |= {d.id for _, d, _ in du_quadrant}
            signales.append({"type": "quadrant_surcharge", "fdi": [], "quadrant": quadrant,
                             "nombre": len(du_quadrant),
                             "message": f"{len(du_quadrant)} dents dans le quadrant {quadrant} (8 au plus)."})
        for (_, d1, v1), (_, d2, v2) in zip(du_quadrant, du_quadrant[1:]):
            if v2["fdi"] % 10 < v1["fdi"] % 10:
                douteuses |= {d1.id, d2.id}
                signales.append({"type": "ordre", "fdi": [v1["fdi"], v2["fdi"]],
                                 "message": f"La {v2['fdi']} est plus loin de la médiane que la {v1['fdi']} : "
                                            "numéros à vérifier."})

    detectees = set(par_fdi)
    for absente in a.dents_absentes:
        if absente.fdi in detectees:
            douteuses |= {d.id for d in par_fdi[absente.fdi]}
            signales.append({"type": "absente_detectee", "fdi": [absente.fdi],
                             "message": f"La {absente.fdi} est déclarée absente mais une dent porte ce numéro."})
    return signales, douteuses


def declarer_absente(db: Session, a: Analysis, fdi: int, auteur_id) -> DentAbsente:
    verifier_modifiable(a)
    if fdi not in FDI_VALIDES:
        raise ApiError(422, "dent_invalide", "Numéro de dent invalide (notation FDI, 11 à 48).")
    if any(v["fdi"] == fdi for _, v in dents_presentes(a)):
        raise ApiError(409, "dent_detectee",
                       f"Une dent porte le numéro {fdi} sur ce cliché : rejetez cette détection, ou corrigez "
                       "son numéro, avant de déclarer la dent absente.")
    existante = next((x for x in a.dents_absentes if x.fdi == fdi), None)
    if existante is not None:
        return existante
    absente = DentAbsente(analysis=a, fdi=fdi, auteur_id=auteur_id, cree_le=datetime.utcnow())
    db.add(absente)
    db.flush()
    return absente


def retirer_absente(db: Session, a: Analysis, fdi: int) -> bool:
    verifier_modifiable(a)
    existante = next((x for x in a.dents_absentes if x.fdi == fdi), None)
    if existante is None:
        return False
    a.dents_absentes.remove(existante)
    db.flush()
    return True
