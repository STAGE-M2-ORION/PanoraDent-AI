"""Rapport d'évaluation d'une version (paire dents + anomalies), pour le mémoire.

Assemble, sans rien recalculer, ce que la chaîne a déjà produit :

- données et découpage : source, licence, graine, empreinte, effectifs ;
- entraînement de chaque modèle : réglages, carte, durée, époques, meilleure
  époque, courbes (pertes d'apprentissage, mAP@0,50 de validation) ;
- test interne de chaque modèle : mesures par classe puis globales, matrice de
  confusion, pires erreurs ;
- test externe (test officiel DENTEX) s'il a été évalué ;
- limites, écrites une fois pour toutes.

    python training/rapport_evaluation.py --version dentex-2026.11 \\
        --dents runs/dents-v1 --anomalies runs/anomalies-v1

Sortie : docs/evaluation/<version>/rapport.md et ses figures.
"""
import argparse
import json
import shutil
from pathlib import Path

from config import CLASSES, REPO_ROOT

LIBELLES = {"tooth": "Dent", "caries": "Carie", "deep_caries": "Carie profonde",
            "periapical_lesion": "Lésion péri-apicale", "impacted_tooth": "Dent incluse",
            **{f"dent_{k}": f"Dent de rang {k}" for k in range(1, 9)}}


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", required=True)
    p.add_argument("--dents", type=Path, required=True)
    p.add_argument("--anomalies", type=Path, required=True)
    p.add_argument("--out", type=Path, default=None, help="défaut : docs/evaluation/<version>")
    return p.parse_args(argv)


def lire_json(chemin: Path):
    return json.loads(chemin.read_text(encoding="utf-8")) if chemin.is_file() else None


def lire_journal(run_dir: Path) -> list[dict]:
    chemin = run_dir / "journal.jsonl"
    if not chemin.is_file():
        return []
    return [json.loads(l) for l in chemin.read_text(encoding="utf-8").splitlines() if l.strip()]


def meilleure_epoque(journal: list[dict]) -> dict | None:
    notees = [l for l in journal if l.get("fitness") is not None]
    return max(notees, key=lambda l: l["fitness"]) if notees else None


def nombre(v, chiffres=3) -> str:
    return "—" if v is None else f"{v:.{chiffres}f}".replace(".", ",")


def duree(secondes) -> str:
    if not secondes:
        return "—"
    h, m = divmod(round(secondes / 60), 60)
    return f"{h} h {m:02d}" if h else f"{m} min"


def courbes(journal: list[dict], sortie: Path, titre: str) -> Path | None:
    """Pertes d'apprentissage et mAP@0,50 de validation, époque par époque."""
    if not journal:
        return None
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    epoques = [l["epoque"] for l in journal]
    fig, (a, b) = plt.subplots(1, 2, figsize=(10, 3.6))
    for cle, nom in (("train/box_loss", "boîtes"), ("train/cls_loss", "classes"), ("train/dfl_loss", "DFL")):
        a.plot(epoques, [l["pertes"].get(cle) for l in journal], label=nom)
    a.set_title("Pertes d'apprentissage")
    a.set_xlabel("époque")
    a.legend()
    b.plot(epoques, [l["mesures"].get("metrics/mAP50(B)") for l in journal], color="#0072B2")
    b.set_title("mAP@0,50 sur la validation")
    b.set_xlabel("époque")
    b.set_ylim(0, 1)
    fig.suptitle(titre)
    fig.tight_layout()
    fig.savefig(sortie, dpi=150)
    plt.close(fig)
    return sortie


def tableau_classes(metrics: dict) -> list[str]:
    detection = metrics["detection"]
    image = metrics.get("niveau_image", {}).get("par_classe", {})
    lignes = ["| Classe | Instances | Précision | Rappel | mAP@0,50 | mAP@0,50:0,95 | Sensibilité (cliché) | Spécificité (cliché) |",
              "|---|---|---|---|---|---|---|---|"]
    for nom in metrics.get("classes") or CLASSES:
        d = detection.get("par_classe", {}).get(nom)
        if d is None:
            continue
        i = image.get(nom, {})
        lignes.append(f"| {LIBELLES[nom]} | {d.get('instances', '—')} | {nombre(d['precision'])} | "
                      f"{nombre(d['rappel'])} | {nombre(d['mAP50'])} | {nombre(d['mAP50_95'])} | "
                      f"{nombre(i.get('sensibilite'))} | {nombre(i.get('specificite'))} |")
    g = detection["global"]
    lignes.append(f"| **Global** | | {nombre(g['precision'])} | {nombre(g['rappel'])} | "
                  f"{nombre(g['mAP50'])} | {nombre(g['mAP50_95'])} | | |")
    return lignes


