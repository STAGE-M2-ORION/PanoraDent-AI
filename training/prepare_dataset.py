"""DENTEX -> jeux YOLO « dents » et « anomalies », plus le test externe.

Décisions du sprint 6 (S6-1), appliquées ici :

- **Deux modèles, deux jeux.** DENTEX encadre *toutes* les dents dans
  `quadrant_enumeration`, mais *seulement les dents malades* dans
  `quadrant-enumeration-disease`. Mélanger les deux apprendrait au modèle que
  les dents non encadrées ne sont pas des dents. Le jeu `dents` ne porte que la
  classe `tooth` (énumération) ; le jeu `anomalies` les quatre diagnostics
  (maladies + validation officielle, même protocole). Les deux gardent la liste
  `CLASSES` entière, dans l'ordre du contrat : l'index appris est l'index
  interprété par le service, sans renumérotation.
- **Un seul découpage pour les deux jeux.** Les ensembles se recouvrent
  (260 clichés communs entre énumération et maladies) : les clichés identiques
  au pixel près, tous ensembles confondus, forment un groupe, et chaque groupe
  va dans une seule partition. Un cliché de test de l'un des modèles n'entraîne
  jamais l'autre.
- **Le test officiel est externe.** Ses 250 clichés (polygones LabelMe) forment
  le jeu `externe`, évalué une seule fois ; tout groupe qui en contient un est
  retiré de l'apprentissage, de la validation et du test interne. Seules les
  correspondances sûres y sont gardées : carie, inclusion, lésion péri-apicale
  (« küretaj » exclu, hypothèse non documentée).
- Les clichés `maladies` sans aucune boîte sont écartés : sains, ou non annotés ?
  On ne peut pas le savoir.

Sortie (`--out`, défaut `data/yolo`) :

    dents/      data.yaml, split.json, {train,val,test}/{images,labels,fdi}
    anomalies/  idem
    rangs/      idem, mêmes clichés que dents ; classe = rang de la dent (1 à 8)
    externe/    data.yaml, split.json, test/{images,labels,fdi}
    rapport_preparation.md

`fdi/<cliché>.json` garde la vérité terrain numérotée (pour le sprint 7).

    python training/prepare_dataset.py --dentex data/dentex --out data/yolo
"""
import argparse
import json
import os
import shutil
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path

import dentex
from config import CLASSES, CLASSES_RANGS, git_commit
from decoupage import PARTITIONS, decouper, effectifs, empreinte_decoupage, tableau

