"""Compte rendu PDF (sprint 8) : reconstruit à chaque demande, jamais stocké.

`GET /analyses/{id}/compte-rendu` — options en paramètres de requête :
`image`, `rejetees`, `commentaires` ; `brouillon` pour un aperçu pendant la
relecture ; `telecharger` pour un fichier joint plutôt qu'un affichage.

- Analyse clôturée : le compte rendu définitif.
- Analyse terminée, non clôturée : refus, sauf `brouillon=true` — aperçu
  marqué « BROUILLON » sur chaque page, qui ne se télécharge pas.
- Chaque génération est journalisée (aperçu ou téléchargement), avec son
  auteur, sa date, la référence et les options.
"""
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from PIL import Image
from sqlalchemy.orm import Session

from .. import journal
from ..auth_deps import exiger
from ..auth_models import Utilisateur
from ..database import get_db
from ..errors import ApiError
from ..models import StatutAnalyse
from ..permissions import REPORT_GENERATE
from ..services import compte_rendu, storage
from .analyses import _ou_404
from .cabinet import parametres

router = APIRouter(tags=["compte-rendu"])


def _logo(cle: str | None) -> bytes | None:
    if not cle:
        return None
    try:
        return storage.get(cle)
    except Exception:  # noqa: BLE001 — logo indisponible : en-tête sans logo, plutôt qu'aucun document
        return None


@router.get("/analyses/{analysis_id}/compte-rendu")
def compte_rendu_pdf(
    analysis_id: str,
    request: Request,
    image: bool = True,
    rejetees: bool = False,
    commentaires: bool = True,
    brouillon: bool = False,
    telecharger: bool = False,
    utilisateur: Utilisateur = Depends(exiger(REPORT_GENERATE)),
    db: Session = Depends(get_db),
):
    a = _ou_404(db, analysis_id)
    if a.statut != StatutAnalyse.TERMINEE:
        raise ApiError(409, "analyse_non_terminee", "L'analyse n'est pas terminée : pas de compte rendu.")
    if not a.cloturee and not brouillon:
        raise ApiError(409, "analyse_non_cloturee",
                       "Clôturez la relecture pour produire le compte rendu ; un aperçu « brouillon » reste possible.")
    brouillon = not a.cloturee            # une analyse clôturée donne toujours le document définitif
    if brouillon and telecharger:
        raise ApiError(409, "brouillon_non_telechargeable",
                       "Un brouillon s'affiche pour relecture, il ne se télécharge pas : clôturez d'abord l'analyse.")

    options = compte_rendu.Options(image=image, rejetees=rejetees, commentaires=commentaires, brouillon=brouillon)
    cabinet = parametres(db)
    contenu = compte_rendu.donnees(a, cabinet, options)
    radio = None
    if image:
        try:
            radio = Image.open(io.BytesIO(storage.get(a.image_key)))
        except Exception as exc:  # noqa: BLE001
            raise ApiError(409, "image_indisponible", "L'image anonymisée de l'analyse est introuvable.") from exc
    pdf = compte_rendu.rendre(contenu, radio, _logo(cabinet.logo_cle), datetime.now(timezone.utc))

    journal.inscrire(
        db, "compte_rendu_telecharge" if telecharger else "compte_rendu_genere", journal.SUCCES, request=request,
        utilisateur_id=utilisateur.id, cible=f"analyse:{a.id}",
        details={"reference": a.reference, "brouillon": brouillon, "image": image, "rejetees": rejetees,
                 "commentaires": commentaires},
    )
    nom = f"compte-rendu-{a.reference}{'-brouillon' if brouillon else ''}.pdf"
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'{"attachment" if telecharger else "inline"}; filename="{nom}"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })
