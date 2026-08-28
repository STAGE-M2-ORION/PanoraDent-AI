# Pipeline d'entraînement

**L'entraînement est un processus hors ligne.** Aucun code de ce dossier n'est
embarqué dans le service d'inférence, et aucun code d'entraînement ne tourne
dans le conteneur qui sert les prédictions (principe posé en
[DOCUMENTATION.md §13.5](../docs/DOCUMENTATION.md)). Le seul artefact qui
traverse la frontière est un fichier de poids `.pt`.

Ce dossier ne dépend d'aucun service : il tourne aussi bien sur Colab que sur
une machine GPU, sans base ni stockage objet — à l'exception de
`publish_model.py`, qui écrit dans PostgreSQL.

---

## Environnement

**Python 3.11.** PyTorch ne publie pas encore pour 3.14, la version par défaut
de cette machine — un environnement dédié est obligatoire.

```bash
py -3.11 -m venv .venv-train
.venv-train/Scripts/activate          # Linux/macOS : source .venv-train/bin/activate
pip install -r training/requirements.txt
```

**Sans GPU, l'entraînement n'est pas exploitable.** Le notebook
[`notebooks/colab_panoradent.ipynb`](notebooks/colab_panoradent.ipynb) clone le
dépôt sur Colab (T4 gratuit) et appelle ces mêmes scripts : le code reste
versionné ici, seul le calcul part là-bas.

---

## Les quatre étapes

```
  COCO source                                          plateforme
       │                                                    ▲
       ▼                                                    │
 prepare_dataset.py ──▶ train.py ──▶ evaluate.py ──▶ publish_model.py
   data.yaml              best.pt      metrics.json    model_versions
   split.json             run.json                     + weights/model.pt
```

### 1. `prepare_dataset.py` — le fichier qui porte la validité

Convertit un COCO en format YOLO. Deux garanties qu'il est seul à apporter :

- **Découpage par patient.** Deux clichés d'un même patient ne peuvent pas se
  répartir entre entraînement et test. Sans cela, les scores sont gonflés et le
  résultat n'a aucune valeur scientifique.
- **Test gelé et reproductible.** `split.json` consigne la graine, les ratios et
  l'affectation patient par patient. Rejouer la commande redonne exactement le
  même découpage, et le fichier permet de le prouver.

Il affiche aussi la **distribution par classe et par partition** : c'est là que
le déséquilibre devient visible — une carie est bien plus fréquente qu'une dent
incluse.

```bash
python training/prepare_dataset.py \
    --annotations data/dentex/annotations.json \
    --images      data/dentex/images \
    --out         data/yolo \
    --class-map   training/class_map.dentex.json
```

> ⚠️ La structure hiérarchique de DENTEX (quadrant → numérotation → diagnostic)
> **n'a pas pu être vérifiée** : aucune donnée n'était disponible à l'écriture.
> `--category-field` désigne le champ portant la classe. Les catégories non
> reconnues sont **comptées et signalées**, jamais perdues en silence — vérifier
> cette sortie à la première exécution.

### 2. `train.py`

Enveloppe fine autour d'ultralytics. Refuse de démarrer si l'ordre des classes
du `data.yaml` diverge de
[`inference/app/config.py`](../inference/app/config.py) : le service mappe
l'index prédit sur sa propre liste, un décalage d'un cran produirait des
diagnostics faux **sans lever la moindre erreur**. Écrit `run.json`
(hyperparamètres, empreinte git, ordre des classes).

### 3. `evaluate.py`

Deux familles de chiffres, qui ne répondent pas à la même question :

| Mesure | Question | Seuil |
|---|---|---|
| mAP@0.5, mAP@0.5:0.95, précision, rappel — **par classe** | Le modèle localise-t-il bien ? | toute la courbe |
| **Sensibilité / spécificité au niveau image** | *Ce cliché présente-t-il au moins une carie ?* | seuil d'exploitation (`--conf`) |

La spécificité n'a pas de sens en détection pure — il n'existe pas de « vrai
négatif » sur une boîte jamais proposée. Elle en retrouve un dès qu'on pose la
question au niveau du cliché, qui est la lecture du praticien.

> **Le jeu de test ne se regarde qu'une fois.** Régler des hyperparamètres en
> observant le test le contamine : les chiffres cessent d'être une mesure
> indépendante. Itérer avec `--split val`.

### 4. `publish_model.py`

Le chaînon manquant vers la plateforme. La table `model_versions` et
`GET /api/model/versions` existent depuis le premier jour et n'ont **jamais été
alimentées** : rien n'écrivait dedans. Ce script écrit dedans, et copie les
poids dans `inference/weights/model.pt`.

```bash
python training/publish_model.py \
    --version yolov11n-dentex-2026.09 \
    --dataset "DENTEX disease, split patient 70/15/15, graine 42" \
    --metrics runs/colab-run/weights/metrics.json \
    --weights runs/colab-run/weights/best.pt --install
```

Depuis Colab, la base n'est pas joignable : ajouter `--skip-db`, puis rejouer le
script sur la machine qui héberge la stack.

---

## Obtenir les données

Rien n'est versionné ici — `.gitignore` bloque `data/`, `*.pt` et `*.dcm`. Le
risque nº 1 du projet est le **délai d'accès aux datasets** : lancer les
demandes avant d'écrire une ligne de plus.

| Jeu | Accès | Délai | Ce qu'il apporte |
|---|---|---|---|
| **UFBA-425** | Téléchargement direct, **CC BY 4.0** | immédiat | Démarrer aujourd'hui : détection et numérotation des dents. **Pas les anomalies.** Seule licence autorisant clairement un usage commercial |
| **DENTEX** | Inscription au challenge Grand Challenge, usage académique | jours | **Le socle** : le seul à porter à la fois la numérotation FDI et les 4 diagnostics du périmètre |
| **Tufts Dental** | Demande académique via le portail officiel | **long** — à lancer maintenant | Renfort qualité et diversité sur la détection |

Ordre recommandé : commencer sur UFBA-425 pour valider tout le pipeline sur des
données réelles pendant que la demande DENTEX est en cours. Le périmètre est
alors réduit à la classe `tooth` — c'est suffisant pour vérifier la conversion,
le découpage par patient, l'entraînement et la numérotation FDI.

**Kystes et fractures n'ont aucun dataset annoté** et sont hors périmètre.

---

## Après l'entraînement

Le service ne bascule pas tout seul. Voir
[DOCUMENTATION.md §10.5](../docs/DOCUMENTATION.md) et, surtout, poser
`MODEL_STRICT=1` : sans lui, des poids illisibles font **retomber le service en
mode mock silencieusement**, et l'on mesure du bruit en croyant mesurer un
modèle.

```bash
curl http://localhost:8001/health          # doit répondre "mode":"real"
```

En mode réel, la numérotation FDI est calculée par
[`inference/app/fdi.py`](../inference/app/fdi.py) à partir de la géométrie des
boîtes : le détecteur n'apprend pas les numéros de dents, ils sont déduits.
