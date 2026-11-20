"""Photo de profil.

Par défaut, l'interface affiche la photo du compte Google (reprise à chaque
connexion). Chacun peut importer sa propre photo, prioritaire sur celle de
Google, ou la retirer pour revenir à celle de Google (sinon les initiales).

L'image importée n'est jamais stockée telle quelle : son type réel est lu dans
ses premiers octets (pas dans son extension), puis elle est décodée, recadrée
en carré 256 × 256 et ré-encodée en WebP, ce qui supprime les métadonnées
(EXIF, position GPS…) et neutralise un fichier piégé qui se dirait image. Une
miniature de 128 px est produite pour les avatars. Les deux sont servies depuis
le stockage objet, jamais depuis un dossier du serveur web.
"""
import io
import secrets
import uuid

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
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

TAILLE_MAX = 2 * 1024 * 1024  # 2 Mo
COTE = 256
COTE_MINIATURE = 128
PIXELS_MAX = 40_000_000  # garde-fou contre les « bombes » de décompression
FORMATS = {"JPEG", "PNG", "WEBP"}


def _format_non_pris_en_charge() -> ApiError:
    return ApiError(415, "format_non_pris_en_charge", "Formats acceptés : JPEG, PNG ou WebP.")


def _webp(image: Image.Image, cote: int) -> bytes:
    sortie = io.BytesIO()
    ImageOps.fit(image, (cote, cote), Image.LANCZOS).save(sortie, format="WEBP", quality=85)
    return sortie.getvalue()


def _normaliser(brut: bytes) -> tuple[bytes, bytes]:
    """Renvoie `(photo 256 px, miniature 128 px)` en WebP."""
    try:
        with Image.open(io.BytesIO(brut)) as image:
            if image.format not in FORMATS:
                raise _format_non_pris_en_charge()
            if image.width * image.height > PIXELS_MAX:
                raise ApiError(422, "image_invalide", "Image trop grande (40 mégapixels au plus).")
            image = ImageOps.exif_transpose(image).convert("RGB")
            return _webp(image, COTE), _webp(image, COTE_MINIATURE)
    except UnidentifiedImageError as exc:
        # Le contenu n'est l'image d'aucun format connu, quelle que soit son extension.
        raise _format_non_pris_en_charge() from exc
    except (OSError, Image.DecompressionBombError) as exc:
        raise ApiError(422, "image_invalide", "Ce fichier n'est pas une image lisible.") from exc


def _cle_miniature(cle: str) -> str:
    return cle.removesuffix(".webp") + "_128.webp"


def _supprimer_ancienne(cle: str | None) -> None:
    if cle:
        for objet in (cle, _cle_miniature(cle)):
            try:
                storage.delete(objet)
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
        raise ApiError(413, "fichier_trop_volumineux", "La photo dépasse 2 Mo.")
    webp, miniature = _normaliser(brut)

    cle = f"photos/{utilisateur.id}/{secrets.token_urlsafe(12)}.webp"
    storage.ensure_bucket()
    storage.put(cle, webp, "image/webp")
    storage.put(_cle_miniature(cle), miniature, "image/webp")
    ancienne, utilisateur.photo_cle = utilisateur.photo_cle, cle
    journal.inscrire(
        db, "photo_profil", journal.SUCCES, request=request,
        utilisateur_id=utilisateur.id, details={"photo": "importee"}, commit=False,
    )
    db.commit()
    _supprimer_ancienne(ancienne)
    db.refresh(utilisateur)
    return UtilisateurOut.depuis(utilisateur)


@router.delete("/moi/photo", status_code=status.HTTP_204_NO_CONTENT)
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
            utilisateur_id=utilisateur.id, details={"photo": "retiree"}, commit=False,
        )
    db.commit()
    _supprimer_ancienne(ancienne)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/photos/{utilisateur_id}")
def lire_photo(
    utilisateur_id: uuid.UUID,
    taille: int | None = Query(default=None),
    _: Utilisateur = Depends(session_ouverte),
    db: Session = Depends(get_db),
):
    """Photo importée d'un utilisateur, pour toute session ouverte (avatars
    de la liste des comptes, journal…). Jamais accessible sans session."""
    cible = db.get(Utilisateur, utilisateur_id)
    if cible is None or not cible.photo_cle:
        raise ApiError(404, "introuvable", "Aucune photo importée.")
    try:
        if taille == COTE_MINIATURE:
            try:
                contenu = storage.get(_cle_miniature(cible.photo_cle))
            except Exception:  # photo importée avant les miniatures
                contenu = storage.get(cible.photo_cle)
        else:
            contenu = storage.get(cible.photo_cle)
    except Exception as exc:
        raise ApiError(404, "introuvable", "Photo indisponible.") from exc
    return Response(
        contenu,
        media_type="image/webp",
        # L'URL change à chaque import (`?v=`) : cache long sans risque.
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )
