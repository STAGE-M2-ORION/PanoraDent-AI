# Pipeline d'entraînement

**L'entraînement est un processus hors ligne.** Aucun code de ce dossier n'est
embarqué dans le service d'inférence (principe posé en
[DOCUMENTATION.md §13.5](../docs/DOCUMENTATION.md)). Le seul artefact qui
traverse la frontière est un fichier de poids `.pt`.

Rien ici ne dépend de la stack (ni base, ni stockage), sauf `publish_model.py`,
qui écrit dans PostgreSQL.

---

## Données : DENTEX

| | |
|---|---|
| Source | Hugging Face `ibrahimhamamci/DENTEX`, révision figée `7b27ccc` — public, sans compte |
| Licence | **CC BY-NC-SA 4.0** : usage académique et non commercial. Les poids entraînés héritent de cette restriction |
| Volume | 11,3 Go à télécharger (dont 10,4 Go pour l'archive d'entraînement) |

DENTEX arrive en plusieurs ensembles, qui **n'encadrent pas la même chose** et
**se recouvrent** (mesuré au pixel près) :

| Ensemble | Clichés | Ce qui est encadré |
|---|---|---|
| `quadrant_enumeration` | 634 (11 doublons) | **toutes les dents**, avec leur FDI, sans diagnostic |
| `quadrant-enumeration-disease` | 705 (27 sans boîte) | **seulement les dents malades** : carie, carie profonde, inclusion, lésion péri-apicale |
| validation officielle | 50 | dents malades, même protocole |
| test officiel | 250 | dents malades, **autre protocole** : polygones LabelMe, taxonomie turque à 8 codes |
| `quadrant`, `unlabelled` | 693, 1 571 | inutiles pour nos classes |

260 clichés sont à la fois dans l'énumération et dans les maladies (les deux
annotations y concordent : IoU médian 0,93) ; 85 clichés du test officiel sont
aussi dans l'énumération.

### Décisions (sprint 6, S6-1)

- **Deux modèles.** Mélanger les ensembles apprendrait au modèle qu'une dent
  non encadrée n'est pas une dent. Le modèle **dents** apprend sur
  l'énumération (classe `tooth`), le modèle **anomalies** sur les maladies et la
  validation officielle (quatre diagnostics). Les deux jeux gardent la liste
  `CLASSES` entière, dans l'ordre du contrat : aucun renumérotage côté service.
- **Un seul découpage** pour les deux jeux, par groupe de clichés identiques au
  pixel près, tous ensembles confondus : un cliché de test de l'un n'entraîne
  jamais l'autre. Stratifié sur la classe la plus rare ; empreinte sha256
  conservée avec chaque modèle.
- **Test interne + test officiel en externe.** Le test interne (15 %) mesure les
  deux modèles. Le test officiel est évalué **une seule fois**, à part ; tout
  cliché qui y figure est retiré de l'apprentissage. Seules les correspondances
  sûres y sont gardées (carie, inclusion, lésion) : « küretaj » (curetage) est
  exclu, sa correspondance avec « carie profonde » n'étant pas documentée.

---

## Environnement

Python 3.11. Sur une carte NVIDIA, installer torch **avec CUDA avant** le reste :

```powershell
py -3.11 -m venv training\.venv
training\.venv\Scripts\python -m pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121
training\.venv\Scripts\python -m pip install -r training\requirements.txt
training\.venv\Scripts\python -c "import torch; print(torch.cuda.is_available())"   # True
```

`ultralytics` est épinglé en **8.3.40** (YOLO11 n'existe pas en 8.2) : le service
d'inférence doit charger les poids avec la même version.

---

## Les étapes

```
telecharger_dentex.py ─▶ prepare_dataset.py ─▶ train.py (×2) ─▶ evaluate.py ─▶ publish_model.py
   data/dentex/           data/yolo/{dents,      runs/<nom>/      evaluation_<split>/
                          anomalies,externe}     best.pt, run.json, journal.jsonl
```

Toutes les commandes se lancent depuis la racine du dépôt.

### 1. Télécharger

```powershell
training\.venv\Scripts\python training\telecharger_dentex.py --dest data\dentex
```

Chaque archive est contrôlée contre l'empreinte sha256 publiée ; un
téléchargement interrompu reprend où il s'était arrêté (relancer la même
commande). Les archives sont extraites sous leur propre nom.

### 2. Préparer

```powershell
training\.venv\Scripts\python training\prepare_dataset.py --dentex data\dentex --out data\yolo
```

Produit `dents/`, `anomalies/` et `externe/`, chacun avec `data.yaml`,
`split.json` (graine, empreinte, liste des clichés par partition) et, à côté des
étiquettes, `fdi/<cliché>.json` (vérité terrain numérotée, pour le sprint 7).
`rapport_preparation.md` donne les retraits et les effectifs. Avec la graine 42 :

