# Inspection du jeu PanoraDent (27/11/2026)

Jeu : `PanoraDent_DiB_v1.zip` (CC BY 4.0), extrait sous `data/panoradent-source/`.
Préparation : `training/prepare_panoradent.py` ; décisions : `class_mapping.md`.

## Contenu

- 1 295 radiographies panoramiques d'adultes, deux hôpitaux de Sylhet
  (Bangladesh) ; hôpital = lot d'annotation : **A** (425, annoté à la main),
  **B** (870, parti des boîtes d'un détecteur entraîné sur A, puis corrigé).
- Deux groupes de résolution : G1 (894 clichés, 4124 × 2020 px), G2 (401, ~2048 px).
- `images/`, `labels/` (YOLO), `coco/`, `splits/` (5 plis et un découpage fixe
  915/191/189, non repris), `metadata/`, `structured_findings/` (numérotation
  FDI dérivée d'un détecteur, non revue par un dentiste : **non utilisée**).
- 8 204 boîtes, **11 classes** dont 7 cibles :

| Classe | Boîtes | Clichés | La boîte couvre |
|---|---|---|---|
| Missing Tooth | 3 628 | 913 | la place vide |
| Dental Caries | 1 281 | 658 | la lésion |
| Endodontically Treated Tooth | 1 059 | 313 | la dent |
| Impacted Third Molar | 1 043 | 552 | la dent |
| Retained Root | 781 | 281 | la racine |
| Periapical Lesion | 97 | 79 | la zone radio-claire |
| Tooth Fracture | 62 | 46 | la zone fracturée |
| Periodontal Pocket, Attrition, Periapical Abnormality, Cyst | 192, 28, 23, 10 | | non cibles |

## Nettoyage

| Contrôle | Résultat |
|---|---|
| Doublons au pixel près | 0 (aucune paire à dHash ≤ 20 non plus) |
| Recoupement avec le test officiel DENTEX | 0 ; cliché le plus proche à 53 bits sur 256 |
| Recoupement avec le reste de DENTEX | 0 ; le plus proche à 47 bits |
| Clichés sans boîte à la source | 37, écartés |
| Clichés sans boîte après l'écart des classes non cibles | 7, écartés |
| Clichés gardés | **1 251** (876 / 188 / 187) |

Découpage propre, 70/15/15, graine 42, stratifié sur la classe la plus rare ;
empreinte `7a747b95ab2f2a1f`. Les résultats ne sont donc pas directement
comparables à ceux de l'article (autre découpage).

## Conventions de boîtes : PanoraDent face à DENTEX

Taille médiane (fraction de l'image) :

| Classe | DENTEX | PanoraDent |
|---|---|---|
| carie | 0,058 × 0,215 (dent entière) | 0,027 × 0,053 (lésion) |
| lésion péri-apicale | 0,067 × 0,223 (dent + apex) | 0,060 × 0,117 (zone radio-claire) |
| dent incluse | 0,067 × 0,159 | 0,058 × 0,108 |

Dans DENTEX, les 644 dents incluses sont toutes des 3es molaires : la
correspondance avec « Impacted Third Molar » est sûre.

## Modèle des dents sur PanoraDent (conversion A1)

`dents-v1` (DENTEX) sur les 1 251 clichés : **31 dents par cliché** en
médiane, dans les deux lots et les deux résolutions. Sur les boîtes que
PanoraDent trace déjà sur la dent :

| Classe | IoU médiane | Dents non trouvées (IoU < 0,1) | Hauteur détectée / PanoraDent | Largeur détectée / PanoraDent |
|---|---|---|---|---|
| dent traitée | 0,46 | 2 à 6 % | 1,32 à 1,49 | 1,41 à 1,47 |
| dent incluse | 0,51 | 2 à 7 % | 1,29 à 1,49 | 1,24 à 1,33 |

L'IoU modeste ne vient pas de dents manquées : les boîtes de PanoraDent sont
plus serrées (elles s'arrêtent souvent avant l'apex), celles de `dents-v1`
suivent la convention de DENTEX (planches vérifiées à l'œil).

Conversion A1 : 19 anomalies sans dent hôte (17 caries, 2 lésions), soit
**18 clichés écartés** du jeu combiné ; 25 caries réunies sur une dent déjà
encadrée ; 284 clichés PanoraDent sans carie, lésion ni inclusion gardés
comme négatifs.

## Jeux produits

| Jeu | Clichés (train / val / test) | Classes |
|---|---|---|
| `panoradent` | 876 / 188 / 187 | 7 |
| `combine` | 1 367 / 296 / 293 | 3 (DENTEX 501/113/109 + PanoraDent 866/183/184) |
| `combine-dentex`, `combine-panoradent` | vues par origine du précédent | 3 |

Lésions péri-apicales PanoraDent : 14 en validation, 15 en test. Fractures :
9 et 10. Les mesures de ces classes resteront très incertaines.
