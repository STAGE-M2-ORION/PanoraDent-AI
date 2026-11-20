"""Analyses : import anonymisé en deux temps, consultation, suppression.

1. `POST /analyses/apercu` : contrôle, anonymisation et aperçu avant / après,
   avec les zones masquées. **Rien n'est stocké** : un import abandonné ne
   laisse aucune trace.
2. `POST /analyses` : le même fichier est renvoyé avec les masques manuels du
   praticien ; il est ré-anonymisé, seule l'image masquée part au stockage
   objet (pleine résolution, plus une version réduite pour l'affichage
   au-delà de 3 000 px), puis l'analyse par le modèle est lancée (le sprint 4
   la mettra en file).

Le fichier reçu n'est jamais écrit sur le disque : il est lu en mémoire.
Les clés de stockage sont tirées au hasard, jamais dérivées du nom du fichier
(qui porte souvent le nom du patient — il n'est d'ailleurs pas conservé).
"""
import base64
import io
import json
import logging
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Analysis, Detection
from ..permissions import ADMIN_CAPABILITIES, ANALYSIS_CREATE, ANALYSIS_DELETE, ANALYSIS_READ, REPORT_GENERATE
from ..schemas import AnalysisOut, AnalysisSummary, ApercuOut, ZoneOut, _nom, analyse_out
from ..services import anonymize as anon
from ..services import inference_client, report as report_svc, storage

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/analyses", tags=["analyses"])

NOTE_MAX = 500


async def _lire_fichier(fichier: UploadFile) -> bytes:
    # Lecture bornée : un fichier trop gros est refusé sans être lu en entier.
    brut = await fichier.read(anon.TAILLE_MAX + 1)
    if len(brut) > anon.TAILLE_MAX:
        raise ApiError(413, "fichier_trop_volumineux", "Le fichier dépasse 20 Mo.")
    return brut


def _masques(texte: str | None) -> list[dict]:
    if not texte:
        return []
    try:
        donnees = json.loads(texte)
    except ValueError as exc:
        raise ApiError(422, "masques_invalides", "Masques illisibles (JSON attendu).") from exc
    if not isinstance(donnees, list):
        raise ApiError(422, "masques_invalides", "Masques : une liste de rectangles est attendue.")
    return donnees


def _refus(exc: anon.FichierRefuse) -> ApiError:
    return ApiError(exc.status, exc.code, exc.message)


def _data_url(image: Image.Image) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(anon.apercu_jpeg(image)).decode("ascii")


def _prochaine_reference(db: Session) -> str:
    annee = datetime.utcnow().year
    prefixe = f"PDX-{annee}-"
    derniere = db.scalar(
        select(func.max(Analysis.reference)).where(Analysis.reference.like(f"{prefixe}%"))
    )
    rang = int(derniere.rsplit("-", 1)[1]) + 1 if derniere else 1
    return f"{prefixe}{rang:04d}"


def _ou_404(db: Session, analysis_id: str) -> Analysis:
    a = db.get(Analysis, analysis_id)
    if not a:
        raise ApiError(404, "introuvable", "Analyse introuvable.")
    return a


@router.post("/apercu", response_model=ApercuOut)
async def apercu(
    fichier: UploadFile = File(...),
    masques: str | None = Form(default=None),
    _: Utilisateur = Depends(exiger(ANALYSIS_CREATE)),
):
    """Contrôle et anonymisation, sans rien stocker : l'aperçu avant / après
    et les zones masquées (automatiques et manuelles), en fractions de l'image."""
    brut = await _lire_fichier(fichier)
    try:
        image = anon.lire(brut)
        manuelles = anon.zones_depuis(_masques(masques))
    except anon.FichierRefuse as exc:
        raise _refus(exc) from exc
    auto = anon.detecter_inscriptions(image)
    largeur, hauteur = image.size
    return ApercuOut(
        largeur=largeur, hauteur=hauteur,
        zones_auto=[ZoneOut(**z.en_dict()) for z in auto],
        zones_manuelles=[ZoneOut(**z.en_dict()) for z in manuelles],
        avant=_data_url(image),
        apres=_data_url(anon.masquer(image, auto + manuelles)),
    )