def section_modele(nom: str, run_dir: Path, sortie: Path) -> list[str]:
    run = lire_json(run_dir / "run.json") or {}
    journal = lire_journal(run_dir)
    meilleure = meilleure_epoque(journal)
    hyp = run.get("hyperparametres", {})
    versions = run.get("versions", {})
    temps = sum(l.get("duree_s") or 0 for l in journal)
    lignes = [f"## Modèle « {nom} »", "",
              "| | |", "|---|---|",
              f"| Modèle de départ | `{run.get('modele_initial', '—')}` (préentraîné COCO) |",
              f"| Taille d'image · lot | {hyp.get('imgsz', '—')} px · {hyp.get('batch', '—')} |",
              f"| Précision mixte | {'oui' if hyp.get('amp') else 'non'} |",
              f"| Carte · versions | {versions.get('carte') or 'processeur'} · ultralytics {versions.get('ultralytics', '—')}, torch {versions.get('torch', '—')} |",
              f"| Époques réalisées | {len(journal)} sur {hyp.get('epochs', '—')} (arrêt anticipé après {hyp.get('patience', '—')} sans progrès) |",
              f"| Meilleure époque | {meilleure['epoque'] if meilleure else '—'} (mAP@0,50 de validation {nombre((meilleure or {}).get('mesures', {}).get('metrics/mAP50(B)'))}) |",
              f"| Durée d'entraînement | {duree(temps)} |",
              f"| Reprises après interruption | {len(run.get('reprises', []))} |",
              f"| Commit | `{run.get('git_commit', '—')}` |", ""]
    figure = courbes(journal, sortie / f"courbes_{nom}.png", f"Modèle « {nom} »")
    if figure:
        lignes += [f"![Courbes d'apprentissage du modèle « {nom} »]({figure.name})", ""]

    test = lire_json(run_dir / "evaluation_test" / "metrics.json")
    if test is None:
        lignes += ["> Test interne non évalué.", ""]
        return lignes
    lignes += [f"### Test interne ({test.get('niveau_image', {}).get('n_images', '—')} clichés, évalué une fois)", ""]
    lignes += tableau_classes(test) + [""]
    for fichier, legende in (("confusion.png", "Matrice de confusion"), ("pires_erreurs.jpg", "Pires erreurs")):
        source = run_dir / "evaluation_test" / fichier
        if source.is_file():
            cible = sortie / f"{nom}_{fichier}"
            shutil.copy2(source, cible)
            lignes += [f"![{legende} — {nom}]({cible.name})", ""]
    return lignes


def section_externe(run_dir: Path) -> list[str]:
    externe = next((lire_json(p) for p in run_dir.glob("evaluation_externe_*/metrics.json")), None)
    if externe is None:
        return ["## Test externe (test officiel DENTEX)", "", "> Non évalué.", ""]
    return ["## Test externe (test officiel DENTEX, modèle « anomalies »)", "",
            "Autre protocole d'annotation (polygones ramenés à leur cadre, taxonomie à huit codes) : "
            "seules les correspondances sûres sont mesurées — carie, dent incluse, lésion péri-apicale ; "
            "« küretaj » est exclu. Les chiffres ne se comparent pas directement à ceux du test interne.", ""] \
        + tableau_classes(externe) + [""]


def section_donnees(dents_dir: Path) -> list[str]:
    run = lire_json(dents_dir / "run.json") or {}
    decoupage = run.get("decoupage", {})
    split = lire_json(Path(decoupage.get("fichier", ""))) if decoupage.get("fichier") else None
    lignes = ["## Données et découpage", "",
              "- **Source** : DENTEX (Hugging Face `ibrahimhamamci/DENTEX`, révision `7b27ccc`), "
              "licence CC BY-NC-SA 4.0 — usage académique et non commercial ; les poids en héritent.",
              "- **Deux jeux** : « dents » (toutes les dents encadrées, ensemble `quadrant_enumeration`) et "
              "« anomalies » (seulement les dents malades, `quadrant-enumeration-disease` + validation officielle).",
              f"- **Découpage** : un seul pour les deux jeux, par groupe de clichés identiques au pixel près, "
              f"stratifié sur la classe la plus rare ; graine {decoupage.get('graine', '—')}, "
              f"empreinte `{(decoupage.get('empreinte') or '—')[:16]}`.", ""]
    if split and split.get("effectifs"):
        e = split["effectifs"]
        lignes += ["| Jeu « dents » | train | val | test |", "|---|---|---|---|",
                   "| clichés | " + " | ".join(str(e["groupes"].get(p, 0)) for p in ("train", "val", "test")) + " |", ""]
    return lignes


