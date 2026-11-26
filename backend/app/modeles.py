"""Paquet modèle (sprint 12, lot F) : transporter une version publiée vers un
autre serveur, typiquement de la machine d'entraînement vers le cabinet.

Les poids ne sont pas versionnés et la base du cabinet n'est pas exposée :
`training/publish_model.py` ne peut pas y écrire. Le paquet est un dossier
`<version>/` contenant `dents.pt`, `anomalies.pt` et `publication.json` (la
fiche du registre : empreintes, découpage, mesures, seuils, jeu de données).

    python -m app.modeles exporter <version>      # fiche JSON sur la sortie standard
    python -m app.modeles installer < publication.json

L'installation inscrit la version au registre, NON active, et refuse une
fiche dont les empreintes diffèrent d'une version déjà inscrite sous ce nom.
L'activation reste un geste de l'administrateur (Administration › Modèles) :
le service d'inférence charge alors les poids et en vérifie les empreintes.
"""
import json
import sys

from sqlalchemy import select

from . import journal
from .database import SessionLocal
from .models import ModelVersion

CHAMPS = ("version", "dataset", "notes", "poids_dents", "poids_anomalies", "sha256_dents",
          "sha256_anomalies", "empreinte_decoupage", "seuils")
EMPREINTES = ("sha256_dents", "sha256_anomalies")


class Refus(Exception):
    pass


def exporter(db, version: str) -> dict:
    v = db.scalar(select(ModelVersion).where(ModelVersion.version == version))
    if v is None:
        raise Refus(f"Version {version} absente du registre.")
    if not v.servable:
        raise Refus(f"Version {version} incomplète (poids ou empreintes manquants) : rien à transporter.")
    fiche = {c: getattr(v, c) for c in CHAMPS}
    fiche["metrics"] = json.loads(v.metrics_json or "{}")
    fiche["publiee_le"] = v.created_at.isoformat(timespec="seconds")
    return fiche


def installer(db, fiche: dict) -> tuple[ModelVersion, bool]:
    """(version, inscrite maintenant). Rejouer avec la même fiche ne change rien."""
    manquants = [c for c in ("version", *EMPREINTES, "poids_dents", "poids_anomalies") if not fiche.get(c)]
    if manquants:
        raise Refus(f"Fiche incomplète : {', '.join(manquants)}.")
    existante = db.scalar(select(ModelVersion).where(ModelVersion.version == fiche["version"]))
    if existante is not None:
        if any(getattr(existante, c) != fiche[c] for c in EMPREINTES):
            raise Refus(f"Une version {fiche['version']} est déjà inscrite avec d'autres poids : refusé.")
        return existante, False
    v = ModelVersion(**{c: fiche.get(c) for c in CHAMPS},
                     metrics_json=json.dumps(fiche.get("metrics") or {}, ensure_ascii=False), actif=False)
    db.add(v)
    journal.inscrire(db, "modele_installe", journal.SUCCES, cible=f"modele:{v.version}",
                     details={"version": v.version, "sha256_dents": v.sha256_dents,
                              "sha256_anomalies": v.sha256_anomalies}, commit=False)
    db.commit()
    return v, True


def main(argv: list[str]) -> int:
    db = SessionLocal()
    try:
        if len(argv) == 2 and argv[0] == "exporter":
            print(json.dumps(exporter(db, argv[1]), ensure_ascii=False, indent=2))
        elif argv == ["installer"]:
            v, nouvelle = installer(db, json.load(sys.stdin))
            print(f"Version {v.version} {'inscrite au registre, non active' if nouvelle else 'déjà inscrite, inchangée'}."
                  " Activation : Administration › Modèles.")
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except Refus as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
