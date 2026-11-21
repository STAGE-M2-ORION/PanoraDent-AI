"""Relecture d'une analyse par le praticien : verdicts, ajouts, clôture.

Règles tenues ICI, dans le service, et non dans l'interface :

- une analyse clôturée est en lecture seule : toute écriture commence par
  `verifier_modifiable()` (un test parcourt les routes d'écriture et échoue
  si l'une d'elles l'oublie) ;
- une proposition du modèle n'est jamais écrasée : chaque verdict est une
  ligne qui porte les valeurs retenues ; la détection garde les siennes ;
- la clôture exige un verdict sur chaque détection d'anomalie (les cadres de
  numérotation des dents servent de repère et n'en demandent pas).
"""
from datetime import datetime

from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import (
    ETAT_DE_L_ACTION, LABEL_DENT, LABELS, ActionVerdict, Analysis, Detection, EtatDetection,
    StatutAnalyse, Verdict,
)

COMMENTAIRE_MAX = 1000
CONCLUSION_MAX = 4000
MOTIF_MIN = 5
TAILLE_MIN = 0.002   # côté minimal d'un cadre, en fraction de l'image
_TOLERANCE = 1e-6

# Numéros FDI des dents permanentes (11-18, 21-28, 31-38, 41-48).
FDI_VALIDES = frozenset(q * 10 + n for q in (1, 2, 3, 4) for n in range(1, 9))


def verifier_modifiable(a: Analysis) -> None:
    """Garde de toute écriture sur la relecture d'une analyse."""
    if a.cloturee:
        raise ApiError(
            409, "analyse_cloturee",
            "Cette analyse est clôturée : elle est en lecture seule. Seul un administrateur peut la rouvrir.",
        )
    if a.statut != StatutAnalyse.TERMINEE:
        raise ApiError(409, "analyse_non_terminee", "L'analyse n'est pas terminée : rien à relire pour l'instant.")


def a_revoir(a: Analysis) -> list[Detection]:
    return [d for d in a.detections if d.label != LABEL_DENT and d.etat == EtatDetection.A_REVOIR]


def avancement(a: Analysis) -> dict:
    anomalies = [d for d in a.detections if d.label != LABEL_DENT]
    return {"revues": sum(d.etat != EtatDetection.A_REVOIR for d in anomalies), "total": len(anomalies)}


# --- Contrôle des valeurs -------------------------------------------------------------------------

def _label(valeur: str) -> str:
    if valeur not in LABELS:
        raise ApiError(422, "type_invalide", "Type de détection inconnu.")
    return valeur


def _fdi(valeur: int | None) -> int | None:
    if valeur is not None and valeur not in FDI_VALIDES:
        raise ApiError(422, "dent_invalide", "Numéro de dent invalide (notation FDI, 11 à 48).")
    return valeur


