"""Analyses : import anonymisé en deux temps, consultation, suppression.

1. `POST /analyses/apercu` : contrôle, anonymisation et aperçu avant / après,
   avec les zones masquées. **Rien n'est stocké** : un import abandonné ne
   laisse aucune trace.
2. `POST /analyses` : le même fichier est renvoyé avec les masques manuels du
   praticien ; il est ré-anonymisé, seule l'image masquée part au stockage
   objet (pleine résolution, plus une version réduite pour l'affichage
   au-delà de 3 000 px), et l'analyse est MISE EN FILE : la réponse part tout
   de suite, le worker (`app/worker.py`, processus séparé) interroge le modèle.
3. `GET /analyses/{id}/statut` : suivi (relu toutes les deux secondes) ;
   `POST /analyses/{id}/lancer` : relance après échec, sans jamais créer de
   seconde tâche pour une analyse déjà en file ou en cours.
4. `POST /analyses/{id}/rejouer` : nouvelle analyse du même cliché avec le
   modèle actif, liée à l'originale, qui n'est pas touchée (elle peut être
   clôturée) ; `GET /analyses/{id}/comparaison` : propositions des deux
   modèles, classe par classe.

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
from ..models import Analysis, EtatDetection, StatutAnalyse
from ..permissions import ADMIN_CAPABILITIES, ANALYSIS_CREATE, ANALYSIS_DELETE, ANALYSIS_READ, REPORT_GENERATE
from ..schemas import AnalysisOut, AnalysisSummary, ApercuOut, StatutOut, ZoneOut, _nom, analyse_out
from ..services import anonymize as anon
from ..services import comparaison, registre_modeles, report as report_svc, revue, storage

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
    auto, methode = anon.detecter(image)
    largeur, hauteur = image.size
    return ApercuOut(
        largeur=largeur, hauteur=hauteur, methode=methode,
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
    stockage de la seule image masquée, mise en file de l'analyse."""
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

    largeur, hauteur = resultat.taille
    analyse = Analysis(
        utilisateur_id=utilisateur.id,
        date_examen=date_examen,
        note=note.strip(),
        image_key=cles[0],
        image_affichage_key=cles[1] if affichage else None,
        width=largeur, height=hauteur,
        statut=StatutAnalyse.EN_FILE,
        lance_le=datetime.utcnow(),
        masques={
            "auto": [z.en_dict() for z in resultat.zones_auto],
            "manuelles": [z.en_dict() for z in resultat.zones_manuelles],
            "methode": resultat.methode,
        },
    )
    registre_modeles.epingler(db, analyse)
    for tentative in range(3):  # deux imports simultanés peuvent viser la même référence
        analyse.reference = _prochaine_reference(db)
        db.add(analyse)
        journal.inscrire(
            db, "import_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
            cible=f"analyse:{analyse.id}",
            details={"reference": analyse.reference, "zones_auto": len(resultat.zones_auto),
                     "zones_manuelles": len(resultat.zones_manuelles), "methode": resultat.methode},
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
            n_detections=len(a.detections), statut=a.statut,
            labels=sorted({d.label for d in a.detections if d.label != "tooth"}),
            has_report=a.report_key is not None,
            cloturee=a.cloturee, a_revoir=len(revue.a_revoir(a)), revues=revue.avancement(a)["revues"],
        ) for a in rows
    ]


@router.get("/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(ANALYSIS_READ)),
):
    return analyse_out(_ou_404(db, analysis_id))


def _position(db: Session, a: Analysis) -> int | None:
    if a.statut != StatutAnalyse.EN_FILE:
        return None
    return db.scalar(
        select(func.count()).select_from(Analysis)
        .where(Analysis.statut == StatutAnalyse.EN_FILE, Analysis.lance_le < a.lance_le)
    ) or 0


@router.get("/{analysis_id}/statut", response_model=StatutOut)
def statut(
    analysis_id: str,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(ANALYSIS_READ)),
):
    a = _ou_404(db, analysis_id)
    return StatutOut(id=a.id, statut=a.statut, erreur=a.erreur or "", tentatives=a.tentatives or 0,
                     duree_ms=a.duree_ms, position=_position(db, a))


@router.post("/{analysis_id}/lancer", response_model=StatutOut)
def lancer(
    analysis_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_CREATE)),
    db: Session = Depends(get_db),
):
    """(Re)met l'analyse en file après un échec. Déjà en file ou en cours :
    rien ne change (jamais deux tâches pour la même analyse). Terminée : 409.
    Une relance est une nouvelle mise en file : elle prend la version active."""
    a = db.scalar(select(Analysis).where(Analysis.id == analysis_id).with_for_update(of=Analysis))
    if a is None:
        raise ApiError(404, "introuvable", "Analyse introuvable.")
    if a.statut == StatutAnalyse.TERMINEE:
        raise ApiError(409, "deja_terminee", "Cette analyse est déjà terminée.")
    if a.statut == StatutAnalyse.ECHOUEE:
        a.statut = StatutAnalyse.EN_FILE
        a.erreur = ""
        a.lance_le = datetime.utcnow()
        registre_modeles.epingler(db, a)
        journal.inscrire(
            db, "relance_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
            cible=f"analyse:{a.id}", details={"reference": a.reference, "tentatives": a.tentatives},
            commit=False,
        )
    db.commit()
    return StatutOut(id=a.id, statut=a.statut, erreur=a.erreur or "", tentatives=a.tentatives or 0,
                     duree_ms=a.duree_ms, position=_position(db, a))


@router.post("/{analysis_id}/rejouer", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
def rejouer(
    analysis_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(ANALYSIS_CREATE)),
    db: Session = Depends(get_db),
):
    """Rejoue le cliché avec le modèle actif, pour comparer.

    L'analyse d'origine garde ses détections et ses verdicts (une proposition
    du modèle n'est jamais écrasée) : on crée une NOUVELLE analyse, avec sa
    propre copie de l'image — supprimer l'une ne doit pas vider l'autre."""
    origine = _ou_404(db, analysis_id)
    if origine.statut != StatutAnalyse.TERMINEE:
        raise ApiError(409, "non_terminee", "Seule une analyse terminée peut être rejouée.")
    active = registre_modeles.version_active(db)
    if active is None:
        raise ApiError(409, "aucun_modele_actif", "Aucune version de modèle n'est active.")
    if origine.model_version == active.version:
        raise ApiError(409, "meme_modele",
                       f"Cette analyse a déjà été faite avec le modèle actif ({active.version}).")

    base = f"images/{uuid.uuid4()}"
    copies = {origine.image_key: f"{base}.png"}
    if origine.image_affichage_key:
        copies[origine.image_affichage_key] = f"{base}_affichage.png"
    for source, cible in copies.items():
        storage.put(cible, storage.get(source), "image/png")

    rejeu = Analysis(
        utilisateur_id=utilisateur.id, date_examen=origine.date_examen, note=origine.note,
        image_key=copies[origine.image_key],
        image_affichage_key=copies.get(origine.image_affichage_key),
        width=origine.width, height=origine.height, masques=origine.masques,
        statut=StatutAnalyse.EN_FILE, lance_le=datetime.utcnow(), origine_id=origine.id,
        version_demandee=active.version,
    )
    for tentative in range(3):
        rejeu.reference = _prochaine_reference(db)
        db.add(rejeu)
        journal.inscrire(
            db, "rejeu_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
            cible=f"analyse:{rejeu.id}",
            details={"origine": origine.reference, "reference": rejeu.reference,
                     "de": origine.model_version, "vers": active.version},
            commit=False,
        )
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if tentative == 2:
                for cle in copies.values():
                    storage.delete(cle)
                raise
    db.refresh(rejeu)
    return analyse_out(rejeu)


@router.get("/{analysis_id}/comparaison")
def comparer(
    analysis_id: str,
    seuil: float = 0.25,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(exiger(ANALYSIS_READ)),
):
    """Rejeu face à son analyse d'origine : propositions des deux modèles."""
    rejeu = _ou_404(db, analysis_id)
    origine = db.get(Analysis, rejeu.origine_id) if rejeu.origine_id else None
    if origine is None:
        raise ApiError(404, "sans_origine", "Cette analyse n'est pas le rejeu d'une autre analyse.")

    def propositions(a: Analysis) -> list:
        return [(d.label, (d.x, d.y, d.w, d.h), d.confidence) for d in a.detections if d.source == "model"]

    termine = rejeu.statut == StatutAnalyse.TERMINEE
    return {
        "seuil": seuil,
        "origine": {"id": origine.id, "reference": origine.reference, "model_version": origine.model_version},
        "rejeu": {"id": rejeu.id, "reference": rejeu.reference, "statut": rejeu.statut,
                  "model_version": rejeu.model_version or rejeu.version_demandee},
        "par_classe": comparaison.comparer(propositions(origine), propositions(rejeu), seuil) if termine else None,
    }


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
    if a.statut != StatutAnalyse.TERMINEE:
        raise ApiError(409, "analyse_non_terminee", "L'analyse n'est pas terminée : pas de compte rendu.")
    image = Image.open(io.BytesIO(storage.get(a.image_key))).convert("L")
    L, H = image.size  # boîtes stockées en fractions → pixels de cette image
    # Valeurs retenues par le praticien ; les détections rejetées sont exclues.
    dets = []
    for d in a.detections:
        if d.etat == EtatDetection.REJETEE:
            continue
        r = d.retenu()
        dets.append(dict(label=r["label"], fdi=r["fdi"], confidence=d.confidence,
                         x=round(r["x"] * L), y=round(r["y"] * H), w=round(r["w"] * L), h=round(r["h"] * H)))
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
