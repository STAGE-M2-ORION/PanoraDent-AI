"""PanoraDent → jeux YOLO « panoradent » et « combine » (modèle d'anomalies seulement).

Les modèles « dents » et « rangs » ne sont pas concernés : ils restent sur
DENTEX, dont la numérotation est experte (celle de PanoraDent est dérivée
d'un détecteur). Décisions : training/class_mapping.md.

Étapes, avec les conventions de prepare_dataset.py :

1. lecture, classes non cibles écartées ;
2. retrait des clichés sans boîte (à la source, ou après l'écart des classes) ;
3. doublons au pixel près retirés ; tout cliché identique au pixel près, ou
   proche (dHash 256 bits, distance ≤ 40), d'un cliché DENTEX — test officiel
   compris — est retiré ;
4. découpage 70/15/15 stratifié sur la classe la plus rare, graine 42, groupes
   de clichés identiques jamais séparés ; empreinte conservée ;
5. jeu `panoradent` : 7 classes, boîtes d'origine ;
6. jeu `combine` : DENTEX `anomalies` (même découpage que le modèle actuel,
   carie profonde → carie) + PanoraDent converti (choix A1, voir panoradent.py),
   sur les 3 classes communes (choix B1) ;
7. vues par domaine `combine-dentex` et `combine-panoradent` (validation et
   test de chaque origine, pour mesurer le décalage Turquie / Bangladesh) ;
8. rapport `rapport_panoradent.md`.

    python training/prepare_panoradent.py --source data/panoradent-source/PanoraDent --out data/yolo
"""
import argparse
import csv
import hashlib
import json
import statistics
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

import panoradent as pd_
from config import CLASSES_COMBINE, CLASSES_PANORADENT, git_commit
from decoupage import PARTITIONS, decouper, effectifs, empreinte_decoupage, tableau
from prepare_dataset import deposer_image, ecrire_data_yaml, restaurer, vider_jeu

SEUIL_DHASH = 40          # sur 256 bits ; PanoraDent a inspecté ses paires ≤ 40
CONF_DENTS = 0.25         # seuil d'affichage des dents dans le service


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", type=Path, default=Path("data/panoradent-source/PanoraDent"))
    p.add_argument("--out", type=Path, default=Path("data/yolo"))
    p.add_argument("--dents", type=Path, default=Path("runs/dents-v1/weights/best.pt"),
                   help="modèle des dents servant à la conversion A1")
    p.add_argument("--imgsz", type=int, default=1024)
    p.add_argument("--graine", type=int, default=42)
    p.add_argument("--ratios", type=float, nargs=3, default=(0.70, 0.15, 0.15))
    p.add_argument("--processus", type=int, default=6)
    p.add_argument("--copier", action="store_true", help="copier les images au lieu de liens physiques")
    return p.parse_args(argv)


# --- Signatures d'image --------------------------------------------------------

def signature(chemin: str) -> tuple[str, str]:
    """Empreinte exacte des pixels (comme dentex.empreinte_pixels) et dHash 256 bits."""
    import cv2
    img = cv2.imread(chemin, cv2.IMREAD_GRAYSCALE)
    exacte = hashlib.sha256(img.tobytes() + str(img.shape).encode()).hexdigest()
    petit = cv2.resize(img, (17, 16), interpolation=cv2.INTER_AREA).astype(np.int16)
    return exacte, np.packbits((petit[:, 1:] > petit[:, :-1]).flatten()).tobytes().hex()


def signatures(chemins: list[Path], cache: Path, processus: int) -> dict[str, tuple[str, str]]:
    memoire = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    cle = {str(p): f"{p.resolve()}|{p.stat().st_size}|{p.stat().st_mtime_ns}" for p in chemins}
    a_faire = [p for p in chemins if cle[str(p)] not in memoire]
    if a_faire:
        print(f"  signatures : {len(a_faire)} images à lire")
        with ProcessPoolExecutor(processus) as ex:
            for p, s in zip(a_faire, ex.map(signature, [str(p) for p in a_faire], chunksize=8)):
                memoire[cle[str(p)]] = list(s)
        cache.write_text(json.dumps(memoire), encoding="utf-8")
    return {str(p): tuple(memoire[cle[str(p)]]) for p in chemins}


def _bits(h: str) -> np.ndarray:
    return np.unpackbits(np.frombuffer(bytes.fromhex(h), dtype=np.uint8))


def proches(a: list[str], b: list[str], seuil: int) -> np.ndarray:
    """Indices i des dHash de `a` à distance ≤ seuil d'au moins un dHash de `b`."""
    if not a or not b:
        return np.zeros(len(a), dtype=bool)
    A, B = np.stack([_bits(h) for h in a]), np.stack([_bits(h) for h in b])
    return ((A[:, None, :] != B[None, :, :]).sum(-1) <= seuil).any(1)


