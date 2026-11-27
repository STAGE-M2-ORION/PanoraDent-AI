"""Exactitude de la numérotation FDI, de bout en bout (sprint 7).

Ce que l'application fait réellement : le modèle détecte les dents (et, pour
un modèle « rangs », leur rang), la règle du service d'inférence
(`inference/app/fdi.py`) les numérote, puis chaque anomalie hérite du numéro
de la dent qui la porte. On compare à la vérité terrain FDI conservée à la
préparation (`<jeu>/<partition>/fdi/*.json`).

Mesures :

- **dents** : part des dents de la vérité retrouvées (IoU ≥ 0,50), puis part
  de celles-ci qui portent le bon numéro, globalement, par rang et par
  quadrant ; doublons et incohérences signalés par la règle ;
- **anomalies** : sur les clichés du jeu « anomalies », les dents sont
  détectées et numérotées, puis chaque anomalie de la vérité terrain est
  rattachée : part qui reçoit le bon numéro, part non rattachée ;
- `--oracle` : boîtes ET rangs de la vérité terrain — le plafond de la règle.

**Le test ne se mesure qu'une fois** (registre `mesures_numerotation_test.jsonl`
dans le jeu « rangs ») ; les réglages se font sur la validation.

    python training/mesure_numerotation.py --modele runs/rangs-v1/weights/best.pt --split val
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from config import REPO_ROOT, git_commit

sys.path.insert(0, str(REPO_ROOT / "inference"))
from app.fdi import numeroter  # noqa: E402  (la règle du service, telle quelle)

SEUIL_IOU = 0.50
REGISTRE = "mesures_numerotation_test.jsonl"


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--modele", type=Path, help="poids du modèle dents (rangs ou ancien)")
    p.add_argument("--oracle", action="store_true", help="boîtes et rangs de la vérité terrain")
    p.add_argument("--split", choices=("val", "test"), default="val")
    p.add_argument("--donnees", type=Path, default=Path("data/yolo"))
    p.add_argument("--imgsz", type=int, default=None, help="défaut : celle des poids")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--device", default="cpu")
    p.add_argument("--nms-agnostique", action="store_true",
                   help="supprimer les cadres superposés toutes classes confondues (rangs : une dent, un cadre)")
    p.add_argument("--forcer", default=None, metavar="MOTIF", help="re-mesurer le test (motif)")
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args(argv)
    if not args.oracle and args.modele is None:
        p.error("--modele est obligatoire, sauf avec --oracle")
    return args


def iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def lire_verite(fichier: Path):
    v = json.loads(fichier.read_text(encoding="utf-8"))
    W, H = v["largeur"], v["hauteur"]
    return W, H, [{"bbox": [b["x"] * W, b["y"] * H, b["w"] * W, b["h"] * H], "fdi": b["fdi"],
                   "classe": b["classe"]} for b in v["boites"]]


class Detecteur:
    """Dents détectées par le modèle, au format du service d'inférence."""

    def __init__(self, poids: Path, imgsz, conf, device, agnostique: bool = False):
        from ultralytics import YOLO
        sys.path.insert(0, str(REPO_ROOT / "inference"))
        from app.model import classe_et_rang, noms_des_classes
        self.modele = YOLO(str(poids))
        self.noms = noms_des_classes(self.modele)
        self.classe_et_rang = classe_et_rang
        self.imgsz = imgsz or int((self.modele.overrides or {}).get("imgsz") or 640)
        self.conf, self.device, self.agnostique = conf, device, agnostique

    def dents(self, image: Path) -> list[dict]:
        r = self.modele.predict(str(image), imgsz=self.imgsz, conf=self.conf, device=self.device,
                                agnostic_nms=self.agnostique, verbose=False)[0]
        out = []
        for (x1, y1, x2, y2), c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
            label, rang = self.classe_et_rang(self.noms[int(k)])
            if label != "tooth":
                continue
            d = {"label": "tooth", "confidence": float(c), "bbox": [x1, y1, x2 - x1, y2 - y1]}
            if rang is not None:
                d["rang"] = rang
            out.append(d)
        return out


