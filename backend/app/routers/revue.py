"""Relecture d'une analyse par le praticien (sprint 5).

- `POST /analyses/{id}/detections/{det}/verdict` : valider, corriger, rejeter ;
- `POST /analyses/{id}/detections/{det}/annuler` : annule le dernier verdict ;
- `POST /analyses/{id}/detections` : ajout d'une détection tracée sur l'image ;
- `PUT  /analyses/{id}/conclusion` : conclusion libre (brouillon) ;
- `POST /analyses/{id}/cloturer` : refusée tant qu'une détection reste à revoir ;
- `POST /analyses/{id}/rouvrir` : administrateur seulement, motif journalisé.

Tout praticien portant `detection:review` relit n'importe quelle analyse du
cabinet ; chaque verdict garde son auteur. Les règles (verrouillage après
clôture, proposition jamais écrasée) sont dans `services/revue.py`.
"""
from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Analysis, Detection, TypeNotification
from ..permissions import ANALYSIS_REOPEN, DETECTION_REVIEW
from ..schemas import AnalysisOut, DetectionOut, analyse_out, detection_out
from ..services import notifications, numerotation, revue

router = APIRouter(prefix="/analyses", tags=["relecture"])


class CadreIn(BaseModel):
    """Fractions de la largeur et de la hauteur de l'image."""
    x: float
    y: float
    w: float
    h: float

    def tuple(self) -> tuple[float, float, float, float]:
        return self.x, self.y, self.w, self.h


class VerdictIn(BaseModel):
    action: str = Field(description="valider | corriger | rejeter")
    commentaire: str | None = None
    # Correction : au moins un des trois.
    label: str | None = None
    fdi: int | None = None
    cadre: CadreIn | None = None


class AjoutIn(BaseModel):
    label: str
    fdi: int | None = None
    cadre: CadreIn
    commentaire: str | None = None


class ConclusionIn(BaseModel):
    conclusion: str = ""


class ClotureIn(BaseModel):
    conclusion: str | None = None


class ReouvertureIn(BaseModel):
    motif: str = ""


class AnnulationOut(BaseModel):
    """`detection` : état après annulation ; None si l'ajout annulé l'a retirée."""
    detection: DetectionOut | None
    retiree_id: str | None = None


def _analyse(db: Session, analysis_id: str, *, verrou: bool = False) -> Analysis:
    q = db.query(Analysis).filter(Analysis.id == analysis_id)
    if verrou:  # deux praticiens sur la même analyse : écritures sérialisées
        q = q.with_for_update(of=Analysis)
    a = q.one_or_none()
    if a is None:
        raise ApiError(404, "introuvable", "Analyse introuvable.")
    return a


def _detection(a: Analysis, detection_id: str) -> Detection:
    d = next((d for d in a.detections if d.id == detection_id), None)
    if d is None:
        raise ApiError(404, "introuvable", "Détection introuvable dans cette analyse.")
    return d


@router.post("/{analysis_id}/detections/{detection_id}/verdict", response_model=DetectionOut)
def poser_verdict(
    analysis_id: str,
    detection_id: str,
    corps: VerdictIn,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    d = revue.statuer(
        db, a, _detection(a, detection_id), corps.action, auteur_id=utilisateur.id,
        commentaire=corps.commentaire, label=corps.label, fdi=corps.fdi,
        fdi_fourni="fdi" in corps.model_fields_set,
        cadre=corps.cadre.tuple() if corps.cadre else None,
    )
    db.commit()
    db.refresh(d)
    return detection_out(d)


@router.post("/{analysis_id}/detections/{detection_id}/annuler", response_model=AnnulationOut)
def annuler_verdict(
    analysis_id: str,
    detection_id: str,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    d = revue.annuler(db, a, _detection(a, detection_id), auteur_id=utilisateur.id)
    db.commit()
    if d is None:
        return AnnulationOut(detection=None, retiree_id=detection_id)
    db.refresh(d)
    return AnnulationOut(detection=detection_out(d))


@router.post("/{analysis_id}/detections", response_model=DetectionOut, status_code=status.HTTP_201_CREATED)
def ajouter_detection(
    analysis_id: str,
    corps: AjoutIn,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    d = revue.ajouter(db, a, auteur_id=utilisateur.id, label=corps.label, fdi=corps.fdi,
                      cadre=corps.cadre.tuple(), commentaire=corps.commentaire)
    db.commit()
    db.refresh(d)
    return detection_out(d)


@router.put("/{analysis_id}/conclusion", response_model=AnalysisOut)
def enregistrer_conclusion(
    analysis_id: str,
    corps: ConclusionIn,
    _: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    revue.enregistrer_conclusion(a, corps.conclusion)
    db.commit()
    db.refresh(a)
    return analyse_out(a)


@router.post("/{analysis_id}/cloturer", response_model=AnalysisOut)
def cloturer(
    analysis_id: str,
    corps: ClotureIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    revue.cloturer(a, auteur_id=utilisateur.id, conclusion=corps.conclusion)
    journal.inscrire(
        db, "cloture_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        cible=f"analyse:{a.id}", details={"reference": a.reference, **revue.avancement(a)}, commit=False,
    )
    db.commit()
    db.refresh(a)
    return analyse_out(a)


@router.post("/{analysis_id}/rouvrir", response_model=AnalysisOut)
def rouvrir(
    analysis_id: str,
    corps: ReouvertureIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_REOPEN)),
    db: Session = Depends(get_db),
):
    a = _analyse(db, analysis_id, verrou=True)
    clotureur = a.cloturee_par_id          # effacé par la réouverture : lu avant
    motif = revue.rouvrir(a, corps.motif)
    notifications.notifier(db, clotureur, TypeNotification.ANALYSE_ROUVERTE, a,
                           auteur_id=utilisateur.id, motif=motif)
    journal.inscrire(
        db, "reouverture_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        cible=f"analyse:{a.id}", details={"reference": a.reference, "motif": motif}, commit=False,
    )
    db.commit()
    db.refresh(a)
    return analyse_out(a)


# --- Dents absentes (sprint 7) --------------------------------------------------------------

@router.post("/{analysis_id}/dents/{fdi}/absente", response_model=AnalysisOut)
def declarer_absente(
    analysis_id: str,
    fdi: int,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    """Le praticien déclare une dent absente, après l'avoir vérifié sur le
    cliché. Refusé si une dent porte ce numéro (la rejeter ou la renuméroter
    d'abord). Analyse clôturée : 409."""
    a = _analyse(db, analysis_id, verrou=True)
    numerotation.declarer_absente(db, a, fdi, utilisateur.id)
    journal.inscrire(db, "dent_absente", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     cible=f"analyse:{a.id}", details={"reference": a.reference, "fdi": fdi}, commit=False)
    db.commit()
    db.refresh(a)
    return analyse_out(a)


@router.delete("/{analysis_id}/dents/{fdi}/absente", response_model=AnalysisOut)
def retirer_absente(
    analysis_id: str,
    fdi: int,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DETECTION_REVIEW)),
    db: Session = Depends(get_db),
):
    """Retire la déclaration d'absence. Analyse clôturée : 409."""
    a = _analyse(db, analysis_id, verrou=True)
    if numerotation.retirer_absente(db, a, fdi):
        journal.inscrire(db, "dent_absente_retiree", journal.SUCCES, request=request,
                         utilisateur_id=utilisateur.id, cible=f"analyse:{a.id}",
                         details={"reference": a.reference, "fdi": fdi}, commit=False)
    db.commit()
    db.refresh(a)
    return analyse_out(a)
