"""Téléchargement de DENTEX depuis Hugging Face, vérifié et reproductible.

Le jeu est public (aucun compte requis) et publié sous licence
**CC BY-NC-SA 4.0** : usage académique et non commercial seulement. Les poids
entraînés sur ce jeu héritent de cette restriction.

Trois garanties :

- **révision figée** : on télécharge le commit `REVISION` du dépôt, pas la tête
  de branche ; un jeu republié autrement ne change pas nos données en silence ;
- **intégrité** : chaque archive est contrôlée contre l'empreinte sha256 publiée
  par Hugging Face ; un fichier corrompu est refusé, jamais extrait ;
- **reprise** : un téléchargement interrompu repart de l'octet atteint
  (en-tête `Range`), utile pour l'archive d'entraînement de 10 Go.

    python training/telecharger_dentex.py --dest data/dentex
"""
import argparse
import hashlib
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

DEPOT = "ibrahimhamamci/DENTEX"
REVISION = "7b27ccc8e342dcb774f69adc6ca5e6c09fefce93"
LICENCE = "CC BY-NC-SA 4.0"

#: nom -> (taille en octets, sha256). Empreintes publiées par Hugging Face (LFS).
FICHIERS = {
    "validation_triple.json": (64409, None),
    "validation_data.zip": (
        149512256, "6370bb4f1024bd610cde13242a465cb2eff195fc02f56ac22126555e7edc7bc3"),
    "test_data.zip": (
        764834414, "ed396d6daa133264ddb0ecdbed3f963868d2a31344ba0fab929a6a1773d82ce2"),
    "training_data.zip": (
        10927391529, "18b2a2dbc5a2b10b0cc6a7677c46a382f4709ab8c9c3bb94f57b74e38e11ffd3"),
}

BLOC = 1 << 20


class FichierInvalide(Exception):
    """Taille ou empreinte différente de celle publiée."""


def url_de(nom: str) -> str:
    return f"https://huggingface.co/datasets/{DEPOT}/resolve/{REVISION}/DENTEX/{nom}"


def sha256_de(chemin: Path) -> str:
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(BLOC), b""):
            h.update(bloc)
    return h.hexdigest()


def verifier(chemin: Path, taille: int, empreinte: str | None) -> None:
    """Lève `FichierInvalide` si le fichier ne correspond pas à la publication."""
    if not chemin.exists():
        raise FichierInvalide(f"{chemin.name} : absent")
    reelle = chemin.stat().st_size
    if reelle != taille:
        raise FichierInvalide(f"{chemin.name} : {reelle} octets, {taille} attendus")
    if empreinte and sha256_de(chemin) != empreinte:
        raise FichierInvalide(f"{chemin.name} : empreinte sha256 différente de la publication")


def telecharger(nom: str, dossier: Path) -> Path:
    """Télécharge (ou reprend) un fichier, puis le vérifie."""
    taille, empreinte = FICHIERS[nom]
    cible = dossier / nom
    deja = cible.stat().st_size if cible.exists() else 0

    if deja == taille:
        verifier(cible, taille, empreinte)
        print(f"  {nom} : déjà présent et vérifié")
        return cible
    if deja > taille:
        cible.unlink()
        deja = 0

    requete = urllib.request.Request(url_de(nom), headers={"User-Agent": "panoradent-training"})
    if deja:
        requete.add_header("Range", f"bytes={deja}-")
        print(f"  {nom} : reprise à {deja / 1e6:.0f} Mo sur {taille / 1e6:.0f}")
    else:
        print(f"  {nom} : {taille / 1e6:.0f} Mo")

    with urllib.request.urlopen(requete, timeout=60) as reponse:
        # Un serveur qui ignore Range renvoie 200 et le fichier entier.
        mode = "ab" if deja and reponse.status == 206 else "wb"
        with cible.open(mode) as f:
            shutil.copyfileobj(reponse, f, BLOC)

    verifier(cible, taille, empreinte)
    return cible


def extraire(archive: Path, dest: Path) -> Path:
    """Extrait une archive vérifiée dans `dest/<nom de l'archive>`.

    L'archive de test a pour racine `disease/`, celle d'entraînement
    `training_data/` : on range chacune sous son propre nom pour qu'on ne
    confonde jamais les deux. Sautée si le dossier existe déjà.
    """
    with zipfile.ZipFile(archive) as z:
        racines = {n.split("/", 1)[0] for n in z.namelist()}
        cible = dest if racines == {archive.stem} else dest / archive.stem
        for membre in z.namelist():
            # Garde contre les chemins sortant du dossier (« zip slip »).
            if not (cible / membre).resolve().is_relative_to(cible.resolve()):
                raise FichierInvalide(f"{archive.name} : chemin suspect {membre!r}")
        dossier = dest / archive.stem
        if dossier.exists():
            print(f"  {archive.name} : déjà extraite")
            return dossier
        print(f"  {archive.name} : extraction")
        z.extractall(cible)
        return dossier


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dest", type=Path, default=Path("data/dentex"))
    p.add_argument("--sans-entrainement", action="store_true",
                   help="ne pas télécharger training_data.zip (10 Go)")
    args = p.parse_args(argv)

    brut = args.dest / "raw"
    brut.mkdir(parents=True, exist_ok=True)
    print(f"DENTEX ({DEPOT}@{REVISION[:7]}), licence {LICENCE} : usage académique seulement.")

    noms = [n for n in FICHIERS if not (args.sans_entrainement and n == "training_data.zip")]
    try:
        for nom in noms:
            chemin = telecharger(nom, brut)
            if chemin.suffix == ".zip":
                extraire(chemin, args.dest)
    except FichierInvalide as e:
        sys.exit(f"Refusé : {e}. Supprimer le fichier et relancer.")
    shutil.copy2(brut / "validation_triple.json", args.dest / "validation_triple.json")
    print(f"-> {args.dest}")


if __name__ == "__main__":
    main()