def section_lecture(nom: str, run_dir: Path) -> list[str]:
    """Comment lire les chiffres d'un modèle : validation contre test, bruit du plateau.

    Tout est calculé à partir du journal et des mesures du run, rien n'est écrit
    à la main : le texte reste juste pour n'importe quelle version.
    """
    journal = lire_journal(run_dir)
    meilleure = meilleure_epoque(journal)
    test = lire_json(run_dir / "evaluation_test" / "metrics.json")
    if not journal or meilleure is None or test is None:
        return []
    val = [l["mesures"].get("metrics/mAP50(B)") for l in journal]
    val = [v for v in val if v is not None]
    queue = val[len(val) // 2:]                       # seconde moitié : le plateau
    moyenne = sum(queue) / len(queue)
    ecart = (sum((v - moyenne) ** 2 for v in queue) / len(queue)) ** 0.5
    v_best = meilleure["mesures"].get("metrics/mAP50(B)")
    t = test["detection"]["global"]["mAP50"]
    rares = [(n, d["instances"]) for n in (test.get("classes") or CLASSES)
             if (d := test["detection"].get("par_classe", {}).get(n)) and d.get("instances", 999) < 50]
    lignes = [f"### Comment lire ces chiffres — modèle « {nom} »", "",
              f"- **Le chiffre de référence est celui du test interne : mAP@0,50 = {nombre(t)}.** "
              "Ces clichés n'ont servi à rien d'autre, et le test n'a été évalué qu'une fois.",
              f"- La mAP de validation de la meilleure époque ({nombre(v_best)}) est **optimiste** : c'est "
              "sur elle qu'ont été choisis l'époque retenue et l'arrêt anticipé.",
              f"- Sur la seconde moitié de l'entraînement, la mAP de validation forme un plateau de "
              f"{nombre(moyenne)} en moyenne, avec des oscillations de ±{nombre(ecart, 2)} d'une époque à "
              "l'autre : la meilleure époque est en partie un pic de ce bruit, ce qui explique l'écart avec "
              "le test."]
    if rares:
        lignes.append("- **Classes rares** : " + ", ".join(f"{LIBELLES[n]} ({k} boîtes au test)" for n, k in rares)
                      + " — quelques détections de plus ou de moins font varier leur mesure de plusieurs points ; "
                      "elle indique une tendance, pas une valeur précise.")
    return lignes + [""]


LIMITES = """## Limites

- **Prototype de recherche, non certifié dispositif médical.** Les détections sont des propositions ; la décision relève du praticien.
- **Une seule source de données** (DENTEX, un seul centre et un parc d'appareils limité) : la performance sur les clichés d'un autre cabinet reste à mesurer.
- **Classes rares** : les lésions péri-apicales sont peu nombreuses ; leurs mesures ont un large intervalle d'incertitude.
- **Test externe** : protocole d'annotation différent (polygones, taxonomie), correspondances limitées aux classes sûres.
- **Numérotation FDI** : déduite de la géométrie des boîtes, non apprise ; non évaluée ici (sprint 7).
"""


def construire(args) -> Path:
    sortie = args.out or REPO_ROOT / "docs" / "evaluation" / args.version
    sortie.mkdir(parents=True, exist_ok=True)
    lignes = [f"# Rapport d'évaluation — version `{args.version}`", "",
              "Version = paire de modèles YOLO11 : « dents » (numérotation) et « anomalies » (carie, "
              "carie profonde, lésion péri-apicale, dent incluse). Une détection est juste si sa classe "
              "est la bonne et si son cadre recouvre la vérité terrain à au moins 50 % (IoU).", ""]
    lignes += section_donnees(args.dents)
    lignes += section_modele("dents", args.dents, sortie)
    lignes += section_modele("anomalies", args.anomalies, sortie)
    lignes += section_lecture("anomalies", args.anomalies)
    lignes += section_externe(args.anomalies)
    lignes += [LIMITES]
    (sortie / "rapport.md").write_text("\n".join(lignes), encoding="utf-8")
    return sortie / "rapport.md"


def main(argv=None):
    print(f"-> {construire(_parse_args(argv))}")


if __name__ == "__main__":
    main()
