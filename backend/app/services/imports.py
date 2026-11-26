"""Enregistrement d'une analyse importée (sprint 12) : stockage de l'image
anonymisée, référence, épinglage du modèle actif, journal, mise en file.

Partagé par la route d'import (`POST /analyses`) et le jeu de démonstration
(`app/demo.py`) : la démonstration suit exactement le circuit réel.
"""
import logging
import uuid
from datetime import date, datetime

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import journal
from ..models import Analysis, StatutAnalyse
from . import anonymize as anon
from . import registre_modeles, storage

logger = logging.getLogger("uvicorn.error")


def prochaine_reference(db: Session) -> str:
    annee = datetime.utcnow().year
    prefixe = f"PDX-{annee}-"
    derniere = db.scalar(
        select(func.max(Analysis.reference)).where(Analysis.reference.like(f"{prefixe}%"))
    )
    rang = int(derniere.rsplit("-", 1)[1]) + 1 if derniere else 1
    return f"{prefixe}{rang:04d}"


def enregistrer(db: Session, resultat: "anon.Resultat", *, utilisateur_id, date_examen: date | None = None,
                note: str = "", request: Request | None = None) -> Analysis:
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
        # Identifiant fixé dès maintenant : le journal de l'import le cite
        # avant l'écriture en base (il valait « analyse:None » auparavant).
        id=str(uuid.uuid4()),
        utilisateur_id=utilisateur_id,
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
        analyse.reference = prochaine_reference(db)
        db.add(analyse)
        journal.inscrire(
            db, "import_analyse", journal.SUCCES, request=request, utilisateur_id=utilisateur_id,
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
    return analyse
