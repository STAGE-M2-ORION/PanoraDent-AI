# Correspondance des classes DENTEX ↔ PanoraDent (modèle d'anomalies)

Décisions du 27/11/2026, validées avant toute préparation de données.
Seul le **modèle d'anomalies** est concerné. Les modèles « dents » et « rangs »
restent entraînés sur DENTEX : sa numérotation est experte, celle de PanoraDent
est dérivée d'un détecteur automatique (`structured_findings`, non revus par un
dentiste) et n'est jamais utilisée.

Code : `training/panoradent.py` (`CORRESPONDANCE`, `DENTEX_VERS_COMBINE`),
listes dans `training/config.py` (`CLASSES_PANORADENT`, `CLASSES_COMBINE`).

## Table

| Classe unifiée | DENTEX | PanoraDent (id source) | Jeu `panoradent` | Jeu `combine` | Décision |
|---|---|---|---|---|---|
| `caries` | caries + deep_caries | Dental Caries (2) | ✅ boîte d'origine | ✅ boîte de la dent atteinte | Fusion demandée de carie et carie profonde ; PanoraDent ne distingue pas la profondeur |
| `periapical_lesion` | periapical_lesion | Periapical Lesion (7) | ✅ boîte d'origine | ✅ boîte de la dent atteinte | Même définition (zone radio-claire à l'apex) |
| `impacted_tooth` | impacted_tooth | Impacted Third Molar (4) | ✅ | ✅ boîte d'origine | Sûre : dans DENTEX, les 644 dents incluses sont toutes des 3es molaires (rang 8) |
| `missing_tooth` | — | Missing Tooth (5) | ✅ | — | Nouvelle classe, absente de DENTEX |
| `endodontic_treatment` | — | Endodontically Treated Tooth (3) | ✅ | — | Nouvelle classe |
| `retained_root` | — | Retained Root (9) | ✅ | — | Nouvelle classe |
| `tooth_fracture` | — | Tooth Fracture (10) | ✅ | — | Nouvelle classe ; 46 clichés, évaluation peu fiable |
| *écartée* | — | Periapical Abnormality (6) | — | — | **Non fusionnée** avec la lésion péri-apicale : le guide d'annotation ne la définit pas, la correspondance serait douteuse |
| *écartée* | — | Cyst (1), Attrition (0), Periodontal Pocket (8) | — | — | Trop rares (10, 28, 192 boîtes), annotées presque seulement dans le lot A |

Les boîtes écartées disparaissent, le cliché reste (sauf s'il n'a plus aucune boîte).

## Convention des boîtes (choix A1)

Mesuré sur les deux jeux (taille médiane, en fraction de l'image) :

| Classe | DENTEX | PanoraDent | Ce que la boîte couvre |
|---|---|---|---|
| carie | 0,058 × 0,215 | 0,027 × 0,053 | DENTEX : la dent entière ; PanoraDent : la lésion (≈ 8× plus petite) |
| lésion péri-apicale | 0,067 × 0,223 | 0,060 × 0,117 | DENTEX : dent + apex ; PanoraDent : la zone radio-claire |
| dent incluse | 0,067 × 0,159 | 0,058 × 0,108 | la dent, dans les deux |

Pour une même carie, les deux boîtes se recouvrent à IoU ≈ 0,1–0,2 : mélangées
telles quelles, elles apprendraient deux formes à une même classe, et
l'évaluation à IoU 0,50 n'aurait plus de sens.

**Décision A1 :** dans le jeu `combine`, chaque carie et lésion PanoraDent est
remplacée par la boîte de **la dent atteinte**, celle de DENTEX et de
l'application :

- dents trouvées par `runs/dents-v1` (mAP@0,50 0,987 au test interne DENTEX),
  seuil 0,25 ;
- rattachement par la règle du service (`inference/app/fdi.py`, lue à sa
  source) : 20 % de l'anomalie dans la dent, boîte de la dent prolongée vers
  l'apex pour une lésion ;
- plusieurs caries sur une dent → une seule boîte, comme dans DENTEX ;
- une anomalie sans dent hôte **écarte le cliché** du jeu combiné (pas de
  mélange de conventions) ; le nombre est donné dans `rapport_panoradent.md` ;
- la qualité du modèle des dents sur PanoraDent est contrôlée sur les classes
  que PanoraDent encadre déjà sur la dent entière (traitement endodontique,
  dent incluse).

Le jeu `panoradent` garde les boîtes d'origine (lésion).

## Classes du jeu combiné (choix B1)

Le jeu `combine` ne porte que les **3 classes communes**. Les clichés DENTEX
n'annotent jamais les dents absentes, traitées, les racines ni les fractures :
dans un modèle à 7 classes, ces objets y seraient appris comme du fond. Les
4 classes propres à PanoraDent ne sont apprises que par la variante
`anomalies-panoradent`.

Les clichés PanoraDent sans carie, lésion ni inclusion restent dans le jeu
combiné comme exemples négatifs : PanoraDent annote ces trois classes sur
toute l'image, leur absence y est donc une vraie absence.

## Conséquences pour l'application (hors de ce travail)

Ces modèles sont **hors contrat du service** : `train.py` les accepte,
`publish_model.py` les refuse. Les mettre en service demanderait de fusionner
« carie profonde » dans l'interface et d'ajouter les nouvelles classes au
service d'inférence, à l'écran et au compte rendu.