# --- Nettoyage et découpage ------------------------------------------------------

def nettoyer(cliches, sig, sig_dentex, journal: Counter):
    gardes = []
    for c in cliches:
        if c.vide_a_la_source:
            journal["clichés sans aucune boîte à la source, écartés"] += 1
        elif not c.boites:
            journal["clichés sans boîte après l'écart des classes non cibles, écartés"] += 1
        else:
            gardes.append(c)
    vus, uniques = set(), []
    for c in sorted(gardes, key=lambda c: c.nom):
        e = sig[str(c.image)][0]
        if e in vus:
            journal["doublons au pixel près, écartés"] += 1
            continue
        vus.add(e)
        uniques.append(c)
    exactes_dx = {s[0] for s in sig_dentex.values()}
    proche = proches([sig[str(c.image)][1] for c in uniques], [s[1] for s in sig_dentex.values()], SEUIL_DHASH)
    finaux = []
    for c, p in zip(uniques, proche):
        if sig[str(c.image)][0] in exactes_dx:
            journal["clichés identiques à un cliché DENTEX, écartés"] += 1
        elif p:
            journal[f"clichés proches d'un cliché DENTEX (dHash ≤ {SEUIL_DHASH}), écartés"] += 1
        else:
            finaux.append(c)
    for c in cliches:
        for source, n in c.ecartees.items():
            journal[f"boîtes « {source} » écartées (classe non cible)"] += n
    return finaux


# --- Dents détectées (conversion A1) ------------------------------------------------

def dents_detectees(cliches, poids: Path, imgsz: int, cache: Path) -> dict[str, list[list[float]]]:
    empreinte_poids = hashlib.sha256(poids.read_bytes()).hexdigest()
    memoire = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    if memoire.get("poids") != empreinte_poids or memoire.get("imgsz") != imgsz:
        memoire = {"poids": empreinte_poids, "imgsz": imgsz, "conf": CONF_DENTS, "dents": {}}
    a_faire = [c for c in cliches if c.nom not in memoire["dents"]]
    if a_faire:
        from ultralytics import YOLO
        modele = YOLO(str(poids))
        print(f"  dents : {len(a_faire)} clichés à analyser avec {poids}")
        for i, c in enumerate(a_faire, 1):
            r = modele.predict(str(c.image), imgsz=imgsz, conf=CONF_DENTS, verbose=False)[0]
            memoire["dents"][c.nom] = [[x0, y0, x1 - x0, y1 - y0] for x0, y0, x1, y1 in r.boxes.xyxy.tolist()]
            if i % 100 == 0:
                print(f"    {i}/{len(a_faire)}")
                cache.write_text(json.dumps(memoire), encoding="utf-8")
        cache.write_text(json.dumps(memoire), encoding="utf-8")
    return memoire["dents"]


def controle_dents(cliches, dents: dict) -> dict:
    """Qualité du modèle des dents sur PanoraDent, mesurée sur les classes que
    PanoraDent encadre déjà sur la dent entière : IoU avec la dent détectée la plus proche."""
    out = {}
    for classe in ("endodontic_treatment", "impacted_tooth"):
        ious = []
        for c in cliches:
            px = dents.get(c.nom, [])
            for b in c.boites:
                if b.classe == classe:
                    cible = [b.x * c.largeur, b.y * c.hauteur, b.w * c.largeur, b.h * c.hauteur]
                    ious.append(max((pd_.iou(cible, d) for d in px), default=0.0))
        out[classe] = {"boites": len(ious), "iou_mediane": round(statistics.median(ious), 3) if ious else None,
                       "part_iou_0_50": round(sum(i >= 0.5 for i in ious) / len(ious), 3) if ious else None}
    return out


# --- Écriture -------------------------------------------------------------------------

def ecrire_split(dossier: Path, signature_: str, args, jeu: str, bilan: dict, liste: dict, extra: dict):
    (dossier / "split.json").write_text(json.dumps({
        "empreinte": signature_, "graine": args.graine, "ratios": dict(zip(PARTITIONS, args.ratios)),
        "jeu": jeu, "git_commit": git_commit(), "effectifs": bilan,
        "cliches": {p: sorted(v) for p, v in liste.items()}, **extra,
    }, indent=1, ensure_ascii=False), encoding="utf-8")


def ecrire_image(source: Path, nom: str, lignes: list[str], dossier: Path, copier: bool):
    for sous in ("images", "labels"):
        (dossier / sous).mkdir(parents=True, exist_ok=True)
    deposer_image(source, dossier / "images" / f"{nom}{source.suffix}", copier)
    (dossier / "labels" / f"{nom}.txt").write_text("\n".join(lignes) + ("\n" if lignes else ""), encoding="utf-8")


