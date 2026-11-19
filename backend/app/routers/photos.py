"""Photo de profil.

Par défaut, l'interface affiche la photo du compte Google (reprise à chaque
connexion). Chacun peut importer sa propre photo, prioritaire sur celle de
Google, ou la retirer pour revenir à celle de Google (sinon les initiales).

L'image importée n'est jamais stockée telle quelle : elle est décodée, recadrée
en carré 256 × 256 et ré-encodée en WebP, ce qui supprime les métadonnées
(EXIF, position GPS…) et neutralise un fichier piégé qui se dirait image.
"""
import io
import secrets
import uuid

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import session_ouverte
from ..auth_models import Utilisateur
from ..auth_schemas import UtilisateurOut
from ..database import get_db
from ..errors import ApiError
from ..services import storage

router = APIRouter(tags=["photos"])

TAILLE_MAX = 5 * 1024 * 1024  # 5 Mo
COTE = 256
PIXELS_MAX = 40_000_000  # garde-fou contre les « bombes » de décompression
FORMATS = {"JPEG", "PNG", "WEBP"}


def _normaliser(brut: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(brut)) as image:
            if image.format not in FORMATS:
                raise ApiError(422, "image_invalide", "Formats acceptés : JPEG, PNG ou WebP.")
            if image.width * image.height > PIXELS_MAX:
                raise ApiError(422, "image_invalide", "Image trop grande (40 mégapixels au plus).")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image = ImageOps.fit(image, (COTE, COTE), Image.LANCZOS)
            sortie = io.BytesIO()
            image.save(sortie, format="WEBP", quality=85)
            return sortie.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ApiError(422, "image_invalide", "Ce fichier n'est pas une image lisible.") from exc


def _supprimer_ancienne(cle: str | None) -> None:
    if cle:
        try:
            storage.delete(cle)
        except Exception:
            pass  # objet orphelin sans conséquence : la base ne le référence plus


@router.put("/moi/photo", response_model=UtilisateurOut)
async def importer_photo(
    request: Request,
    fichier: UploadFile = File(...),
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    brut = await fichier.read(TAILLE_MAX + 1)
    if not brut:
        raise ApiError(422, "image_invalide", "Le fichier est vide.")
    if len(brut) > TAILLE_MAX:
        raise ApiError(413, "fichier_trop_volumineux", "La photo dépasse 5 Mo.")
    webp = _normaliser(brut)

    cle = f"photos/{utilisateur.id}/{secrets.token_urlsafe(12)}.webp"
    storage.ensure_bucket()
    storage.put(cle, webp, "image/webp")
    ancienne, utilisateur.photo_cle = utilisateur.photo_cle, cle
    journal.inscrire(
        db, "photo_profil", journal.SUCCES, request=request,
        auteur_id=utilisateur.id, detail="importee", commit=False,
    )
    db.commit()
    _supprimer_ancienne(ancienne)
    db.refresh(utilisateur)
    return UtilisateurOut.depuis(utilisateur)


@router.delete("/moi/photo", response_model=UtilisateurOut)
def retirer_photo(
    request: Request,
    utilisateur: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Revient à la photo Google (ou aux initiales s'il n'y en a pas)."""
    ancienne, utilisateur.photo_cle = utilisateur.photo_cle, None
    if ancienne:
        journal.inscrire(
            db, "photo_profil", journal.SUCCES, request=request,
            auteur_id=utilisateur.id, detail="retiree", commit=False,
        )
    db.commit()
    _supprimer_ancienne(ancienne)
    db.refresh(utilisateur)
    return UtilisateurOut.depuis(utilisateur)


@router.get("/photos/{utilisateur_id}")
def lire_photo(
    utilisateur_id: uuid.UUID,
    _: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Photo importée d'un utilisateur, pour toute session ouverte (avatars
    de la liste des comptes, journal…). Jamais accessible sans session."""
    cible = db.get(Utilisateur, utilisateur_id)
    if cible is None or not cible.photo_cle:
        raise ApiError(404, "introuvable", "Aucune photo importée.")
    try:
        contenu = storage.get(cible.photo_cle)
    except Exception as exc:
        raise ApiError(404, "introuvable", "Photo indisponible.") from exc
    return Response(
        contenu,
        media_type="image/webp",
        # L'URL change à chaque import (`?v=`) : cache long sans risque.
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )
