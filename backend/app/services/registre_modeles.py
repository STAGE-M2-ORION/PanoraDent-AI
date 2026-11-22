"""Registre des modèles : version active, épinglage, bascule.

Règles :

- une seule version active (tenu aussi par un index unique partiel) ;
- une analyse reçoit la version active **au moment où elle entre en file**
  (`version_demandee`) et la garde : une bascule pendant que la file se vide
  ne change rien aux analyses déjà en file ; une file ne mélange jamais deux
  versions pour une même analyse ;
- une bascule n'est enregistrée qu'après que le service d'inférence a chargé
  la version et vérifié l'empreinte de ses poids : on ne bascule jamais vers
  un modèle qui ne pourrait pas servir.
"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Analysis, BasculeModele, ModelVersion
from . import inference_client


def version_active(db: Session) -> ModelVersion | None:
    return db.scalar(select(ModelVersion).where(ModelVersion.actif.is_(True)))


def epingler(db: Session, analyse: Analysis) -> None:
    """La version active devient celle de l'analyse (vide : mode historique)."""
    active = version_active(db)
    analyse.version_demandee = active.version if active else None


def demande_d_inference(db: Session, version: str | None) -> dict:
    """Paramètres envoyés au service d'inférence pour cette version."""
    if not version:
        return {}
    mv = db.scalar(select(ModelVersion).where(ModelVersion.version == version))
    if mv is None:
        return {"version": version}
    return {"version": version, "sha_dents": mv.sha256_dents, "sha_anomalies": mv.sha256_anomalies}


def seuils_de(db: Session, version: str | None) -> dict | None:
    """Seuils d'exploitation de la version (None : version sans seuils, ou aucune)."""
    if not version:
        return None
    mv = db.scalar(select(ModelVersion).where(ModelVersion.version == version))
    return dict(mv.seuils) if mv is not None and mv.seuils else None


def basculer(db: Session, version: str, motif: str, utilisateur_id) -> BasculeModele:
    """Active `version` ; lève ApiError si elle ne peut pas servir. Ne valide pas
    la transaction (l'appelant journalise puis valide)."""
    motif = (motif or "").strip()
    if not motif:
        raise ApiError(422, "motif_requis", "Indiquez le motif de la bascule.")
    # Verrou sur tout le registre : deux bascules simultanées se succèdent.
    versions = {v.version: v for v in db.scalars(select(ModelVersion).with_for_update())}
    cible = versions.get(version)
    if cible is None:
        raise ApiError(404, "introuvable", "Version de modèle introuvable.")
    if cible.actif:
        raise ApiError(409, "deja_active", "Cette version est déjà active.")
    if not cible.servable:
        raise ApiError(409, "modele_sans_poids",
                       "Cette version n'a pas ses deux fichiers de poids publiés : elle ne peut pas servir.")
    try:
        inference_client.charger(version, cible.sha256_dents, cible.sha256_anomalies)
    except inference_client.RefusInference as exc:
        raise ApiError(409, "modele_non_chargeable", exc.message) from exc
    except Exception as exc:  # noqa: BLE001
        raise ApiError(503, "inference_indisponible",
                       "Le service d'analyse ne répond pas : la bascule n'a pas eu lieu.") from exc

    precedente = next((v for v in versions.values() if v.actif), None)
    if precedente is not None:
        precedente.actif = False
        db.flush()  # libère l'index unique avant d'activer la nouvelle
    cible.actif = True
    cible.active_le = datetime.utcnow()
    bascule = BasculeModele(utilisateur_id=utilisateur_id, motif=motif, version=version,
                            version_precedente=precedente.version if precedente else None)
    db.add(bascule)
    return bascule