def jeu_panoradent(cliches, affectation, sig, args) -> dict:
    dossier = args.out / "panoradent"
    groupes = {c.nom: sig[str(c.image)][0] for c in cliches}
    signature_ = empreinte_decoupage(affectation, args.graine, args.ratios)
    gardes = vider_jeu(dossier, signature_)
    par_cliche, liste = {}, {p: [] for p in PARTITIONS}
    for c in cliches:
        p = affectation[groupes[c.nom]]
        nom = f"panoradent__{Path(c.nom).stem}"
        ecrire_image(c.image, nom, [pd_.ligne_yolo(CLASSES_PANORADENT.index(b.classe), b) for b in c.boites],
                     dossier / p, args.copier)
        par_cliche[nom] = Counter(b.classe for b in c.boites)
        liste[p].append(nom)
    bilan = effectifs(par_cliche, {n: p for p, ns in liste.items() for n in ns})
    ecrire_data_yaml(dossier, noms=CLASSES_PANORADENT, note="PanoraDent (CC BY 4.0), 7 classes cibles, boîtes d'origine.")
    restaurer(dossier, gardes)
    ecrire_split(dossier, signature_, args, "panoradent", bilan, liste, {
        "groupes": {"definition": "clichés identiques au pixel près", "affectation": affectation},
        "lots": dict(Counter(c.lot for c in cliches))})
    return {"bilan": bilan, "empreinte": signature_, "liste": liste}


def lignes_dentex(fichier: Path, noms_dentex: list[str]) -> list[str]:
    out = []
    for ligne in fichier.read_text(encoding="utf-8").splitlines() if fichier.exists() else []:
        if not ligne.strip():
            continue
        c, *reste = ligne.split()
        cible = pd_.DENTEX_VERS_COMBINE.get(noms_dentex[int(c)])
        if cible:
            out.append(" ".join([str(CLASSES_COMBINE.index(cible)), *reste]))
    return out


def jeu_combine(cliches, affectation, sig, dents, args, journal: Counter) -> dict:
    dentex_dir = args.out / "anomalies"
    split_dx = json.loads((dentex_dir / "split.json").read_text(encoding="utf-8"))
    noms_dx = json.loads(next(l for l in (dentex_dir / "data.yaml").read_text(encoding="utf-8").splitlines()
                              if l.startswith("names:")).split(":", 1)[1])
    conversions = {}
    for c in cliches:
        conv = pd_.convertir(c, dents.get(c.nom, []))
        for k, n in conv.non_rattachees.items():
            journal[f"conversion A1 : « {k} » sans dent hôte"] += n
        for k, n in conv.fusionnees.items():
            journal[f"conversion A1 : « {k} » réunies sur une dent déjà encadrée"] += n
        if conv.non_rattachees:
            journal["conversion A1 : clichés écartés du jeu combiné (anomalie sans dent)"] += 1
            continue
        if not conv.boites:
            journal["jeu combiné : clichés PanoraDent sans carie, lésion ni inclusion (négatifs gardés)"] += 1
        conversions[c.nom] = (c, conv)

    # Part DENTEX : les clichés tels que prepare_dataset.py les a rangés (même
    # partition que pour anomalies-v1, donc comparaison sur les mêmes images).
    images_dx = {p: sorted((dentex_dir / p / "images").iterdir()) for p in PARTITIONS}
    affect = {}
    for p in PARTITIONS:
        for image in images_dx[p]:
            affect[image.stem] = p
    groupes = {c.nom: sig[str(c.image)][0] for c in cliches}
    for nom, (c, _) in conversions.items():
        affect[f"panoradent__{Path(nom).stem}"] = affectation[groupes[nom]]
    signature_ = empreinte_decoupage(affect, args.graine, args.ratios)

    vues = {"combine": None, "combine-dentex": "dentex", "combine-panoradent": "panoradent"}
    sorties = {}
    for jeu, origine in vues.items():
        dossier = args.out / jeu
        gardes = vider_jeu(dossier, signature_)
        par_cliche, liste = {}, {p: [] for p in PARTITIONS}
        for p in PARTITIONS:
            if origine != "panoradent":
                for image in images_dx[p]:
                    n = image.stem
                    lignes = lignes_dentex(dentex_dir / p / "labels" / f"{n}.txt", noms_dx)
                    ecrire_image(image, n, lignes, dossier / p, args.copier)
                    par_cliche[n] = Counter(CLASSES_COMBINE[int(l.split()[0])] for l in lignes)
                    liste[p].append(n)
            if origine != "dentex":
                for nom, (c, conv) in conversions.items():
                    n = f"panoradent__{Path(nom).stem}"
                    if affect[n] != p:
                        continue
                    ecrire_image(c.image, n, [pd_.ligne_yolo(CLASSES_COMBINE.index(b.classe), b) for b in conv.boites],
                                 dossier / p, args.copier)
                    par_cliche[n] = Counter(b.classe for b in conv.boites)
                    liste[p].append(n)
        bilan = effectifs(par_cliche, {n: p for p, ns in liste.items() for n in ns})
        note = {"combine": "DENTEX + PanoraDent (A1, B1), 3 classes communes.",
                "combine-dentex": "Vue : part DENTEX du jeu combiné (évaluation par domaine).",
                "combine-panoradent": "Vue : part PanoraDent du jeu combiné (évaluation par domaine)."}[jeu]
        ecrire_data_yaml(dossier, noms=CLASSES_COMBINE, note=note)
        restaurer(dossier, gardes)
        ecrire_split(dossier, signature_, args, jeu, bilan, liste, {
            "decoupage_dentex": split_dx["empreinte"], "decoupage_panoradent": empreinte_decoupage(affectation, args.graine, args.ratios),
            "conversion": {"regle": "inference/app/fdi.py (rattachement 0,20, apex prolongé)", "modele_dents": str(args.dents),
                           "conf_dents": CONF_DENTS}})
        sorties[jeu] = {"bilan": bilan}
    return {"bilan": sorties, "empreinte": signature_}


def rapport(journal, controle, pano, combine, args) -> str:
    lignes = ["# Préparation PanoraDent (modèle d'anomalies)", "",
              f"Graine {args.graine}, ratios {tuple(args.ratios)}.", "",
              f"- empreinte du découpage PanoraDent : `{pano['empreinte'][:16]}`",
              f"- empreinte du jeu combiné : `{combine['empreinte'][:16]}`", "",
              "## Écarts et retraits", ""]
    lignes += [f"- {k} : {v}" for k, v in sorted(journal.items())]
    lignes += ["", "## Contrôle du modèle des dents sur PanoraDent", "",
               "IoU entre une boîte PanoraDent qui couvre déjà la dent entière et la dent détectée la plus proche.", "",
               "| classe | boîtes | IoU médiane | part IoU ≥ 0,50 |", "|---|---|---|---|"]
    lignes += [f"| {k} | {v['boites']} | {v['iou_mediane']} | {v['part_iou_0_50']} |" for k, v in controle.items()]
    lignes += ["", "## Jeu `panoradent`", "", "```", tableau(pano["bilan"], CLASSES_PANORADENT), "```", ""]
    for jeu, v in combine["bilan"].items():
        lignes += [f"## Jeu `{jeu}`", "", "```", tableau(v["bilan"], CLASSES_COMBINE), "```", ""]
    return "\n".join(lignes)


def main(argv=None):
    args = _parse_args(argv)
    meta = {r["Image_ID"]: r for r in csv.DictReader(
        open(args.source / "metadata" / "image_metadata.csv", encoding="utf-8"))}
    cliches = pd_.lire(args.source, meta)
    print(f"  {len(cliches)} clichés PanoraDent lus")

    dentex_images = sorted(p for jeu in ("anomalies", "dents", "externe") for part in PARTITIONS
                           if (args.out / jeu / part / "images").exists()
                           for p in (args.out / jeu / part / "images").iterdir())
    if not dentex_images:
        raise SystemExit(f"Aucune image DENTEX sous {args.out} : lancer d'abord prepare_dataset.py.")
    cache = args.source.parent / "signatures.json"
    sig = signatures([c.image for c in cliches] + dentex_images, cache, args.processus)
    sig_dentex = {str(p): sig[str(p)] for p in dentex_images}

    journal = Counter()
    cliches = nettoyer(cliches, sig, sig_dentex, journal)
    groupes = {}
    for c in cliches:
        groupes.setdefault(sig[str(c.image)][0], set()).update(b.classe for b in c.boites)
    affectation = decouper(groupes, tuple(args.ratios), args.graine)

    pano = jeu_panoradent(cliches, affectation, sig, args)
    dents = dents_detectees(cliches, args.dents, args.imgsz, args.source.parent / "dents_detectees.json")
    controle = controle_dents(cliches, dents)
    combine = jeu_combine(cliches, affectation, sig, dents, args, journal)
    texte = rapport(journal, controle, pano, combine, args)
    (args.out / "rapport_panoradent.md").write_text(texte, encoding="utf-8")
    print(texte)


if __name__ == "__main__":
    main()