def dents_oracle(verite: list[dict]) -> list[dict]:
    return [{"label": "tooth", "confidence": 1.0, "bbox": list(v["bbox"]), "rang": v["fdi"] % 10}
            for v in verite]


def apparier(verite: list[dict], dets: list[dict]) -> list[tuple[dict, dict]]:
    """Chaque dent de la vérité avec la détection qui la recouvre le plus (IoU ≥ 0,5, une fois)."""
    paires = sorted(((iou(v["bbox"], d["bbox"]), i, j) for i, v in enumerate(verite)
                     for j, d in enumerate(dets)), reverse=True)
    prises_v, prises_d, out = set(), set(), []
    for valeur, i, j in paires:
        if valeur < SEUIL_IOU:
            break
        if i in prises_v or j in prises_d:
            continue
        prises_v.add(i)
        prises_d.add(j)
        out.append((verite[i], dets[j]))
    return out


def _part(n, d):
    return round(n / d, 4) if d else None


def mesurer_dents(dossier: Path, detecteur, oracle: bool) -> dict:
    total = retrouvees = justes = cliches = parfaits = 0
    par_rang, par_quadrant = defaultdict(Counter), defaultdict(Counter)
    signales = Counter()
    for f in sorted((dossier / "fdi").glob("*.json")):
        W, H, verite = lire_verite(f)
        dets = dents_oracle(verite) if oracle else detecteur.dents(dossier / "images" / f"{f.stem}.png")
        for s in numeroter(dets, W, H):
            signales[s["type"]] += 1
        paires = apparier(verite, dets)
        ok = sum(1 for v, d in paires if d["fdi"] == v["fdi"])
        total += len(verite)
        retrouvees += len(paires)
        justes += ok
        cliches += 1
        parfaits += ok == len(verite)
        for v, d in paires:
            bon = d["fdi"] == v["fdi"]
            par_rang[v["fdi"] % 10]["juste" if bon else "fausse"] += 1
            par_quadrant[v["fdi"] // 10]["juste" if bon else "fausse"] += 1
    return {
        "dents_verite": total, "dents_retrouvees": retrouvees,
        "detection": _part(retrouvees, total),
        "numerotation": _part(justes, retrouvees),          # parmi les dents retrouvées
        "bout_en_bout": _part(justes, total),               # parmi toutes les dents de la vérité
        "cliches": cliches, "cliches_sans_erreur": parfaits,
        "par_rang": {r: _part(c["juste"], c["juste"] + c["fausse"]) for r, c in sorted(par_rang.items())},
        "par_quadrant": {q: _part(c["juste"], c["juste"] + c["fausse"]) for q, c in sorted(par_quadrant.items())},
        "incoherences": dict(signales),
    }


def mesurer_anomalies(dossier: Path, detecteur, oracle: bool) -> dict | None:
    """Sur le jeu anomalies : la vérité n'y encadre pas toutes les dents, donc
    pas d'oracle possible ; avec le modèle, chaque anomalie vraie est rattachée."""
    if oracle or not (dossier / "fdi").is_dir():
        return None
    compte, par_classe = Counter(), defaultdict(Counter)
    for f in sorted((dossier / "fdi").glob("*.json")):
        W, H, verite = lire_verite(f)
        dents = detecteur.dents(dossier / "images" / f"{f.stem}.png")
        anomalies = [{"label": v["classe"], "confidence": 1.0, "bbox": list(v["bbox"])} for v in verite]
        numeroter(dents + anomalies, W, H)
        for v, a in zip(verite, anomalies):
            verdict = "non_rattachee" if a["fdi"] is None else ("juste" if a["fdi"] == v["fdi"] else "fausse")
            compte[verdict] += 1
            par_classe[v["classe"]][verdict] += 1
    n = sum(compte.values())
    return {"anomalies": n, "justes": _part(compte["juste"], n), "fausses": _part(compte["fausse"], n),
            "non_rattachees": _part(compte["non_rattachee"], n),
            "par_classe": {c: _part(k["juste"], sum(k.values())) for c, k in sorted(par_classe.items())}}


def verifier_test_unique(dossier_jeu: Path, forcer):
    registre = dossier_jeu / REGISTRE
    if registre.exists() and registre.read_text(encoding="utf-8").strip() and not forcer:
        raise SystemExit("La numérotation a déjà été mesurée sur le test de ce découpage : une seconde "
                         "mesure n'est plus indépendante. Mesurer sur la validation, ou --forcer \"<motif>\".")


def rapport(m: dict) -> str:
    d = m["dents"]
    lignes = [f"# Numérotation FDI — partition `{m['split']}`{' (oracle)' if m['oracle'] else ''}", "",
              f"- Modèle : `{m['modele']}`", f"- Date : {m['date_utc']} ; commit `{m['git_commit']}`",
              f"- Confiance minimale : {m.get('seuil_confiance')} ; cadres superposés supprimés toutes classes "
              f"confondues : {'oui' if m.get('nms_agnostique') else 'non'}", "",
              "| | |", "|---|---|",
              f"| Dents de la vérité retrouvées | {d['dents_retrouvees']} / {d['dents_verite']} |",
              f"| **Bien numérotées** (parmi les retrouvées) | **{d['numerotation']}** |",
              f"| Bien numérotées (parmi toutes) | {d['bout_en_bout']} |",
              f"| Clichés sans aucune erreur | {d['cliches_sans_erreur']} / {d['cliches']} |",
              f"| Incohérences signalées | {d['incoherences'] or 'aucune'} |", "",
              "Par rang : " + ", ".join(f"{r} → {v}" for r, v in d["par_rang"].items()), "",
              "Par quadrant : " + ", ".join(f"{q} → {v}" for q, v in d["par_quadrant"].items()), ""]
    a = m.get("anomalies")
    if a:
        lignes += ["## Anomalies : bon numéro de dent", "",
                   f"{a['anomalies']} anomalies — justes {a['justes']}, fausses {a['fausses']}, "
                   f"non rattachées {a['non_rattachees']}.", "",
                   "Par classe : " + ", ".join(f"{c} → {v}" for c, v in a["par_classe"].items()), ""]
    return "\n".join(lignes)


def mesurer(args) -> Path:
    if args.split == "test":
        verifier_test_unique(args.donnees / "rangs", args.forcer)
    detecteur = None if args.oracle else Detecteur(args.modele, args.imgsz, args.conf, args.device,
                                                   agnostique=args.nms_agnostique)
    m = {
        "date_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(), "split": args.split, "oracle": args.oracle,
        "modele": "vérité terrain" if args.oracle else str(args.modele),
        "seuil_iou": SEUIL_IOU, "seuil_confiance": None if args.oracle else args.conf,
        "nms_agnostique": bool(args.nms_agnostique),
        "dents": mesurer_dents(args.donnees / "dents" / args.split, detecteur, args.oracle),
        "anomalies": mesurer_anomalies(args.donnees / "anomalies" / args.split, detecteur, args.oracle),
        "motif_remesure": args.forcer,
    }
    defaut = (args.modele.parent.parent if args.modele else args.donnees) / \
        f"numerotation_{args.split}{'_oracle' if args.oracle else ''}"
    sortie = args.out or defaut
    sortie.mkdir(parents=True, exist_ok=True)
    (sortie / "metrics.json").write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    (sortie / "rapport.md").write_text(rapport(m), encoding="utf-8")
    if args.split == "test" and not args.oracle:
        with (args.donnees / "rangs" / REGISTRE).open("a", encoding="utf-8") as f:
            f.write(json.dumps({"date_utc": m["date_utc"], "modele": m["modele"], "motif": args.forcer}) + "\n")
    return sortie


def main(argv=None):
    sortie = mesurer(_parse_args(argv))
    print((sortie / "rapport.md").read_text(encoding="utf-8"))
    print(f"-> {sortie}")


if __name__ == "__main__":
    main()
