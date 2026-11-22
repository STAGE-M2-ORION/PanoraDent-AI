import uuid
from datetime import date, datetime
from pydantic import BaseModel


def _nom(utilisateur) -> str | None:
    if utilisateur is None:
        return None
    nom = " ".join(p for p in (utilisateur.prenom, utilisateur.nom) if p and p.strip())
    return nom or utilisateur.email


class ValeursOut(BaseModel):
    """Type, dent et cadre (fractions de l'image)."""
    label: str
    fdi: int | None
    x: float
    y: float
    w: float
    h: float


class VerdictOut(BaseModel):
    action: str
    label: str
    fdi: int | None
    commentaire: str = ""
    auteur_nom: str | None = None
    cree_le: datetime
    annule_le: datetime | None = None


class DetectionOut(BaseModel):
    """Valeurs RETENUES (dernier verdict actif, sinon la proposition), boîte
    en FRACTIONS de l'image (0 à 1). `proposition` : valeurs d'origine,
    jamais modifiées ; `verdicts` : historique, annulations comprises."""
    id: str
    label: str
    fdi: int | None
    confidence: float | None
    x: float
    y: float
    w: float
    h: float
    source: str                 # model | human
    model_version: str = ""
    etat: str                   # a_revoir | validee | corrigee | rejetee
    reviewed: bool
    commentaire: str = ""
    revu_par_nom: str | None = None
    revu_le: datetime | None = None
    proposition: ValeursOut
    verdicts: list[VerdictOut] = []


def detection_out(d) -> DetectionOut:
    courant = d.verdict_courant
    return DetectionOut(
        id=d.id, confidence=d.confidence, source=d.source, model_version=d.model_version or "",
        etat=d.etat, reviewed=d.reviewed, commentaire=courant.commentaire if courant else "",
        revu_par_nom=_nom(d.revu_par), revu_le=d.revu_le,
        proposition=ValeursOut(label=d.label, fdi=d.fdi, x=d.x, y=d.y, w=d.w, h=d.h),
        verdicts=[VerdictOut(action=v.action, label=v.label, fdi=v.fdi, commentaire=v.commentaire,
                             auteur_nom=_nom(v.auteur), cree_le=v.cree_le, annule_le=v.annule_le)
                  for v in d.verdicts],
        **d.retenu(),
    )


class AvancementOut(BaseModel):
    revues: int
    total: int


class AnalysisOut(BaseModel):
    id: str
    created_at: datetime
    reference: str
    date_examen: date | None = None
    note: str = ""
    deposant_id: uuid.UUID | None = None
    deposant_nom: str | None = None
    # Nombre de zones masquées à l'import (automatiques, manuelles).
    zones_masquees: dict = {}
    # File de traitement.
    statut: str
    erreur: str = ""
    tentatives: int = 0
    lance_le: datetime | None = None
    termine_le: datetime | None = None
    duree_ms: int | None = None
    image_key: str
    report_key: str | None
    model_version: str
    inference_mode: str
    # Registre (sprint 6) : version épinglée à la mise en file, analyse d'origine d'un rejeu.
    version_demandee: str | None = None
    origine_id: str | None = None
    width: int
    height: int
    detections: list[DetectionOut] = []
    # Relecture (sprint 5).
    conclusion: str = ""
    cloturee: bool = False
    cloturee_le: datetime | None = None
    cloturee_par_nom: str | None = None
    avancement: AvancementOut = AvancementOut(revues=0, total=0)


class AnalysisSummary(BaseModel):
    id: str
    created_at: datetime
    reference: str
    date_examen: date | None = None
    deposant_id: uuid.UUID | None = None
    deposant_nom: str | None = None
    statut: str = "terminee"
    model_version: str
    inference_mode: str
    n_detections: int
    # Classes d'anomalies présentes (sans doublon) : filtres de l'historique.
    labels: list[str] = []
    has_report: bool = False
    # Relecture : clôturée (lecture seule), détections sans verdict.
    cloturee: bool = False
    a_revoir: int = 0
    revues: int = 0


def analyse_out(a) -> AnalysisOut:
    from .services.revue import avancement

    masques = a.masques or {}
    return AnalysisOut.model_validate({
        **{c: getattr(a, c) for c in (
            "id", "created_at", "reference", "date_examen", "note", "image_key", "report_key",
            "model_version", "inference_mode", "version_demandee", "origine_id", "width", "height",
            "statut", "erreur", "tentatives", "lance_le", "termine_le", "duree_ms",
        )},
        "detections": [detection_out(d) for d in a.detections],
        "conclusion": a.conclusion or "",
        "cloturee": a.cloturee,
        "cloturee_le": a.cloturee_le,
        "cloturee_par_nom": _nom(a.cloturee_par),
        "avancement": avancement(a),
        "deposant_id": a.utilisateur_id,
        "deposant_nom": _nom(a.deposant),
        "zones_masquees": {"auto": len(masques.get("auto", [])), "manuelles": len(masques.get("manuelles", [])),
                           "methode": masques.get("methode")},
    })


class ZoneOut(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ApercuOut(BaseModel):
    """Aperçu d'import : rien n'est stocké. Images en data URL JPEG (réduites)."""
    largeur: int
    hauteur: int
    zones_auto: list[ZoneOut]
    zones_manuelles: list[ZoneOut]
    # Détection des inscriptions : « modele_texte » ou « heuristique » (secours).
    methode: str = "heuristique"
    avant: str
    apres: str


class StatutOut(BaseModel):
    """Suivi léger, relu toutes les deux secondes par l'écran."""
    id: str
    statut: str
    erreur: str = ""
    tentatives: int = 0
    duree_ms: int | None = None
    # Analyses en file avant celle-ci (0 : la prochaine ; None : pas en file).
    position: int | None = None


class StockageOut(BaseModel):
    objets: int
    octets: int
    seuil_octets: int
    alerte: bool