@router.post("", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_analysis(
    request: Request,
    fichier: UploadFile = File(...),
    masques: str | None = Form(default=None),
    date_examen: date | None = Form(default=None),
    note: str = Form(default=""),
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_CREATE)),
    db: Session = Depends(get_db),
):
    """Confirmation de l'import : ré-anonymisation avec les masques manuels,
    stockage de la seule image masquée, analyse, enregistrement."""
    if len(note) > NOTE_MAX:
        raise ApiError(422, "champ_invalide", f"La note ne doit pas dépasser {NOTE_MAX} caractères.")
    brut = await _lire_fichier(fichier)
    try:
        resultat = anon.anonymiser(brut, _masques(masques))
    except anon.FichierRefuse as exc:
        raise _refus(exc) from exc
    del brut  # l'original ne sert plus à rien : on ne le garde pas

    base = f"images/{uuid.uuid4()}"
    cles = [f"{base}.png"]
    affichage = anon.version_affichage(resultat.image)
    storage.ensure_bucket()
    storage.put(cles[0], resultat.png, "image/png")
    if affichage:
        cles.append(f"{base}_affichage.png")
        storage.put(cles[1], affichage, "image/png")

    def nettoyer():
        for cle in cles:
            try:
                storage.delete(cle)
            except Exception:  # noqa: BLE001
                logger.exception("Objet orphelin à supprimer : %s", cle)

    try:
        inference = await inference_client.infer(resultat.png, "image.png")
    except Exception as exc:  # noqa: BLE001
        nettoyer()
        logger.exception("Inférence indisponible")
        raise ApiError(
            503, "inference_indisponible",
            "Le service d'analyse ne répond pas. L'image n'a pas été conservée : réessayez dans un instant.",
        ) from exc

    largeur, hauteur = resultat.taille
    analyse = Analysis(
        utilisateur_id=utilisateur.id,
        date_examen=date_examen,
        note=note.strip(),
        image_key=cles[0],
        image_affichage_key=cles[1] if affichage else None,
        model_version=inference.get("model_version", "unknown"),
        inference_mode=inference.get("mode", "unknown"),
        width=largeur, height=hauteur,
        masques={
            "auto": [z.en_dict() for z in resultat.zones_auto],
            "manuelles": [z.en_dict() for z in resultat.zones_manuelles],
        },
    )
    for d in inference.get("detections", []):
        bbox = d["bbox"]
        analyse.detections.append(Detection(
            label=d["label"], fdi=d.get("fdi"), confidence=d["confidence"],
            x=bbox[0], y=bbox[1], w=bbox[2], h=bbox[3], source="model",
        ))
    for tentative in range(3):  # deux imports simultanés peuvent viser la même référence
        analyse.reference = _prochaine_reference(db)
        db.add(analyse)
        journal.inscrire(
            db, "import_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
            cible=f"analyse:{analyse.id}",
            details={"reference": analyse.reference, "zones_auto": len(resultat.zones_auto),
                     "zones_manuelles": len(resultat.zones_manuelles)},
            commit=False,
        )
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if tentative == 2:
                nettoyer()
                raise
    db.refresh(analyse)
    return analyse_out(analyse)


@router.get("", response_model=list[AnalysisSummary])
def list_analyses(
    mine: bool = False,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_READ)),
    db: Session = Depends(get_db),
):
    """Analyses du cabinet, plus récentes d'abord ; `?mine=true` : celles que
    l'on a déposées."""
    q = select(Analysis).order_by(Analysis.created_at.desc())
    if mine:
        q = q.where(Analysis.utilisateur_id == utilisateur.id)
    rows = db.execute(q).unique().scalars().all()
    return [
        AnalysisSummary(
            id=a.id, created_at=a.created_at, reference=a.reference, date_examen=a.date_examen,
            deposant_id=a.utilisateur_id, deposant_nom=_nom(a.deposant),
            model_version=a.model_version, inference_mode=a.inference_mode,
            n_detections=len(a.detections),
            labels=sorted({d.label for d in a.detections if d.label != "tooth"}),
            has_report=a.report_key is not None,
        ) for a in rows
    ]


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(ANALYSIS_READ)),
):
    return analyse_out(_ou_404(db, analysis_id))


@router.get("/{analysis_id}/image")
def get_image_url(
    analysis_id: str,
    taille: str = "affichage",
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(ANALYSIS_READ)),
):
    """URL présignée (1 h) : la version réduite si elle existe, sinon la
    pleine résolution (`?taille=pleine` pour forcer celle-ci)."""
    a = _ou_404(db, analysis_id)
    cle = a.image_affichage_key if taille != "pleine" and a.image_affichage_key else a.image_key
    return {"url": storage.presigned_url(cle)}


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(
    analysis_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_DELETE)),
    db: Session = Depends(get_db),
):
    """Réservée au déposant et à l'administrateur. Efface les objets stockés
    (image, version d'affichage, compte rendu) PUIS la ligne : une suppression
    qui laisserait l'image derrière elle serait une fuite, pas un oubli."""
    a = _ou_404(db, analysis_id)
    administrateur = ADMIN_CAPABILITIES <= set(utilisateur.permission_codes)
    if a.utilisateur_id != utilisateur.id and not administrateur:
        raise ApiError(
            403, "acces_refuse",
            "Seul le praticien qui a déposé cette analyse, ou un administrateur, peut la supprimer.",
        )
    for cle in a.cles_stockees():
        try:
            storage.delete(cle)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Suppression de %s impossible", cle)
            raise ApiError(
                503, "stockage_indisponible",
                "Le stockage ne répond pas : l'analyse n'a pas été supprimée. Réessayez.",
            ) from exc
    journal.inscrire(
        db, "suppression_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
        cible=f"analyse:{a.id}", details={"reference": a.reference, "objets": len(a.cles_stockees())},
        commit=False,
    )
    db.delete(a)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{analysis_id}/report")
def build_report(
    analysis_id: str,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(REPORT_GENERATE)),
):
    a = _ou_404(db, analysis_id)
    image = Image.open(io.BytesIO(storage.get(a.image_key))).convert("L")
    dets = [dict(label=d.label, fdi=d.fdi, confidence=d.confidence,
                 x=d.x, y=d.y, w=d.w, h=d.h) for d in a.detections]
    pdf = report_svc.build(image, dets, a.reference, a.model_version)
    report_key = f"reports/{uuid.uuid4()}.pdf"
    storage.put(report_key, pdf, "application/pdf")
    ancien, a.report_key = a.report_key, report_key
    db.commit()
    if ancien:
        try:
            storage.delete(ancien)
        except Exception:  # noqa: BLE001
            logger.exception("Ancien compte rendu orphelin : %s", ancien)
    return {"url": storage.presigned_url(report_key)}
