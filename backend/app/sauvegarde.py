"""Sauvegarde et restauration (sprint 12, lot E) : le côté « application ».

Appelé par `scripts/sauvegarder.sh` et `scripts/restaurer.sh` dans un
conteneur du backend (mêmes réglages, même accès au stockage) :

    python -m app.sauvegarde inventaire          # JSON : comptes, version du schéma, objets
    python -m app.sauvegarde exporter-objets     # archive tar des objets sur la sortie standard
    python -m app.sauvegarde importer-objets     # archive tar lue sur l'entrée standard
    python -m app.sauvegarde verifier            # chaque fichier cité par la base existe ?
    python -m app.sauvegarde comparer < inventaire.json   # restauré = sauvegardé ?
    python -m app.sauvegarde journaliser-restauration < inventaire.json

La base elle-même passe par `pg_dump` / `pg_restore` (scripts). Les objets
passent par l'API S3 de MinIO, pas par son dossier de données : le format
interne de MinIO peut changer d'une version à l'autre, une archive de fichiers
ordinaires non. Le type de chaque objet est gardé dans l'archive (en-tête pax).
"""
import json
import sys
import tarfile
import time
from datetime import datetime, timezone

from sqlalchemy import func, select, text

from .auth_models import Journal, Utilisateur
from .database import get_session_factory
from .models import Analysis, Document, ParametresCabinet, Passage
from .services import storage

TYPE = "PANORADENT.content_type"


def _objets():
    for page in storage._s3.get_paginator("list_objects_v2").paginate(Bucket=storage.settings.s3_bucket):
        yield from page.get("Contents", [])


def inventaire() -> dict:
    db = get_session_factory()()
    try:
        compter = lambda m: db.scalar(select(func.count()).select_from(m))  # noqa: E731
        try:
            version = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        except Exception:  # noqa: BLE001  (base créée sans Alembic : tests)
            db.rollback()
            version = None
        comptes = {
            "utilisateurs": compter(Utilisateur), "analyses": compter(Analysis), "documents": compter(Document),
            "passages": compter(Passage), "journal": compter(Journal),
        }
    finally:
        db.close()
    storage.ensure_bucket()
    objets = octets = 0
    for o in _objets():
        objets += 1
        octets += o["Size"]
    return {"date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "schema": version,
            "comptes": comptes, "objets": {"nombre": objets, "octets": octets}}


def exporter_objets(sortie) -> int:
    storage.ensure_bucket()
    n = 0
    with tarfile.open(fileobj=sortie, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for o in _objets():
            reponse = storage._s3.get_object(Bucket=storage.settings.s3_bucket, Key=o["Key"])
            info = tarfile.TarInfo(o["Key"])
            info.size = o["Size"]
            info.mtime = int(o["LastModified"].timestamp())
            info.pax_headers = {TYPE: reponse.get("ContentType") or "application/octet-stream"}
            tar.addfile(info, reponse["Body"])
            n += 1
    return n


def importer_objets(entree) -> int:
    storage.ensure_bucket()
    n = 0
    with tarfile.open(fileobj=entree, mode="r|") as tar:
        for info in tar:
            if not info.isfile():
                continue
            # Une clé d'objet est un nom, pas un chemin : rien n'est écrit sur le disque.
            donnees = tar.extractfile(info).read()
            storage.put(info.name, donnees, info.pax_headers.get(TYPE, "application/octet-stream"))
            n += 1
    return n


def verifier() -> list[str]:
    """Clés citées par la base et absentes du stockage (une restauration saine n'en a aucune)."""
    db = get_session_factory()()
    try:
        cles = set()
        for a in db.scalars(select(Analysis)):
            cles.update(a.cles_stockees())
        cles.update(db.scalars(select(Document.cle_stockage)))
        cles.update(k for k in db.scalars(select(Utilisateur.photo_cle)) if k)
        cles.update(k for k in db.scalars(select(ParametresCabinet.logo_cle)) if k)
    finally:
        db.close()
    presentes = {o["Key"] for o in _objets()}
    return sorted(cles - presentes)


def comparer(reference: dict, actuel: dict) -> list[str]:
    """Écarts entre l'inventaire pris à la sauvegarde et celui de la pile restaurée."""
    ecarts = []
    if reference.get("schema") != actuel.get("schema"):
        ecarts.append(f"schéma : {reference.get('schema')} sauvegardé, {actuel.get('schema')} restauré")
    for nom, valeur in reference.get("comptes", {}).items():
        if actuel["comptes"].get(nom) != valeur:
            ecarts.append(f"{nom} : {valeur} sauvegardés, {actuel['comptes'].get(nom)} restaurés")
    if reference.get("objets") != actuel.get("objets"):
        ecarts.append(f"objets : {reference.get('objets')} sauvegardés, {actuel.get('objets')} restaurés")
    return ecarts


def journaliser_restauration(reference: dict) -> None:
    """La base restaurée ne connaît pas sa propre restauration : on l'y inscrit."""
    from . import journal

    db = get_session_factory()()
    try:
        journal.inscrire(db, "restauration", journal.SUCCES,
                         details={"sauvegarde_du": reference.get("date"), "schema": reference.get("schema")})
        db.commit()
    finally:
        db.close()


def main(argv: list[str]) -> int:
    commande = argv[0] if argv else ""
    debut = time.monotonic()
    if commande == "inventaire":
        print(json.dumps(inventaire(), ensure_ascii=False, indent=2))
    elif commande == "exporter-objets":
        n = exporter_objets(sys.stdout.buffer)
        print(f"{n} objets exportés en {time.monotonic() - debut:.1f} s", file=sys.stderr)
    elif commande == "importer-objets":
        n = importer_objets(sys.stdin.buffer)
        print(f"{n} objets restaurés en {time.monotonic() - debut:.1f} s", file=sys.stderr)
    elif commande == "verifier":
        manquantes = verifier()
        for cle in manquantes:
            print(f"absent du stockage : {cle}", file=sys.stderr)
        print(json.dumps({"fichiers_manquants": len(manquantes)}))
        return 1 if manquantes else 0
    elif commande == "comparer":
        ecarts = comparer(json.load(sys.stdin), inventaire())
        for e in ecarts:
            print(f"écart : {e}", file=sys.stderr)
        print(json.dumps({"ecarts": len(ecarts)}))
        return 1 if ecarts else 0
    elif commande == "journaliser-restauration":
        journaliser_restauration(json.load(sys.stdin))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