def _cadre(x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    """Cadre en fractions de l'image, borné à [0, 1] (l'interface borne avant envoi)."""
    if min(x, y) < -_TOLERANCE or x + w > 1 + _TOLERANCE or y + h > 1 + _TOLERANCE:
        raise ApiError(422, "cadre_hors_image", "Le cadre déborde de l'image.")
    if w < TAILLE_MIN or h < TAILLE_MIN:
        raise ApiError(422, "cadre_trop_petit", "Le cadre est trop petit.")
    x, y = max(0.0, x), max(0.0, y)
    return round(x, 6), round(y, 6), round(min(w, 1 - x), 6), round(min(h, 1 - y), 6)


def _commentaire(texte: str | None) -> str:
    texte = (texte or "").strip()
    if len(texte) > COMMENTAIRE_MAX:
        raise ApiError(422, "commentaire_trop_long", f"Commentaire limité à {COMMENTAIRE_MAX} caractères.")
    return texte


# --- Verdicts --------------------------------------------------------------------------------------

def _poser(d: Detection, action: str, valeurs: dict, commentaire: str, auteur_id) -> Verdict:
    maintenant = datetime.utcnow()
    v = Verdict(
        detection=d, numero=len(d.verdicts) + 1, action=action, commentaire=commentaire,
        auteur_id=auteur_id, cree_le=maintenant, **valeurs,
    )
    d.etat, d.revu_par_id, d.revu_le = ETAT_DE_L_ACTION[action], auteur_id, maintenant
    return v


def statuer(db: Session, a: Analysis, d: Detection, action: str, *, auteur_id, commentaire=None,
            label=None, fdi=None, cadre=None, fdi_fourni=False) -> Detection:
    """Valider, corriger ou rejeter une détection."""
    verifier_modifiable(a)
    if action not in (ActionVerdict.VALIDER, ActionVerdict.CORRIGER, ActionVerdict.REJETER):
        raise ApiError(422, "action_invalide", "Verdict attendu : valider, corriger ou rejeter.")
    valeurs = d.retenu()
    if action == ActionVerdict.CORRIGER:
        nouvelles = dict(valeurs)
        if label is not None:
            nouvelles["label"] = _label(label)
        if fdi_fourni:
            nouvelles["fdi"] = _fdi(fdi)
        if cadre is not None:
            nouvelles.update(zip(("x", "y", "w", "h"), _cadre(*cadre)))
        if nouvelles == valeurs:
            raise ApiError(422, "correction_vide", "La correction ne change ni le type, ni la dent, ni le cadre.")
        valeurs = nouvelles
    db.add(_poser(d, action, valeurs, _commentaire(commentaire), auteur_id))
    db.flush()
    return d


def ajouter(db: Session, a: Analysis, *, auteur_id, label, fdi, cadre, commentaire=None) -> Detection:
    """Détection tracée par le praticien : origine « praticien », née validée."""
    verifier_modifiable(a)
    x, y, w, h = _cadre(*cadre)
    d = Detection(
        analysis=a, label=_label(label), fdi=_fdi(fdi), confidence=None,
        x=x, y=y, w=w, h=h, source="human", model_version="",
    )
    db.add(d)
    db.add(_poser(d, ActionVerdict.AJOUTER, {"label": d.label, "fdi": d.fdi, "x": x, "y": y, "w": w, "h": h},
                  _commentaire(commentaire), auteur_id))
    db.flush()
    return d


def annuler(db: Session, a: Analysis, d: Detection, *, auteur_id) -> Detection | None:
    """Annule le dernier verdict actif de la détection. Annuler l'ajout d'une
    détection tracée par le praticien la retire ; renvoie alors None."""
    verifier_modifiable(a)
    v = d.verdict_courant
    if v is None:
        raise ApiError(409, "rien_a_annuler", "Aucun verdict à annuler sur cette détection.")
    maintenant = datetime.utcnow()
    v.annule_le, v.annule_par_id = maintenant, auteur_id
    if v.action == ActionVerdict.AJOUTER:
        db.delete(d)
        db.flush()
        return None
    precedent = d.verdict_courant
    if precedent is None:
        d.etat, d.revu_par_id, d.revu_le = EtatDetection.A_REVOIR, None, None
    else:
        d.etat = ETAT_DE_L_ACTION[precedent.action]
        d.revu_par_id, d.revu_le = precedent.auteur_id, precedent.cree_le
    db.flush()
    return d


# --- Conclusion, clôture, réouverture ---------------------------------------------------------------

def _texte_conclusion(texte: str | None) -> str:
    texte = (texte or "").strip()
    if len(texte) > CONCLUSION_MAX:
        raise ApiError(422, "conclusion_trop_longue", f"Conclusion limitée à {CONCLUSION_MAX} caractères.")
    return texte


def enregistrer_conclusion(a: Analysis, texte: str | None) -> None:
    verifier_modifiable(a)
    a.conclusion = _texte_conclusion(texte)


def cloturer(a: Analysis, *, auteur_id, conclusion: str | None = None) -> None:
    verifier_modifiable(a)
    restantes = len(a_revoir(a))
    if restantes:
        raise ApiError(
            409, "detections_a_revoir",
            f"{restantes} détection{'s' if restantes > 1 else ''} sans verdict : "
            f"validez, corrigez ou rejetez-{'les' if restantes > 1 else 'la'} avant de clôturer.",
            details={"a_revoir": restantes},
        )
    if conclusion is not None:
        a.conclusion = _texte_conclusion(conclusion)
    a.cloturee_le, a.cloturee_par_id = datetime.utcnow(), auteur_id


def rouvrir(a: Analysis, motif: str | None) -> str:
    if not a.cloturee:
        raise ApiError(409, "analyse_non_cloturee", "Cette analyse n'est pas clôturée.")
    motif = (motif or "").strip()
    if len(motif) < MOTIF_MIN:
        raise ApiError(422, "motif_requis", "Indiquez le motif de la réouverture (5 caractères au moins).")
    a.cloturee_le, a.cloturee_par_id = None, None
    return motif