TOOTH = CLASSES.index("tooth")
CHEMINS = {
    "enumeration": ("training_data/quadrant_enumeration/train_quadrant_enumeration.json",
                    "training_data/quadrant_enumeration/xrays"),
    "maladies": ("training_data/quadrant-enumeration-disease/train_quadrant_enumeration_disease.json",
                 "training_data/quadrant-enumeration-disease/xrays"),
    "validation_officielle": ("validation_triple.json",
                              "validation_data/quadrant_enumeration_disease/xrays"),
}
TEST_OFFICIEL = ("test_data/disease/label", "test_data/disease/input")


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dentex", type=Path, default=Path("data/dentex"))
    p.add_argument("--out", type=Path, default=Path("data/yolo"))
    p.add_argument("--ratios", type=float, nargs=3, default=(0.70, 0.15, 0.15),
                   metavar=("TRAIN", "VAL", "TEST"))
    p.add_argument("--graine", type=int, default=42)
    p.add_argument("--copier", action="store_true",
                   help="copier les images au lieu de liens physiques (même disque requis)")
    p.add_argument("--processus", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    return p.parse_args(argv)


# --- Lecture et empreintes ---------------------------------------------------

def lire_tout(racine: Path) -> dict[str, list]:
    ensembles = {nom: dentex.lire_coco(racine / j, racine / i, nom)
                 for nom, (j, i) in CHEMINS.items()}
    ensembles["externe"] = dentex.lire_labelme(racine / TEST_OFFICIEL[0],
                                               racine / TEST_OFFICIEL[1], "externe")
    return ensembles


def empreintes(cliches: list, cache: Path, processus: int) -> dict[str, str]:
    """Empreinte des pixels de chaque image, mise en cache (taille + date)."""
    memoire = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    cle = {c.identifiant: f"{c.image.resolve()}|{c.image.stat().st_size}|{c.image.stat().st_mtime_ns}"
           for c in cliches}
    a_calculer = [c for c in cliches if cle[c.identifiant] not in memoire]
    if a_calculer:
        print(f"  empreintes : {len(a_calculer)} images à lire")
        with ProcessPoolExecutor(processus) as ex:
            for c, e in zip(a_calculer, ex.map(dentex.empreinte_pixels,
                                               [c.image for c in a_calculer], chunksize=8)):
                memoire[cle[c.identifiant]] = e
        cache.write_text(json.dumps(memoire), encoding="utf-8")
    return {c.identifiant: memoire[cle[c.identifiant]] for c in cliches}


# --- Construction des jeux ---------------------------------------------------

def dedoublonner(cliches: list, empreinte: dict) -> tuple[list, int]:
    """Un seul exemplaire par contenu dans un même ensemble (le premier par nom)."""
    vus, gardes = set(), []
    for c in sorted(cliches, key=lambda c: c.nom):
        e = empreinte[c.identifiant]
        if e not in vus:
            vus.add(e)
            gardes.append(c)
    return gardes, len(cliches) - len(gardes)


def classes_du_cliche(c, jeu: str) -> list[int]:
    if jeu == "dents":
        return [TOOTH] * len(c.boites)
    return [CLASSES.index(b.diagnostic) for b in c.boites if b.diagnostic]


def construire(ensembles: dict, empreinte: dict, ratios, graine: int) -> dict:
    """Jeux, groupes et affectation. Pure : aucune écriture sur le disque."""
    journal = Counter()
    dents, n = dedoublonner(ensembles["enumeration"], empreinte)
    journal["doublons écartés (énumération)"] = n

    # Maladies, puis validation officielle : même protocole, même pool. Un
    # cliché présent dans les deux n'est gardé qu'une fois.
    pool, n = dedoublonner(ensembles["maladies"] + ensembles["validation_officielle"], empreinte)
    journal["doublons écartés (maladies + validation officielle)"] = n
    anomalies = [c for c in pool if any(b.diagnostic for b in c.boites)]
    journal["clichés maladies sans aucune boîte, écartés"] = len(pool) - len(anomalies)

    externe = ensembles["externe"]
    groupes_externes = {empreinte[c.identifiant] for c in externe}

    def internes(cliches, nom):
        gardes = [c for c in cliches if empreinte[c.identifiant] not in groupes_externes]
        journal[f"clichés {nom} retirés (présents dans le test officiel)"] = len(cliches) - len(gardes)
        return gardes

    jeux = {"dents": internes(dents, "dents"), "anomalies": internes(anomalies, "anomalies")}

    # Groupe = contenu. Classes d'un groupe : celles de tous ses clichés, des
    # deux jeux, pour que la stratification voie aussi les diagnostics rares.
    classes_groupe = defaultdict(set)
    for nom, cliches in jeux.items():
        for c in cliches:
            classes_groupe[empreinte[c.identifiant]].update(
                CLASSES[i] for i in classes_du_cliche(c, nom))
    affectation = decouper(dict(classes_groupe), ratios, graine)
    # Sprint 7 : jeu « rangs » = mêmes clichés que « dents », chaque dent
    # portant son rang (1 à 8). Ajouté APRÈS le découpage, qui ne change donc
    # pas : les modèles déjà entraînés restent mesurés sur les mêmes clichés.
    jeux["rangs"] = jeux["dents"]
    return {"jeux": jeux, "externe": externe, "affectation": affectation, "journal": journal}


# --- Écriture ----------------------------------------------------------------

def ligne_yolo(classe: int, b) -> str:
    return f"{classe} {b.x + b.w / 2:.6f} {b.y + b.h / 2:.6f} {b.w:.6f} {b.h:.6f}"


def deposer_image(source: Path, cible: Path, copier: bool) -> None:
    if cible.exists():
        return
    if not copier:
        try:
            os.link(source, cible)
            return
        except OSError:
            pass
    shutil.copy2(source, cible)


def classes_du_jeu(jeu: str) -> list[str]:
    return CLASSES_RANGS if jeu == "rangs" else CLASSES


def classe_de(b, jeu: str) -> int | None:
    """Index de classe d'une boîte dans le jeu, ou None si elle n'y figure pas."""
    if jeu == "dents":
        return TOOTH
    if jeu == "rangs":
        return (b.fdi % 10) - 1 if b.fdi else None
    return CLASSES.index(b.diagnostic) if b.diagnostic else None


def ecrire_cliche(c, jeu: str, dossier: Path, copier: bool) -> Counter:
    """Image, étiquettes YOLO et vérité terrain FDI d'un cliché."""
    nom = f"{c.source}__{Path(c.nom).stem}"
    for sous in ("images", "labels", "fdi"):
        (dossier / sous).mkdir(parents=True, exist_ok=True)
    deposer_image(c.image, dossier / "images" / f"{nom}{c.image.suffix}", copier)

    noms = classes_du_jeu(jeu)
    lignes, verite, compte = [], [], Counter()
    for b in c.boites:
        classe = classe_de(b, jeu)
        if classe is None or b.w <= 0 or b.h <= 0:
            continue
        lignes.append(ligne_yolo(classe, b))
        verite.append({**asdict(b), "classe": noms[classe]})
        compte[noms[classe]] += 1
    (dossier / "labels" / f"{nom}.txt").write_text(
        "\n".join(lignes) + ("\n" if lignes else ""), encoding="utf-8")
    (dossier / "fdi" / f"{nom}.json").write_text(json.dumps(
        {"source": c.identifiant, "largeur": c.largeur, "hauteur": c.hauteur, "boites": verite},
        ensure_ascii=False), encoding="utf-8")
    return compte


def ecrire_data_yaml(dossier: Path, train="train/images", val="val/images", test="test/images",
                     note="", noms=CLASSES) -> Path:
    chemin = dossier / "data.yaml"
    chemin.write_text(
        "# Généré par training/prepare_dataset.py — ne pas éditer à la main.\n"
        + (f"# {note}\n" if note else "")
        + f"path: {dossier.resolve().as_posix()}\ntrain: {train}\nval: {val}\ntest: {test}\n"
        f"nc: {len(noms)}\nnames: {json.dumps(noms, ensure_ascii=False)}\n",
        encoding="utf-8")
    return chemin


def ecrire(resultat: dict, empreinte: dict, args) -> dict:
    """Écrit les trois jeux et renvoie leurs effectifs."""
    affectation = resultat["affectation"]
    signature = empreinte_decoupage(affectation, args.graine, args.ratios)
    bilan = {}

    for jeu, cliches in resultat["jeux"].items():
        dossier = args.out / jeu
        if dossier.exists():
            shutil.rmtree(dossier)
        par_groupe, liste = {}, {p: [] for p in PARTITIONS}
        for c in cliches:
            groupe = empreinte[c.identifiant]
            partition = affectation[groupe]
            compte = ecrire_cliche(c, jeu, dossier / partition, args.copier)
            par_groupe[c.identifiant] = compte
            liste[partition].append(c.identifiant)
        affect_jeu = {c.identifiant: affectation[empreinte[c.identifiant]] for c in cliches}
        bilan[jeu] = effectifs(par_groupe, affect_jeu)
        ecrire_data_yaml(dossier, noms=classes_du_jeu(jeu))
        (dossier / "split.json").write_text(json.dumps({
            "empreinte": signature, "graine": args.graine,
            "ratios": dict(zip(PARTITIONS, args.ratios)),
            "jeu": jeu, "git_commit": git_commit(),
            "effectifs": bilan[jeu],
            "cliches": {p: sorted(v) for p, v in liste.items()},
            "groupes": {"definition": "clichés identiques au pixel près, tous ensembles confondus",
                        "affectation": affectation},
        }, indent=1, ensure_ascii=False), encoding="utf-8")

    dossier = args.out / "externe"
    if dossier.exists():
        shutil.rmtree(dossier)
    comptes = {}
    for c in resultat["externe"]:
        comptes[c.identifiant] = ecrire_cliche(c, "anomalies", dossier / "test", args.copier)
    bilan["externe"] = {"boites": {"test": dict(sum(comptes.values(), Counter()))},
                        "groupes": {"test": len(comptes)}}
    ecrire_data_yaml(dossier, train="test/images", val="test/images",
                     note="Test officiel DENTEX, évaluation externe UNIQUEMENT (train/val "
                          "pointent sur test parce qu'ultralytics les exige).")
    (dossier / "split.json").write_text(json.dumps({
        "empreinte": dentex_empreinte_externe(resultat["externe"], empreinte),
        "jeu": "externe", "graine": None, "effectifs": bilan["externe"],
        "exclus": "küretaj (code 2) et codes hors périmètre (sain, canal, extraction, fracture)",
        "cliches": {"test": sorted(comptes)},
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"bilan": bilan, "empreinte": signature}


def dentex_empreinte_externe(cliches, empreinte) -> str:
    return empreinte_decoupage({c.identifiant: "test" for c in cliches}, 0, (0, 0, 1))


def rapport(resultat: dict, sortie: dict, args) -> str:
    lignes = ["# Préparation des jeux DENTEX", "",
              f"Graine {args.graine}, ratios {tuple(args.ratios)}, "
              f"empreinte du découpage `{sortie['empreinte'][:16]}`.", "",
              "## Écarts et retraits", ""]
    lignes += [f"- {k} : {v}" for k, v in resultat["journal"].items()]
    for jeu in ("dents", "anomalies", "rangs"):
        lignes += ["", f"## Jeu `{jeu}`", "", "```", tableau(sortie["bilan"][jeu], classes_du_jeu(jeu)), "```"]
    ext = sortie["bilan"]["externe"]
    lignes += ["", "## Jeu `externe` (test officiel, évalué une seule fois)", "",
               f"{ext['groupes']['test']} clichés ; boîtes : {ext['boites']['test']}.",
               "Polygones ramenés à leur cadre ; küretaj et codes hors périmètre exclus.", ""]
    return "\n".join(lignes)


def main(argv=None):
    args = _parse_args(argv)
    print(f"Lecture de {args.dentex}")
    ensembles = lire_tout(args.dentex)
    tous = [c for cliches in ensembles.values() for c in cliches]
    absentes = [c.identifiant for c in tous if not c.image.exists()]
    if absentes:
        raise SystemExit(f"{len(absentes)} images absentes, ex. {absentes[:3]}")
    empreinte = empreintes(tous, args.dentex / "empreintes_pixels.json", args.processus)
    resultat = construire(ensembles, empreinte, args.ratios, args.graine)
    args.out.mkdir(parents=True, exist_ok=True)
    sortie = ecrire(resultat, empreinte, args)
    texte = rapport(resultat, sortie, args)
    (args.out / "rapport_preparation.md").write_text(texte, encoding="utf-8")
    print(texte)
    print(f"-> {args.out}")


if __name__ == "__main__":
    main()
