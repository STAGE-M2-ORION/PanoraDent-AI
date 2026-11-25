"""Base documentaire de l'assistant (sprint 9) : dépôt, liste, remplacement,
réindexation et suppression des documents de référence.

Gestion réservée à `document:manage`. L'indexation (extraction, découpage,
vectorisation) est faite par le worker, jamais pendant la requête : un PDF
de cent pages vectorisé sur processeur prend plusieurs minutes. La route
dépose le fichier et le met « en attente » ; l'écran suit son état.

Le fichier original est gardé dans le stockage objet, sous une clé tirée au
hasard, pour pouvoir le réindexer seul et l'ouvrir depuis une source citée
(`assistant:use`).
"""
import re
import secrets
from datetime import datetime
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import Document, EtatDocument
from ..permissions import ASSISTANT_USE, DOCUMENT_MANAGE
from ..schemas import _nom
from ..services import storage
from ..services.indexation import empreinte, etat_index, perime
from ..services.vectorisation import vectoriseur_courant

router = APIRouter(prefix="/documents", tags=["documents"])

TAILLE_MAX = 20 * 1024 * 1024   # 20 Mo, comme une radiographie
EXTENSIONS = {".pdf": "pdf", ".md": "markdown", ".markdown": "markdown"}
TYPES_MIME = {"pdf": "application/pdf", "markdown": "text/markdown; charset=utf-8"}


def document_out(d: Document, modele: str) -> dict:
    return {
        "id": d.id, "titre": d.titre, "nom_fichier": d.nom_fichier, "format": d.format, "taille": d.taille,
        "etat": d.etat, "erreur": d.erreur, "nb_passages": d.nb_passages, "modele_vecteurs": d.modele_vecteurs,
        "perime": perime(d, modele), "depose_le": d.depose_le, "depose_par_nom": _nom(d.depose_par),
        "indexe_le": d.indexe_le,
    }


def _ou_404(db: Session, document_id: str) -> Document:
    d = db.get(Document, document_id)
    if d is None:
        raise ApiError(404, "introuvable", "Document introuvable.")
    return d


async def _lire(fichier: UploadFile) -> tuple[bytes, str, str]:
    """Contenu, format et nom d'un fichier déposé, après contrôle du type RÉEL."""
    nom = PurePosixPath((fichier.filename or "").replace("\\", "/")).name[:255]
    format = EXTENSIONS.get(PurePosixPath(nom).suffix.lower())
    if format is None:
        raise ApiError(415, "format_non_pris_en_charge", "Formats acceptés : PDF ou Markdown (.md).")
    contenu = await fichier.read(TAILLE_MAX + 1)
    if not contenu:
        raise ApiError(422, "fichier_vide", "Le fichier est vide.")
    if len(contenu) > TAILLE_MAX:
        raise ApiError(413, "fichier_trop_volumineux", "Le fichier dépasse 20 Mo.")
    if format == "pdf" and not contenu.lstrip()[:5] == b"%PDF-":
        raise ApiError(415, "format_non_pris_en_charge", "Ce fichier n'est pas un PDF.")
    if format == "markdown":
        try:
            texte = contenu.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ApiError(415, "format_non_pris_en_charge", "Le fichier Markdown doit être encodé en UTF-8.") from exc
        if "\x00" in texte:
            raise ApiError(415, "format_non_pris_en_charge", "Ce fichier n'est pas un texte Markdown.")
    return contenu, format, nom


def _titre(titre: str | None, nom: str) -> str:
    titre = " ".join((titre or "").split())
    if not titre:  # par défaut : le nom du fichier, sans extension ni tirets
        titre = re.sub(r"[_-]+", " ", PurePosixPath(nom).stem).strip() or "Document"
    return titre[:200]


def _doublon(db: Session, contenu: bytes, sauf: str | None = None) -> None:
    autre = db.scalar(select(Document).where(Document.empreinte == empreinte(contenu)))
    if autre is not None and autre.id != sauf:
        raise ApiError(409, "document_deja_present", f"Ce fichier est déjà dans la base : « {autre.titre} ».")


def _supprimer_objet(cle: str | None) -> None:
    if cle:
        try:
            storage.delete(cle)
        except Exception:  # noqa: BLE001 — objet orphelin sans conséquence
            pass


@router.get("")
def lister(_: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)), db: Session = Depends(get_db)):
    from ..services.assistant import parametres

    modele = vectoriseur_courant().nom
    documents = db.scalars(select(Document).order_by(Document.depose_le.desc())).all()
    p = parametres(db)
    db.commit()
    return {
        "documents": [document_out(d, modele) for d in documents],
        "index": etat_index(db, modele),
        "parametres": {"passages": p.passages, "seuil": p.seuil},
    }


