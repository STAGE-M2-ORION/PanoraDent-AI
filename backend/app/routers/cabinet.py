"""Paramètres du cabinet (sprint 8) : en-tête des comptes rendus.

Nom, adresse, mentions propres au cabinet et logo. Toute session ouverte les
lit (le compte rendu et son aperçu les affichent) ; seule la permission
`cabinet:manage` les modifie, et chaque modification est journalisée.

Le logo n'est jamais stocké tel quel : son type réel est lu dans ses premiers
octets, puis il est décodé, réduit dans un cadre de 800 × 300 px en gardant
ses proportions, et ré-encodé en PNG (transparence conservée). Cela supprime
les métadonnées et neutralise un fichier piégé qui se dirait image.
"""
import io
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger, session_ouverte
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import ParametresCabinet
from ..permissions import CABINET_MANAGE
from ..schemas import _nom
from ..services import storage

router = APIRouter(prefix="/cabinet", tags=["cabinet"])

TAILLE_MAX = 1024 * 1024        # 1 Mo
CADRE = (800, 300)              # largeur × hauteur maximales du logo, en pixels
PIXELS_MAX = 40_000_000         # garde-fou contre les « bombes » de décompression
FORMATS = {"JPEG", "PNG", "WEBP"}


def parametres(db: Session) -> ParametresCabinet:
    """La ligne unique, créée vide à la première lecture."""
    p = db.get(ParametresCabinet, 1)
    if p is None:
        p = ParametresCabinet(id=1, nom="", adresse="", mentions="")
        db.add(p)
        db.flush()
    return p


class CabinetIn(BaseModel):
    nom: str = Field(min_length=1, max_length=120)
    adresse: str = Field(default="", max_length=500)
    mentions: str = Field(default="", max_length=1000)


def cabinet_out(p: ParametresCabinet) -> dict:
    return {
        "nom": p.nom, "adresse": p.adresse, "mentions": p.mentions,
        "logo": p.logo_cle is not None,
        # Change à chaque import : l'URL du logo peut être mise en cache.
        "logo_version": p.logo_cle.rsplit("/", 1)[-1].removesuffix(".png") if p.logo_cle else None,
        "maj_le": p.maj_le, "maj_par_nom": _nom(p.maj_par),
    }


@router.get("")
def lire(_: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    p = parametres(db)
    db.commit()
    return cabinet_out(p)


@router.put("")
def modifier(
    corps: CabinetIn,
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(CABINET_MANAGE)),
    db: Session = Depends(get_db),
):
    p = parametres(db)
    nouveau = {"nom": corps.nom.strip(), "adresse": corps.adresse.strip(), "mentions": corps.mentions.strip()}
    if not nouveau["nom"]:
        raise ApiError(422, "nom_requis", "Indiquez le nom du cabinet.")
    changes = sorted(k for k, v in nouveau.items() if getattr(p, k) != v)
    for k, v in nouveau.items():
        setattr(p, k, v)
    if changes:
        p.maj_le, p.maj_par_id = datetime.utcnow(), utilisateur.id
        journal.inscrire(db, "cabinet_parametres", journal.SUCCES, request=request,
                         utilisateur_id=utilisateur.id, details={"champs": changes}, commit=False)
    db.commit()
    db.refresh(p)
    return cabinet_out(p)


def _normaliser_logo(brut: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(brut)) as image:
            if image.format not in FORMATS:
                raise ApiError(415, "format_non_pris_en_charge", "Formats acceptés : JPEG, PNG ou WebP.")
            if image.width * image.height > PIXELS_MAX:
                raise ApiError(422, "image_invalide", "Image trop grande (40 mégapixels au plus).")
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image.thumbnail(CADRE, Image.LANCZOS)   # réduit seulement, proportions gardées
            sortie = io.BytesIO()
            image.save(sortie, format="PNG", optimize=True)
            return sortie.getvalue()
    except UnidentifiedImageError as exc:
        raise ApiError(415, "format_non_pris_en_charge", "Formats acceptés : JPEG, PNG ou WebP.") from exc
    except (OSError, Image.DecompressionBombError) as exc:
        raise ApiError(422, "image_invalide", "Ce fichier n'est pas une image lisible.") from exc


def _supprimer(cle: str | None) -> None:
    if cle:
        try:
            storage.delete(cle)
        except Exception:  # noqa: BLE001 — objet orphelin sans conséquence
            pass


@router.put("/logo")
async def importer_logo(
    request: Request,
    fichier: UploadFile = File(...),
    utilisateur: Utilisateur = Depends(exiger(CABINET_MANAGE)),
    db: Session = Depends(get_db),
):
    brut = await fichier.read(TAILLE_MAX + 1)
    if not brut:
        raise ApiError(422, "image_invalide", "Le fichier est vide.")
    if len(brut) > TAILLE_MAX:
        raise ApiError(413, "fichier_trop_volumineux", "Le logo dépasse 1 Mo.")
    png = _normaliser_logo(brut)
    cle = f"cabinet/logo-{secrets.token_urlsafe(9)}.png"
    storage.ensure_bucket()
    storage.put(cle, png, "image/png")
    p = parametres(db)
    ancienne, p.logo_cle = p.logo_cle, cle
    p.maj_le, p.maj_par_id = datetime.utcnow(), utilisateur.id
    journal.inscrire(db, "cabinet_logo", journal.SUCCES, request=request,
                     utilisateur_id=utilisateur.id, details={"logo": "importe"}, commit=False)
    db.commit()
    _supprimer(ancienne)
    db.refresh(p)
    return cabinet_out(p)


@router.delete("/logo", status_code=status.HTTP_204_NO_CONTENT)
def retirer_logo(
    request: Request,
    utilisateur: Utilisateur = Depends(exiger(CABINET_MANAGE)),
    db: Session = Depends(get_db),
):
    p = parametres(db)
    ancienne, p.logo_cle = p.logo_cle, None
    if ancienne:
        p.maj_le, p.maj_par_id = datetime.utcnow(), utilisateur.id
        journal.inscrire(db, "cabinet_logo", journal.SUCCES, request=request,
                         utilisateur_id=utilisateur.id, details={"logo": "retire"}, commit=False)
    db.commit()
    _supprimer(ancienne)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/logo")
def lire_logo(_: Utilisateur = Depends(session_ouverte), db: Session = Depends(get_db)):
    p = parametres(db)
    db.commit()
    if not p.logo_cle:
        raise ApiError(404, "introuvable", "Aucun logo importé.")
    try:
        contenu = storage.get(p.logo_cle)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(404, "introuvable", "Logo indisponible.") from exc
    return Response(contenu, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})
