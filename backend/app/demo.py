"""Jeu de démonstration (sprint 12, lot E) : `make demo`.

    tar cf - image1.png image2.png … | python -m app.demo

Crée un praticien et un lecteur de démonstration, puis importe chaque
panoramique reçue (archive tar sur l'entrée standard) au nom du praticien, par
le circuit réel : anonymisation, stockage, journal, mise en file ; le worker
les analyse ensuite avec le modèle actif. Images prévues : le jeu de test
public DENTEX (aucun patient du cabinet).

Refusé quand APP_ENV=production : des comptes et des analyses fictifs n'ont
rien à faire dans le dossier d'un cabinet. Rejoué, il ne double rien.

Aucun lien de connexion n'est imprimé : l'administrateur active les comptes
depuis Comptes → « Renvoyer le lien », comme pour tout compte.
"""
import sys
import tarfile

from sqlalchemy import select

from . import journal
from .auth_models import Role, Utilisateur
from .auth_schemas import UtilisateurCreation
from .config import settings
from .database import SessionLocal
from .models import Analysis
from .permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from .services import anonymize as anon
from .services import auth_service, imports

COMPTES = (
    ("praticien.demo@demo.example.org", "Démo", "Praticien", PRACTITIONER_ROLE),
    ("lecteur.demo@demo.example.org", "Démo", "Lecteur", VIEWER_ROLE),
)
NOTE = "Jeu de démonstration — panoramique publique DENTEX ({nom})."
EXTENSIONS = (".png", ".jpg", ".jpeg")


class Refus(Exception):
    pass


def _compte(db, email, nom, prenom, role) -> tuple[Utilisateur, bool]:
    existant = auth_service.par_email(db, email)
    if existant is not None:
        return existant, False
    role_id = db.scalar(select(Role.id).where(Role.libelle == role))
    return auth_service.creer_utilisateur(
        db, UtilisateurCreation(email=email, nom=nom, prenom=prenom, role_id=role_id)), True


def charger(db, images: list[tuple[str, bytes]]) -> dict:
    if settings.app_env.lower() == "production":
        raise Refus("Jeu de démonstration refusé quand APP_ENV=production.")
    comptes = {}
    crees = []
    for email, nom, prenom, role in COMPTES:
        u, cree = _compte(db, email, nom, prenom, role)
        comptes[role] = u
        if cree:
            crees.append(email)
    praticien = comptes[PRACTITIONER_ROLE]

    deja = set(db.scalars(select(Analysis.note).where(Analysis.utilisateur_id == praticien.id)))
    importees, ignorees = [], []
    for nom, brut in images:
        note = NOTE.format(nom=nom)
        if note in deja:
            ignorees.append(nom)
            continue
        try:
            resultat = anon.anonymiser(brut, [])
        except anon.FichierRefuse as exc:
            ignorees.append(f"{nom} ({exc.message})")
            continue
        a = imports.enregistrer(db, resultat, utilisateur_id=praticien.id, note=note)
        importees.append(a.reference)
    journal.inscrire(db, "jeu_demo_charge", journal.SUCCES, utilisateur_id=None,
                     details={"comptes_crees": crees, "analyses": len(importees), "ignorees": len(ignorees)})
    db.commit()
    return {"comptes_crees": crees, "analyses": importees, "ignorees": ignorees}


def _lire_archive(flux) -> list[tuple[str, bytes]]:
    images = []
    with tarfile.open(fileobj=flux, mode="r|") as tar:
        for info in tar:
            nom = info.name.rsplit("/", 1)[-1]
            if info.isfile() and nom.lower().endswith(EXTENSIONS):
                images.append((nom, tar.extractfile(info).read()))
    return images


def main() -> int:
    if settings.app_env.lower() == "production":   # avant même de lire l'archive
        print("Jeu de démonstration refusé quand APP_ENV=production.", file=sys.stderr)
        return 1
    images = _lire_archive(sys.stdin.buffer)
    db = SessionLocal()
    try:
        bilan = charger(db, images)
    except Refus as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        db.close()
    for email in bilan["comptes_crees"]:
        print(f"compte créé : {email} (lien de première connexion : Comptes → « Renvoyer le lien »)")
    print(f"{len(bilan['analyses'])} analyses mises en file : {', '.join(bilan['analyses']) or '—'}")
    if bilan["ignorees"]:
        print(f"{len(bilan['ignorees'])} déjà chargées ou refusées : {', '.join(bilan['ignorees'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