@router.post("", status_code=201)
async def deposer(
    request: Request,
    fichier: UploadFile = File(...),
    titre: str | None = Form(default=None),
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    contenu, format, nom = await _lire(fichier)
    _doublon(db, contenu)
    cle = f"documents/{secrets.token_hex(16)}"
    storage.put(cle, contenu, TYPES_MIME[format])
    d = Document(titre=_titre(titre, nom), nom_fichier=nom, format=format, cle_stockage=cle,
                 empreinte=empreinte(contenu), taille=len(contenu), etat=EtatDocument.EN_ATTENTE,
                 depose_par_id=utilisateur.id)
    db.add(d)
    db.flush()
    journal.inscrire(db, "document_depose", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     cible=f"document:{d.id}", details={"titre": d.titre, "format": format, "taille": len(contenu)},
                     commit=False)
    try:
        db.commit()
    except Exception:
        _supprimer_objet(cle)   # pas d'objet sans sa ligne
        raise
    db.refresh(d)
    return document_out(d, vectoriseur_courant().nom)


@router.put("/{document_id}/fichier")
async def remplacer(
    document_id: str,
    request: Request,
    fichier: UploadFile = File(...),
    titre: str | None = Form(default=None),
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    d = _ou_404(db, document_id)
    if d.etat == EtatDocument.EN_COURS:
        raise ApiError(409, "indexation_en_cours", "Le document est en cours d'indexation : réessayez dans un instant.")
    contenu, format, nom = await _lire(fichier)
    _doublon(db, contenu, sauf=d.id)
    ancienne, cle = d.cle_stockage, f"documents/{secrets.token_hex(16)}"
    storage.put(cle, contenu, TYPES_MIME[format])
    d.titre = _titre(titre, nom) if titre else d.titre
    d.nom_fichier, d.format, d.cle_stockage = nom, format, cle
    d.empreinte, d.taille = empreinte(contenu), len(contenu)
    # Les anciens passages restent interrogeables jusqu'à la nouvelle indexation.
    d.etat, d.erreur = EtatDocument.EN_ATTENTE, None
    journal.inscrire(db, "document_remplace", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     cible=f"document:{d.id}", details={"titre": d.titre, "format": format, "taille": len(contenu)},
                     commit=False)
    try:
        db.commit()
    except Exception:
        _supprimer_objet(cle)
        raise
    _supprimer_objet(ancienne)
    db.refresh(d)
    return document_out(d, vectoriseur_courant().nom)


@router.post("/{document_id}/reindexation")
def reindexer(
    document_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    d = _ou_404(db, document_id)
    if d.etat not in (EtatDocument.EN_ATTENTE, EtatDocument.EN_COURS):
        d.etat, d.erreur = EtatDocument.EN_ATTENTE, None
        journal.inscrire(db, "document_reindexation", journal.SUCCES, request=request,
                         utilisateur_id=utilisateur.id, cible=f"document:{d.id}", details={"titre": d.titre},
                         commit=False)
    db.commit()
    db.refresh(d)
    return document_out(d, vectoriseur_courant().nom)


@router.post("/reindexation")
def reindexer_les_perimes(
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    """Remet en attente les documents périmés (indexés par un autre modèle) et
    ceux dont l'indexation a échoué."""
    modele = vectoriseur_courant().nom
    a_refaire = [d for d in db.scalars(select(Document)).all()
                 if perime(d, modele) or d.etat == EtatDocument.ECHEC]
    for d in a_refaire:
        d.etat, d.erreur = EtatDocument.EN_ATTENTE, None
    if a_refaire:
        journal.inscrire(db, "document_reindexation", journal.SUCCES, request=request,
                         utilisateur_id=utilisateur.id, details={"documents": len(a_refaire)}, commit=False)
    db.commit()
    return {"documents": len(a_refaire)}


@router.delete("/{document_id}", status_code=204)
def supprimer(
    document_id: str,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(DOCUMENT_MANAGE)),
    db: Session = Depends(get_db),
):
    d = _ou_404(db, document_id)
    cle, titre = d.cle_stockage, d.titre
    db.delete(d)   # ses passages partent avec lui
    journal.inscrire(db, "document_supprime", journal.SUCCES, request=request, utilisateur_id=utilisateur.id,
                     cible=f"document:{document_id}", details={"titre": titre}, commit=False)
    db.commit()
    _supprimer_objet(cle)
    return Response(status_code=204)


@router.get("/{document_id}/fichier")
def ouvrir(
    document_id: str,
    _: Utilisateur = Depends(exiger(ASSISTANT_USE)),
    db: Session = Depends(get_db),
):
    """Le document de référence, pour aller vérifier une source citée."""
    d = _ou_404(db, document_id)
    try:
        contenu = storage.get(d.cle_stockage)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(404, "introuvable", "Le fichier de ce document est introuvable.") from exc
    nom = d.nom_fichier.encode("ascii", "replace").decode().replace('"', "")
    return Response(contenu, media_type=TYPES_MIME[d.format], headers={
        "Content-Disposition": f'inline; filename="{nom}"', "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff"})
