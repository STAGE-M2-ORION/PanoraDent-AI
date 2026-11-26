"""Paquet modèle (sprint 12, lot F) : une version publiée passe d'un serveur à
l'autre avec sa fiche, inscrite non active, sans écraser d'autres poids."""
import json

import pytest
from sqlalchemy import select

from app import modeles
from app.auth_models import Journal
from app.models import ModelVersion

FICHE = {
    "version": "dentex-2026.11", "dataset": "DENTEX", "notes": "", "poids_dents": "dentex-2026.11/dents.pt",
    "poids_anomalies": "dentex-2026.11/anomalies.pt", "sha256_dents": "a" * 64, "sha256_anomalies": "b" * 64,
    "empreinte_decoupage": "c" * 64, "seuils": {"caries": 0.1},
}


def test_aller_retour_entre_deux_registres(db):
    db.add(ModelVersion(**FICHE, metrics_json=json.dumps({"map50": 0.51}), actif=True))
    db.commit()
    fiche = modeles.exporter(db, "dentex-2026.11")
    assert fiche["metrics"] == {"map50": 0.51} and fiche["seuils"] == {"caries": 0.1}
    json.dumps(fiche)                                     # transportable tel quel

    db.query(ModelVersion).delete()
    db.commit()
    v, nouvelle = modeles.installer(db, fiche)
    assert nouvelle and not v.actif                       # jamais activée d'office
    assert (v.sha256_dents, v.seuils, json.loads(v.metrics_json)) == ("a" * 64, {"caries": 0.1}, {"map50": 0.51})
    (entree,) = db.scalars(select(Journal).where(Journal.action == "modele_installe")).all()
    assert entree.cible == "modele:dentex-2026.11"
    # Rejouée : rien ne change.
    assert modeles.installer(db, fiche)[1] is False


def test_refus(db):
    with pytest.raises(modeles.Refus, match="absente"):
        modeles.exporter(db, "inconnue")
    with pytest.raises(modeles.Refus, match="incomplète"):
        modeles.installer(db, {**FICHE, "sha256_dents": None})
    modeles.installer(db, FICHE)
    with pytest.raises(modeles.Refus, match="autres poids"):
        modeles.installer(db, {**FICHE, "sha256_anomalies": "d" * 64})
    db.add(ModelVersion(version="sans-poids"))
    db.commit()
    with pytest.raises(modeles.Refus, match="incomplète"):
        modeles.exporter(db, "sans-poids")