| | train | val | test |
|---|---|---|---|
| **dents** — clichés / dents | 372 / 10 602 | 79 / 2 308 | 87 / 2 445 |
| **anomalies** — clichés | 501 | 113 | 109 |
| caries | 1 546 | 407 | 332 |
| caries profondes | 450 | 81 | 76 |
| lésions péri-apicales | 120 | 25 | 22 |
| dents incluses | 465 | 85 | 94 |
| **externe** (test officiel) | | | 250 clichés : 747 caries, 221 inclusions, 75 lésions |

La première exécution lit les pixels de 1 639 images (quelques minutes) ; les
empreintes sont ensuite en cache (`data/dentex/empreintes_pixels.json`).

### 3. Contrôler les augmentations

```powershell
training\.venv\Scripts\python training\planche_augmentations.py --data data\yolo\anomalies\data.yaml --out runs\planche.jpg --imgsz 1024
```

La planche passe par la chaîne réelle d'entraînement : miroir horizontal seul
(jamais vertical), luminosité, contraste, léger recadrage ; mosaïque et mixup
coupés. Le miroir inverse aussi les quadrants de la vérité terrain FDI
(`augmentations.miroir_fdi` : 1↔2, 3↔4).

### 4. Entraîner les deux modèles

```powershell
training\.venv\Scripts\python training\train.py --data data\yolo\dents\data.yaml     --name dents-v1
training\.venv\Scripts\python training\train.py --data data\yolo\anomalies\data.yaml --name anomalies-v1
```

Défauts réglés pour une GTX 1650 (4 Go) : `yolo11s.pt`, 1024 px, **lots de 2**,
150 époques, arrêt anticipé après 30 époques sans progrès. Dans `runs/<nom>/` :
`run.json` (hyperparamètres, empreinte du découpage, versions, carte),
`journal.jsonl` (une ligne par époque), `weights/best.pt` et `last.pt`.

**Reprise après coupure** (courant, Ctrl+C, mise en veille) :

```powershell
training\.venv\Scripts\python training\train.py --reprendre runs\anomalies-v1\weights\last.pt
```

**Précision mixte.** Sur GTX 1650, le test d'AMP d'ultralytics passe mais les
pertes deviennent NaN dès le premier lot (constaté). `--amp auto` (défaut) la
coupe donc sur les cartes GTX 16xx ; un garde-fou arrête l'entraînement au
premier lot dont la perte n'est pas finie.

**Mémoire et durée** (GTX 1650, jeu `anomalies`, yolo11s, sans précision mixte,
mesuré le 2026-11-22 sur 30 lots) :

| Réglage | Mémoire réservée | Temps par lot | Époque (501 clichés) |
|---|---|---|---|
| **1024 px, lots de 2** (défaut) | 2,45 Go | 4,7 s | ~20 min |
| 800 px, lots de 4 | 3,50 Go | 5,6 s | ~12 min |
| 1024 px, lots de 4 | 5,13 Go — **déborde** | 19,7 s | ~41 min |

Au-delà de 4 Go, Windows place le surplus en mémoire système et chaque lot
devient quatre fois plus lent. Ces durées ont été prises **carte bridée** (état
P8, 300 MHz, 9 W, plafond de puissance logiciel) : sur secteur avec le mode
d'alimentation « Performances optimales », elles doivent baisser nettement ;
vérifier avec `nvidia-smi` que la carte passe en P0 pendant l'entraînement.
800 px est l'option de repli si la durée devient un problème, au prix des
petites lésions (une carie ne fait que quelques dizaines de pixels sur un
panoramique de 2 900 px de large).

### 5. Évaluer

```powershell
# Pendant les réglages : la validation, autant que nécessaire
training\.venv\Scripts\python training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --split val
# À la fin, UNE fois : le test interne, puis le test externe
training\.venv\Scripts\python training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --split test
training\.venv\Scripts\python training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --data data\yolo\externe\data.yaml --split test
```

Dans `runs/<nom>/evaluation_<split>/` : `metrics.json`, `rapport.md`,
`confusion.png`, `pires_erreurs.jpg`.

- Précision, rappel, mAP@0,50 et mAP@0,50:0,95 **par classe**, puis globalement.
  Une détection est juste si sa classe est la bonne et si l'IoU atteint 0,50.
- Sensibilité / spécificité **par cliché** au seuil d'exploitation (`--conf`) :
  « ce cliché présente-t-il une carie ? ».
- Matrice de confusion au seuil d'exploitation, avec ligne « fond » (manqué) et
  colonne « fond » (inventé).

- Rappel **selon la taille** de la lésion (côté de la boîte en pixels vus par le
  modèle) et lésions « mal typées » (vues au bon endroit, sous une autre classe).

> **Le test ne se regarde qu'une fois.** Chaque évaluation sur le test est
> inscrite dans `evaluations_test.jsonl` à côté de `split.json` ; une seconde est
> refusée, sauf `--forcer "<motif>"`, motif porté au rapport. Le registre vit
> avec les données, recréées sur chaque machine : la garde relit donc aussi les
> évaluations du test rangées dans `runs/*/evaluation*_test/` (Drive, copie
> locale).

### 5 bis. Essais et choix d'un modèle (validation)

```powershell
# Rééquilibrage des classes rares (méthode LVIS) : une classe présente sur moins
# de 30 % des clichés d'entraînement est vue plus souvent
training\.venv\Scripts\python training\train.py --data data\yolo\anomalies\data.yaml --name anomalies-e1 --reequilibrage 0.3
# Tableau des essais, sur la validation seulement (temps d'analyse CPU compris)
training\.venv\Scripts\python training\comparer_essais.py runs\anomalies-v1 runs\anomalies-e1 --temps-cpu 10 --out runs\comparaison_anomalies.md
```

Le modèle se choisit sur ce tableau ; **seul** le modèle retenu passe ensuite
le test, une fois, avec un `--forcer` qui en donne la raison (le test a déjà
servi au modèle précédent). Sur Colab : cellules 8 à 8 ter du carnet.

### 6. Publier la paire

```powershell
training\.venv\Scripts\python training\publish_model.py --version dentex-2026.11 `
    --dents runs\dents-v1 --anomalies runs\anomalies-v1 `
    --database-url "postgresql+psycopg2://panoradent:<mot de passe>@localhost:<DB_PORT>/panoradent"
```

Copie les deux `best.pt` sous `inference/weights/<version>/` (`dents.pt`,
`anomalies.pt`) avec leur sha256, et inscrit la version au registre, **non
active**. Refusé si les deux modèles n'ont pas le même découpage, si l'ordre
des classes diffère, si le test interne n'a pas été évalué (`--partition val`
pour un essai), ou si le nom de version existe déjà avec d'autres poids (une
version publiée ne change plus). L'activation se fait depuis
**Administration › Modèles**, avec un motif : le service d'inférence charge et
vérifie la version avant qu'elle ne devienne active.

### 7. Rapport d'évaluation (mémoire)

```powershell
training\.venv\Scripts\python training\rapport_evaluation.py --version dentex-2026.11 `
    --dents runs\dents-v1 --anomalies runs\anomalies-v1
```

Écrit `docs/evaluation/<version>/rapport.md` et ses figures : données et
découpage, entraînement de chaque modèle (réglages, carte, durée, meilleure
époque, courbes), test interne par classe avec matrice de confusion et pires
erreurs, test externe, limites. Rien n'est recalculé : le rapport assemble ce
que la chaîne a produit.

---

## Sur la machine GPU, de bout en bout

Une fois par machine : l'environnement (ci-dessus) et l'alimentation. Sur un
portable, **chargeur d'origine branché** et mode d'alimentation Windows
**« Performances optimales »** ; vérifier pendant l'entraînement que
`nvidia-smi` montre l'état **P0** (en P8 à 300 MHz, la carte est bridée et
l'entraînement dure des jours).

```powershell
$py = "training\.venv\Scripts\python"
& $py training\telecharger_dentex.py --dest data\dentex
& $py training\prepare_dataset.py --dentex data\dentex --out data\yolo
& $py training\planche_augmentations.py --data data\yolo\anomalies\data.yaml --out runs\planche.jpg --imgsz 1024
& $py training\train.py --data data\yolo\dents\data.yaml     --name dents-v1
& $py training\train.py --data data\yolo\anomalies\data.yaml --name anomalies-v1
# Réglages : la validation, autant que nécessaire
& $py training\evaluate.py --weights runs\dents-v1\weights\best.pt --split val
& $py training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --split val
# À la fin, une seule fois
& $py training\evaluate.py --weights runs\dents-v1\weights\best.pt --split test
& $py training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --split test
& $py training\evaluate.py --weights runs\anomalies-v1\weights\best.pt --data data\yolo\externe\data.yaml --split test
& $py training\publish_model.py --version dentex-2026.11 --dents runs\dents-v1 --anomalies runs\anomalies-v1 --database-url "<URL de la base>"
& $py training\rapport_evaluation.py --version dentex-2026.11 --dents runs\dents-v1 --anomalies runs\anomalies-v1
```

Coupure en cours d'entraînement : relancer avec
`--reprendre runs\<nom>\weights\last.pt`. Carte plus puissante ou Colab :
[`notebooks/colab_panoradent.ipynb`](notebooks/colab_panoradent.ipynb) appelle
les mêmes scripts (lots de 8, précision mixte).

---

## Tests

```powershell
cd training
.venv\Scripts\python -m pytest -q
```

Sans données réelles ni réseau : jeu synthétique et faux DENTEX. Couvre le
téléchargement (intégrité, reprise), les lecteurs DENTEX, la conversion (deux
jeux sans mélange, groupes jamais séparés, test externe isolé, küretaj exclu),
le découpage (même graine, même découpage), les augmentations (miroir et
quadrants, jamais vertical, chaîne ultralytics), l'entraînement réel sur le
processeur (journal, coupure puis reprise, garde NaN), l'évaluation (IoU,
confusion, test évalué une seule fois, test externe rangé à part), la
publication (paire, découpage commun, version immuable) et le rapport. Non couvert par la CI : torch y serait
trop lourd.
