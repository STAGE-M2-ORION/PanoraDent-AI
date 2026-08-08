# PanoraDent AI — Infrastructure

Aide au diagnostic par analyse IA des radiographies panoramiques dentaires.

> ⚠️ **Prototype de recherche — NON certifié dispositif médical.**
> Les détections produites sont des propositions. **La décision médicale relève
> exclusivement du praticien.** Ne pas utiliser en contexte clinique réel, ni
> sur des données patient réelles.

Monorepo lançable en une commande. Cinq services orchestrés par Docker Compose :
frontend (Next.js), backend (FastAPI), service d'inférence IA **isolé**
(PyTorch/YOLO), PostgreSQL et stockage objet S3-compatible (MinIO).

**La chaîne tourne immédiatement, sans modèle entraîné.** Le service d'inférence
démarre en **mode mock** et renvoie des détections factices mais plausibles, ce
qui permet de valider tout le pipeline (import → anonymisation → stockage →
inférence → persistance → rapport PDF) dès le premier jour.

| | |
|---|---|
| **Statut** | Prototype fonctionnel de bout en bout, sans modèle entraîné |
| **Stack** | Next.js 14 · FastAPI · PostgreSQL 16 · MinIO · YOLO (optionnel) |
| **Prérequis** | Docker + Docker Compose v2, ~4 Go de disque. Aucun GPU requis |
| **Démarrage** | `cp .env.example .env && docker compose up --build` |

**Documentation** : ce fichier couvre l'ensemble de la stack ;
[docs/architecture.md](docs/architecture.md) en donne la vue condensée, et
[frontend/README.md](frontend/README.md) détaille les conventions
Feature-Sliced Design du client.

---

## Table des matières

- [Démarrage rapide](#démarrage-rapide)
- [Architecture](#architecture)
- [Flux d'une analyse](#flux-dune-analyse)
- [Services et ports](#services-et-ports)
- [Variables d'environnement](#variables-denvironnement)
- [API backend](#api-backend)
- [Modèle de données](#modèle-de-données)
- [Service d'inférence](#service-dinférence)
- [Brancher le vrai modèle](#brancher-le-vrai-modèle)
- [Environnement CPU / GPU](#environnement-cpu--gpu)
- [Frontend](#frontend)
- [Développement local (hors Docker)](#développement-local-hors-docker)
- [Tests et CI](#tests-et-ci)
- [Structure du dépôt](#structure-du-dépôt)
- [Stack technique et dépendances](#stack-technique-et-dépendances)
- [Sécurité & conformité](#sécurité--conformité)
- [Limites connues](#limites-connues)
- [Feuille de route](#feuille-de-route)
- [Dépannage](#dépannage)
- [Commandes utiles](#commandes-utiles)

---

## Démarrage rapide

**Prérequis** : Docker + Docker Compose v2 (`docker compose`, pas
`docker-compose`). Environ 4 Go d'espace disque pour les images. Aucun GPU
requis. Ports libres attendus : `3000`, `8000`, `8001`, `5432`, `9000`, `9001`.

```bash
cp .env.example .env        # ajuster si besoin
docker compose up --build   # ou : make up
```

Le premier build prend quelques minutes (trois images construites : backend,
inference, frontend). Une fois les services démarrés :

| Service | URL | Identifiants |
|---|---|---|
| Application web | http://localhost:3000 | — |
| API (docs Swagger) | http://localhost:8000/docs | — |
| API (schéma OpenAPI) | http://localhost:8000/openapi.json | — |
| Service d'inférence | http://localhost:8001/health | — |
| Console stockage MinIO | http://localhost:9001 | `minioadmin` / `minioadmin` |
| PostgreSQL | `localhost:5432` | `panoradent` / `panoradent` |

**Vérifier que tout est vivant :**

```bash
curl http://localhost:8000/api/health
# {"status":"ok","inference_reachable":true,"inference_mode":"mock"}
```

Le bandeau en haut de l'application affiche le même état : `Inférence : mock`
signifie que les détections affichées sont **factices**.

**Premier essai** : ouvrir http://localhost:3000, cliquer sur « Importer une
panoramique », choisir n'importe quel JPG/PNG (ou un `.dcm`), puis « Générer le
rapport PDF ». Les objets produits sont visibles dans la console MinIO
(`images/`, `reports/`). L'aperçu de l'image affiche en revanche « Image non
affichable… » et le lien du PDF ne s'ouvre pas : les URLs présignées ne sont pas
résolvables depuis le navigateur en configuration par défaut — cause et
contournements dans [Limites connues](#limites-connues).

Même essai en ligne de commande, sans passer par l'UI :

```bash
curl -F "file=@panoramique.jpg" http://localhost:8000/api/analyses
# → JSON complet de l'analyse, avec ses détections et son id
curl -X POST http://localhost:8000/api/analyses/<id>/report
# → {"url": "http://minio:9000/panoradent/reports/<id>.pdf?..."}
```

Les migrations de base sont appliquées **automatiquement** au démarrage du
backend (`alembic upgrade head` dans le `CMD` du conteneur, cf.
[backend/Dockerfile](backend/Dockerfile)) — aucune action manuelle nécessaire.

---

## Architecture

```
                 ┌─────────────┐
   navigateur ──▶│  frontend   │ Next.js (export statique) + nginx — port 3000
                 └──────┬──────┘
                        │ /api  (proxy nginx → backend:8000)
                 ┌──────▼──────┐      ┌──────────────┐
                 │   backend   │─────▶│  inference   │ FastAPI + YOLO — port 8001
                 │  (FastAPI)  │ HTTP │  ISOLÉ       │ (mock si pas de poids)
                 └───┬─────┬───┘      └──────────────┘
                     │     │
          ┌──────────▼─┐ ┌─▼───────────┐
          │ PostgreSQL │ │   MinIO     │ stockage objet S3
          │ métadonnées│ │ images+PDF  │ ports 9000 / 9001
          └────────────┘ └─────────────┘
```

Les services communiquent sur le réseau bridge par défaut créé par Compose et
se résolvent par leur nom de service (`db`, `minio`, `inference`, `backend`).
Aucun réseau n'est déclaré explicitement dans
[docker-compose.yml](docker-compose.yml).

### Principes de conception

- **Service d'inférence isolé.** Le modèle vit dans son propre conteneur, joint
  uniquement en HTTP (`POST /infer`). Il n'a accès **ni à la base ni au
  stockage** : il ne reçoit que des pixels. Il peut être remplacé, versionné ou
  déployé sur une machine GPU distincte sans toucher au backend.
- **Aucune donnée patient identifiante en base.** L'anonymisation a lieu à
  l'import, *avant* tout stockage. PostgreSQL ne contient que des métadonnées
  techniques (dimensions, version de modèle, boîtes englobantes).
- **Mode mock de bout en bout.** L'intégralité du pipeline est testable avant
  d'avoir entraîné quoi que ce soit.
- **CPU par défaut**, GPU en option via un override Compose — aucune dépendance
  lourde (`torch`, `ultralytics`) n'est installée tant que le mode mock suffit.
- **Migrations au démarrage.** Le schéma est toujours à jour sans étape manuelle.

Détail complémentaire : [docs/architecture.md](docs/architecture.md).

---

## Flux d'une analyse

1. **Import** — l'utilisateur dépose un DICOM (`.dcm`) ou une image (JPG/PNG)
   depuis le navigateur : `POST /api/analyses` en `multipart/form-data`
   ([`upload-analysis`](frontend/src/features/upload-analysis/)).
   Un corps vide est rejeté en `400`.
2. **Anonymisation** ([`backend/app/services/anonymize.py`](backend/app/services/anonymize.py)) —
   le format est détecté par l'extension `.dcm` **ou** par la signature `DICM`
   à l'offset 128 du fichier.
   - DICOM : les tags identifiants sont écrasés, puis seul le `pixel_array` est
     conservé, normalisé min/max sur 0–255 et converti en niveaux de gris.
   - JPG/PNG : conversion en niveaux de gris et ré-encodage PNG, ce qui supprime
     toute métadonnée EXIF.
3. **Stockage** — le PNG anonymisé part dans MinIO sous `images/<uuid>.png`
   (le bucket est créé à la volée s'il n'existe pas). L'original n'est **jamais**
   écrit sur disque : les octets bruts ne quittent pas la mémoire du processus.
4. **Inférence** — le backend `POST` le PNG au service `inference`
   ([`inference_client.py`](backend/app/services/inference_client.py), timeout
   **60 s**) et reçoit une liste de détections normalisées.
5. **Persistance** — une ligne `analyses` + N lignes `detections` en base :
   - version de modèle et mode (`mock` / `real`) renvoyés par le service d'inférence ;
   - chaque détection est créée avec `source="model"` et `reviewed=false`.
6. **Revue praticien** — le schéma de données est prêt (colonnes `reviewed`,
   `source`), l'API et l'UI ne le sont pas encore (voir
   [Limites connues](#limites-connues)).
7. **Rapport PDF** — `POST /api/analyses/{id}/report` relit l'image depuis
   MinIO, la ré-annote côté serveur et génère un PDF A4 avec l'image, le tableau
   des détections et la mention légale obligatoire. Le PDF est stocké sous
   `reports/<id>.pdf`, la clé est enregistrée dans `analyses.report_key`, et une
   URL présignée (1 h) est renvoyée. Un second appel **régénère et écrase** le
   PDF existant.

---

## Services et ports

| Service | Image / build | Port hôte → conteneur | Rôle |
|---|---|---|---|
| `frontend` | `./frontend` (node:20-alpine → nginx:alpine) | `3000` → `80` | UI statique + proxy `/api` |
| `backend` | `./backend` (python:3.11-slim) | `8000` → `8000` | API REST, anonymisation, PDF |
| `inference` | `./inference` (python:3.11-slim) | `8001` → `8001` | Modèle IA isolé |
| `db` | `postgres:16-alpine` | `5432` → `5432` | Métadonnées |
| `minio` | `minio/minio:latest` | `9000` (S3), `9001` (console) | Images + rapports |

**Healthchecks** ([docker-compose.yml](docker-compose.yml)) :

| Service | Sonde | Cadence |
|---|---|---|
| `db` | `pg_isready -U $POSTGRES_USER` | 5 s, timeout 3 s, 10 essais |
| `minio` | `mc ready local` | 5 s, timeout 3 s, 10 essais |
| `inference` | `urllib.request.urlopen('http://localhost:8001/health')` | 10 s, timeout 5 s, 5 essais |
| `backend` | *aucun* | — |
| `frontend` | *aucun* | — |

**Ordre de démarrage** :
- `backend` attend que `db` et `minio` soient *healthy* (`condition: service_healthy`).
- `backend` attend seulement que `inference` soit **lancé** (`condition: service_started`) —
  il peut donc démarrer avant que le modèle soit chargé. Sans conséquence :
  `GET /api/health` le signale, et l'inférence n'est appelée qu'à l'upload.
- `frontend` dépend de `backend`, sans condition de santé.

**Volumes persistants** : `db_data` (PostgreSQL) et `minio_data` (objets).
`make clean` (= `docker compose down -v`) les supprime — **les données sont
perdues**.

---

## Variables d'environnement

Copier [`.env.example`](.env.example) en `.env` (jamais committé, cf.
[.gitignore](.gitignore)). Compose lit ce fichier automatiquement et applique
les valeurs par défaut ci-dessous si la variable est absente.

| Variable | Défaut | Utilisée par | Description |
|---|---|---|---|
| `POSTGRES_USER` | `panoradent` | db, backend | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | `panoradent` | db, backend | Mot de passe PostgreSQL |
| `POSTGRES_DB` | `panoradent` | db, backend | Nom de la base |
| `S3_ACCESS_KEY` | `minioadmin` | minio, backend | Clé d'accès objet (= `MINIO_ROOT_USER`) |
| `S3_SECRET_KEY` | `minioadmin` | minio, backend | Clé secrète objet (= `MINIO_ROOT_PASSWORD`) |
| `S3_BUCKET` | `panoradent` | backend | Bucket (créé à la volée si absent) |
| `MODEL_VERSION` | `mock-0.0.0` | inference | Version tracée dans chaque analyse |
| `JWT_SECRET` | `change-me-in-prod` | backend | Secret de signature — **à changer** |

**Variables construites par Compose**, non surchargeables via `.env` (elles
sont écrites en dur dans [docker-compose.yml](docker-compose.yml)) :

| Variable | Valeur | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://…@db:5432/…` | Connexion SQLAlchemy |
| `S3_ENDPOINT` | `http://minio:9000` | Endpoint S3 interne au réseau Docker |
| `INFERENCE_URL` | `http://inference:8001` | Base d'appel du service d'inférence |
| `MODEL_WEIGHTS_PATH` | `/weights/model.pt` | Chemin des poids dans le conteneur |

Côté backend, ces variables sont lues par `pydantic-settings`
([`backend/app/config.py`](backend/app/config.py)), qui accepte aussi un fichier
`.env` local et **ignore silencieusement** les variables inconnues
(`extra="ignore"`).

Côté frontend, la base d'API est lue depuis `NEXT_PUBLIC_API_BASE`
(défaut `/api`, résolu par le proxy nginx). C'est une variable **de build** :
Next.js l'inline dans le bundle au moment du `npm run build` ; la définir au
runtime du conteneur nginx n'a aucun effet (voir
[Limites connues](#limites-connues)).

---

## API backend

Toutes les routes métier sont préfixées par `/api`. Documentation interactive :
http://localhost:8000/docs.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/` | Ping du service (hors `/api`) → `{"service":"panoradent-backend","docs":"/docs"}` |
| `GET` | `/api/health` | État du backend + joignabilité et mode de l'inférence |
| `POST` | `/api/analyses` | Upload d'une image → anonymise, stocke, infère, persiste. `multipart/form-data`, champ `file`. Retourne l'analyse complète avec ses détections |
| `GET` | `/api/analyses` | Liste des analyses (résumés, plus récentes d'abord) |
| `GET` | `/api/analyses/{id}` | Détail d'une analyse + détections |
| `GET` | `/api/analyses/{id}/image` | URL présignée (1 h) vers le PNG anonymisé |
| `POST` | `/api/analyses/{id}/report` | Génère le PDF annoté, le stocke, renvoie une URL présignée |
| `GET` | `/api/model/versions` | Versions de modèle enregistrées + métriques d'évaluation |

### Exemples

**Créer une analyse**

```bash
curl -F "file=@panoramique.jpg" http://localhost:8000/api/analyses
```

```json
{
  "id": "9f1c…",
  "created_at": "2026-07-30T10:12:44.512Z",
  "image_key": "images/9f1c….png",
  "report_key": null,
  "model_version": "mock-0.0.0",
  "inference_mode": "mock",
  "width": 1024,
  "height": 512,
  "detections": [
    {
      "id": "3ab2…", "label": "tooth", "fdi": 11, "confidence": 0.94,
      "x": 64, "y": 180, "w": 64, "h": 85,
      "reviewed": false, "source": "model"
    }
  ]
}
```

**Lister les analyses** — résumés uniquement, sans les boîtes :

```json
[
  { "id": "9f1c…", "created_at": "…", "model_version": "mock-0.0.0",
    "inference_mode": "mock", "n_detections": 12 }
]
```

**Récupérer l'image / le rapport** — les deux routes renvoient un objet JSON
`{"url": "…"}` contenant une URL présignée S3 valable **3600 s**, et non une
redirection ni le binaire lui-même.

**État du système** — `GET /api/health` interroge `GET /health` du service
d'inférence avec un timeout de **3 s** ; toute erreur est absorbée et renvoie
`inference_reachable: false`, `inference_mode: "unknown"`. Le backend est donc
toujours `"status": "ok"` dès qu'il répond.

**Versions de modèle** — `GET /api/model/versions`, plus récentes d'abord ;
`metrics_json` est désérialisé dans le champ `metrics` :

```json
[
  { "version": "yolov11-dentex-1.0.0", "dataset": "DENTEX",
    "metrics": { "mAP50": 0.71 }, "notes": "", "created_at": "…" }
]
```

La table n'étant alimentée par aucun code, cette route renvoie `[]` tant qu'on
n'insère pas les lignes à la main (cf. [Limites connues](#limites-connues)).

### Codes d'erreur

| Code | Cas |
|---|---|
| `400` | Fichier vide à l'upload |
| `404` | `analysis_id` inconnu (détail, image, rapport) |
| `422` | Champ `file` absent de la requête multipart (validation FastAPI) |
| `500` | Image ou DICOM illisible par Pillow/pydicom, service d'inférence indisponible ou en erreur (`raise_for_status`), stockage objet injoignable |

Les schémas de réponse sont définis dans
[`backend/app/schemas.py`](backend/app/schemas.py)
(`AnalysisOut`, `AnalysisSummary`, `DetectionOut`).

---

## Modèle de données

Défini dans [`backend/app/models.py`](backend/app/models.py) (SQLAlchemy 2.0,
API `Mapped[...]`), migré par Alembic
([`0001_initial`](backend/alembic/versions/0001_initial.py)).

### `analyses` — une panoramique anonymisée

| Colonne | Type | Notes |
|---|---|---|
| `id` | `String` PK | UUID4 généré côté Python |
| `created_at` | `DateTime` | `datetime.utcnow` |
| `image_key` | `String` | Clé objet `images/<uuid>.png` |
| `report_key` | `String?` | Clé objet `reports/<id>.pdf`, `null` tant qu'aucun rapport |
| `model_version` | `String` | Version renvoyée par le service d'inférence |
| `inference_mode` | `String` | `mock` \| `real` |
| `width`, `height` | `Integer` | Dimensions de l'image anonymisée, en pixels |

### `detections` — une boîte proposée par le modèle ou saisie par un praticien

| Colonne | Type | Notes |
|---|---|---|
| `id` | `String` PK | UUID4 |
| `analysis_id` | FK → `analyses.id` | `ON DELETE CASCADE` |
| `label` | `String` | Une des [classes du périmètre](#service-dinférence) |
| `fdi` | `Integer?` | Numérotation dentaire internationale, `null` en mode réel |
| `confidence` | `Float` | 0–1, arrondi à 2 décimales |
| `x`, `y`, `w`, `h` | `Integer` | Boîte en pixels de l'image analysée |
| `reviewed` | `Boolean` | Défaut `false` — revue praticien à implémenter |
| `source` | `String` | `model` \| `human`, défaut `model` |

La relation est configurée en `cascade="all, delete-orphan"` : supprimer une
analyse supprime ses détections, côté ORM comme côté base.

### `model_versions` — traçabilité des modèles

| Colonne | Type | Notes |
|---|---|---|
| `id` | `String` PK | UUID4 |
| `version` | `String` unique | Ex. `yolov11-dentex-1.0.0` |
| `created_at` | `DateTime` | |
| `dataset` | `String` | Jeu d'entraînement |
| `metrics_json` | `Text` | JSON libre (mAP, précision, rappel…) |
| `notes` | `Text` | |

> Aucune de ces tables ne contient de donnée identifiante patient : ni nom, ni
> identifiant, ni date de naissance, ni date d'examen.

---

## Service d'inférence

Service FastAPI autonome ([`inference/`](inference/)), sans accès à la base ni
au stockage — il ne reçoit que des pixels et ne conserve rien.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/health` | `{status, mode, version}` |
| `POST` | `/infer` | Image en `multipart` (champ `file`) → détections normalisées |

Le modèle est chargé une seule fois, à l'événement `startup`
([`inference/app/main.py`](inference/app/main.py)). L'image reçue est convertie
en niveaux de gris avant prédiction.

Réponse d'`/infer` :

```json
{
  "mode": "mock",
  "model_version": "mock-0.0.0",
  "image_size": { "width": 1024, "height": 512 },
  "detections": [
    { "label": "tooth", "fdi": 11, "confidence": 0.94, "bbox": [64, 180, 64, 85] }
  ]
}
```

`bbox` est au format `[x, y, largeur, hauteur]`, en pixels de l'image analysée.
C'est le **contrat d'interface** du service : toute implémentation alternative
(autre framework, autre modèle, service distant) qui le respecte est
substituable sans modifier le backend.

**Classes du périmètre** ([`inference/app/config.py`](inference/app/config.py)) :
`tooth`, `caries`, `deep_caries`, `periapical_lesion`, `impacted_tooth`.
L'index de classe renvoyé par YOLO est mappé sur cette liste, dans cet ordre.

### Mode mock — ce qu'il génère exactement

[`inference/app/model.py`](inference/app/model.py) produit :

- **Dents** : 6 à 12 boîtes `tooth` réparties horizontalement sur l'arcade.
  - Largeur `width/16`, hauteur `height/6`, centrées verticalement avec une
    gigue de ±5 % de la hauteur.
  - `fdi` calculé arbitrairement (`quadrant*10 + position`).
  - Confiance tirée dans 0,80–0,99.
- **Anomalies** : jusqu'à 3, tirées au sort parmi `caries`, `deep_caries`,
  `periapical_lesion`, `impacted_tooth`.
  - Confiance tirée dans 0,55–0,90.
  - Elles **réutilisent la boîte exacte d'une dent** : dans le viewer et le
    PDF, elles se superposent donc parfaitement à une boîte `tooth`
    (comportement attendu, pas un bug).

Le générateur aléatoire est initialisé à partir de `width`/`height`
(`Random(width * 7919 + height)`) : les détections sont **déterministes pour
une taille d'image donnée**. Deux appels sur la même image donnent le même
résultat, ce qui rend les tests d'intégration reproductibles.

---

## Brancher le vrai modèle

1. Entraîner YOLOv11 sur DENTEX (ou un jeu équivalent) en respectant l'ordre des
   classes de [`inference/app/config.py`](inference/app/config.py), et exporter
   les poids en `.pt`.
2. Déposer le fichier dans [`inference/weights/model.pt`](inference/weights/).
   Le dossier est monté en lecture seule dans le conteneur (`./inference/weights:/weights:ro`)
   et les `*.pt` sont exclus du dépôt par [.gitignore](.gitignore).
3. Décommenter, dans [`inference/requirements.txt`](inference/requirements.txt),
   la ligne `ultralytics==8.2.0` ; et dans
   [`inference/Dockerfile`](inference/Dockerfile), le bloc `RUN` d'installation
   de `torch` (il choisit automatiquement la roue CPU ou CUDA selon
   `TORCH_VARIANT`).
4. Renseigner `MODEL_VERSION` dans `.env` (ex. `yolov11-dentex-1.0.0`) pour que
   la version soit tracée dans chaque analyse.
5. `docker compose up --build` — le rebuild est obligatoire, les dépendances
   changent.

Au démarrage, si les poids sont chargeables, le service bascule en mode `real`
et le journal affiche `[inference] mode=real version=…`. **En cas d'échec de
chargement, il retombe silencieusement en mock** (message
`[inference] échec du chargement du modèle, bascule en mock : …` dans les logs).
Vérifier les logs **et** `GET /api/health` avant de conclure quoi que ce soit
d'une détection.

**Checklist de vérification** après bascule :

```bash
curl http://localhost:8001/health          # → {"mode":"real", ...}
curl http://localhost:8000/api/health      # → "inference_mode":"real"
docker compose logs inference | grep mode= # → [inference] mode=real version=…
```

> En mode `real`, le champ `fdi` est renvoyé à `null` : le mapping des boîtes
> vers la numérotation dentaire internationale reste à implémenter
> ([`inference/app/model.py`](inference/app/model.py), fonction `predict`).
> Les rapports PDF afficheront donc `FDI -` pour toutes les détections.

---

## Environnement CPU / GPU

- **CPU (défaut)** : `docker compose up --build` — aucun prérequis matériel.
- **GPU** (NVIDIA Container Toolkit requis sur l'hôte) :

  ```bash
  make up-gpu
  # = docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
  ```

  L'override [`docker-compose.gpu.yml`](docker-compose.gpu.yml) réserve un GPU
  au service `inference` (`driver: nvidia`, `count: 1`) et passe
  `TORCH_VARIANT=gpu` au build, ce qui sélectionne la roue CUDA 12.1 dans le
  `Dockerfile`. Sans le bloc `torch` décommenté, cet override n'a aucun effet
  utile : le mode mock ne consomme pas de GPU.

---

## Frontend

Application Next.js 14 en **export statique** (`output: "export"` dans
[`next.config.mjs`](frontend/next.config.mjs)), donc sans serveur Node en
production : le build produit `out/`, servi tel quel par nginx.

Le code est organisé en **Feature-Sliced Design** — couches `app` → `views` →
`widgets` → `features` → `entities` → `shared`, les imports allant strictement
vers le bas. Détail des conventions, des segments et des règles d'import :
[frontend/README.md](frontend/README.md).

- [`pages/`](frontend/pages/) — routeur Next.js uniquement. `index.jsx`
  ré-exporte `views/home`, `_app.jsx` monte `AppProvider` et le CSS global.
- [`views/home`](frontend/src/views/home/) — page unique : compose l'en-tête,
  l'import et le viewer. Détient l'analyse courante, rien d'autre.
- [`features/upload-analysis`](frontend/src/features/upload-analysis/) —
  sélecteur de fichier `accept=".dcm,image/*"`, libellé « Analyse en cours… »
  pendant l'appel, message d'erreur en cas d'échec. L'analyse produite est
  remontée à la page ; la feature ne la conserve pas.
- [`features/generate-report`](frontend/src/features/generate-report/) — bouton
  « Générer le rapport PDF » puis lien « Ouvrir le rapport » vers l'URL
  présignée renvoyée par l'API.
- [`widgets/detection-viewer`](frontend/src/widgets/detection-viewer/) —
  récupère l'URL présignée, précharge l'image et la dessine dans un `<canvas>`
  à sa taille native, boîtes superposées (vert `#0F766E` pour `tooth`, rouge
  `#C0392B` pour les anomalies) avec une légende `Dent · #11 · 94 %`. Trois
  états dans
  [`use-analysis-image.js`](frontend/src/widgets/detection-viewer/model/use-analysis-image.js) :
  `loading`, `ready`, et `unavailable` — ce dernier affiche un message explicite
  (« Image non affichable… ») au lieu d'un canvas vide lorsque l'URL présignée
  n'est pas résolvable depuis le navigateur (cf.
  [Limites connues](#limites-connues)). Le tracé est isolé dans
  `lib/draw-detections.js`, sans dépendance à React.
- [`widgets/app-header`](frontend/src/widgets/app-header/) — titre et bandeau
  d'état. `/api/health` est interrogé **une seule fois, au montage** : le
  bandeau ne se rafraîchit pas ensuite. Un backend injoignable retombe sur
  « backend indisponible » sans bloquer l'UI, et le mode `mock` déclenche
  l'avertissement « détections factices ».
- [`entities/`](frontend/src/entities/) — `analysis`, `detection` et
  `system-status` : appels API, normalisation DTO → modèle (le snake_case et les
  champs `w`/`h` du backend s'arrêtent ici) et UI de présentation. Les libellés
  français des classes (`Dent`, `Carie`, `Carie profonde`, `Lésion périapicale`,
  `Dent incluse`) vivent dans `entities/detection` et suivent l'ordre déclaré
  par [`inference/app/config.py`](inference/app/config.py) — à garder
  synchronisés.
- [`shared/`](frontend/src/shared/) — client axios unique
  ([`api/client.js`](frontend/src/shared/api/client.js)), dont la base d'URL
  (`NEXT_PUBLIC_API_BASE`, défaut `/api`) et le timeout (**120 s**) viennent de
  [`config/env.js`](frontend/src/shared/config/env.js) ; normalisation de toute
  exception axios en `AppError { code, message }` avec un message français prêt
  à afficher (`network`, `timeout`, `validation`, `not_found`, `server`) ; hook
  `useAsyncAction` (`idle → pending → success | error`, qui ne rejette jamais)
  et kit UI (`Button`, `Alert`, `Card`, `FilePicker`).
- [`nginx.conf`](frontend/nginx.conf) — proxy `location /api/` →
  `http://backend:8000/api/`, `client_max_body_size 50m`, fallback SPA
  `try_files … /index.html`.

Le style repose sur des **CSS Modules** colocalisés avec chaque composant, sur
des jetons de design centralisés
([`app/styles/tokens.css`](frontend/src/app/styles/tokens.css)) et sur un
[`globals.css`](frontend/src/app/styles/globals.css) minimal importé par
`pages/_app.jsx`. Aucun style inline, aucun framework CSS.

---

## Développement local (hors Docker)

**Backend** (nécessite une base et un MinIO joignables) :

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://panoradent:panoradent@localhost:5432/panoradent
export S3_ENDPOINT=http://localhost:9000
export INFERENCE_URL=http://localhost:8001
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Astuce : `docker compose up db minio inference` pour ne lancer que les
dépendances et itérer sur le backend en local. Les variables ci-dessus peuvent
aussi être placées dans un fichier `backend/.env`, lu par `pydantic-settings`.

**Service d'inférence** :

```bash
cd inference
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Sans `weights/model.pt`, il démarre en mock — aucune dépendance ML n'est
nécessaire.

**Frontend** (hot reload sur http://localhost:3000) :

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000/api npm run dev
```

En `next dev`, il n'y a pas de proxy nginx : la variable doit pointer
directement vers le backend. Le CORS est ouvert (`*`) côté backend, ce qui rend
l'appel cross-origin possible en développement. Sous PowerShell :
`$env:NEXT_PUBLIC_API_BASE="http://localhost:8000/api"; npm run dev`.

Pour vérifier le rendu réellement servi en production (export statique) :
`npm run build` puis servir `out/` avec n'importe quel serveur de fichiers.

---

## Tests et CI

```bash
make test                  # via Docker : docker compose exec backend pytest -q
cd backend && pytest -q    # en local
```

`make test` et `make migrate` passent par `docker compose exec` : **la stack
doit déjà tourner**.

Les tests couvrent aujourd'hui l'anonymisation
([`backend/app/tests/test_anonymize.py`](backend/app/tests/test_anonymize.py)) —
un seul test : conversion en niveaux de gris, conservation des dimensions,
ré-encodage PNG (vérifié par la signature du fichier, ce qui garantit l'absence
d'EXIF). **Ni l'API, ni le stockage, ni le service d'inférence ne sont testés.**

La CI GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
exécute trois jobs en parallèle sur `push` vers `main` et sur **chaque** pull
request (toutes branches) :

| Job | Contenu |
|---|---|
| `backend` | Python 3.11, `pip install -r requirements.txt`, `pytest -q` |
| `frontend` | Node 20, `npm install`, `npm run build` (export statique) |
| `compose-build` | `docker compose build` — vérifie que les trois images se construisent |

Aucun linter ni formateur n'est configuré, et il n'y a pas de gate de couverture.

---

## Structure du dépôt

```
panoradent-ai/
├── docker-compose.yml          # orchestration (CPU)
├── docker-compose.gpu.yml      # override GPU
├── Makefile                    # raccourcis (up, up-gpu, logs, migrate, test, clean)
├── .env.example                # gabarit de configuration
├── .gitignore                  # exclut .env, *.pt, *.dcm, data/
│
├── backend/                    # FastAPI : API, anonymisation, stockage, PDF
│   ├── Dockerfile              # migre puis démarre uvicorn
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── app/
│   │   ├── main.py             # app FastAPI, CORS, montage des routers
│   │   ├── config.py           # settings pydantic (lues depuis l'env)
│   │   ├── database.py         # engine SQLAlchemy + dépendance get_db
│   │   ├── models.py           # analyses, detections, model_versions
│   │   ├── schemas.py          # DTO Pydantic exposés par l'API
│   │   ├── routers/
│   │   │   ├── health.py       # GET /api/health
│   │   │   ├── analyses.py     # CRUD analyses + image + rapport
│   │   │   └── model.py        # GET /api/model/versions
│   │   ├── services/
│   │   │   ├── anonymize.py    # DICOM + EXIF, conversion niveaux de gris
│   │   │   ├── storage.py      # S3/MinIO (put, get, URL présignée)
│   │   │   ├── inference_client.py  # appel HTTP au service d'inférence
│   │   │   └── report.py       # PDF annoté + mention légale
│   │   └── tests/
│   │       └── test_anonymize.py
│   └── alembic/
│       ├── env.py              # url injectée depuis app.config.settings
│       └── versions/0001_initial.py
│
├── inference/                  # service IA isolé (mock ou réel)
│   ├── Dockerfile              # bloc torch commenté (CPU/GPU au choix)
│   ├── requirements.txt        # ultralytics commenté
│   ├── app/
│   │   ├── main.py             # /health, /infer
│   │   ├── model.py            # chargement YOLO + génération mock
│   │   └── config.py           # chemin des poids, version, classes
│   └── weights/                # y déposer model.pt (non versionné)
│
├── frontend/                   # Next.js 14 (Feature-Sliced Design), export statique
│   ├── Dockerfile              # build node → image nginx
│   ├── README.md               # couches FSD, segments, règles d'import
│   ├── next.config.mjs         # output: "export"
│   ├── jsconfig.json           # alias @/* → src/*
│   ├── package.json
│   ├── nginx.conf              # proxy /api → backend, upload jusqu'à 50 Mo
│   ├── pages/                  # routeur Next : adaptateurs uniquement
│   │   ├── _app.jsx            # providers + CSS global
│   │   └── index.jsx           # ré-export de views/home
│   └── src/
│       ├── app/                # providers globaux, jetons de design, globals.css
│       ├── views/home/         # page composée : header + upload + viewer
│       ├── widgets/            # app-header, detection-viewer (canvas)
│       ├── features/           # upload-analysis, generate-report
│       ├── entities/           # analysis, detection, system-status
│       └── shared/             # api (axios + AppError), config, lib, ui
│
├── .github/workflows/ci.yml    # tests backend + build frontend + build images
└── docs/architecture.md
```

---

## Stack technique et dépendances

**Backend** ([`backend/requirements.txt`](backend/requirements.txt)) —
Python 3.11 :

| Paquet | Version | Rôle |
|---|---|---|
| `fastapi` / `uvicorn` | 0.111.0 / 0.30.1 | API et serveur ASGI |
| `sqlalchemy` / `psycopg2-binary` | 2.0.30 / 2.9.9 | ORM et pilote PostgreSQL |
| `alembic` | 1.13.1 | Migrations de schéma |
| `pydantic` / `pydantic-settings` | 2.7.1 / 2.2.1 | DTO et configuration |
| `python-multipart` | 0.0.9 | Upload `multipart/form-data` |
| `pydicom` | 2.4.4 | Lecture et anonymisation DICOM |
| `pillow` / `numpy` | 10.3.0 / 1.26.4 | Traitement d'image |
| `boto3` | 1.34.100 | Client S3 / MinIO |
| `reportlab` | 4.2.0 | Génération du PDF |
| `httpx` | 0.27.0 | Appels vers le service d'inférence |
| `python-jose[cryptography]` | 3.3.0 | JWT — **provisionné, non utilisé** |
| `pytest` | 8.2.0 | Tests |

**Inférence** ([`inference/requirements.txt`](inference/requirements.txt)) :
`fastapi`, `uvicorn`, `python-multipart`, `pillow`, `numpy`.
`ultralytics` et `torch` sont **commentés** — à activer pour le mode réel.

**Frontend** ([`frontend/package.json`](frontend/package.json)) — Node 20 :
`next` ^14.2.5, `react` / `react-dom` ^18.3.1, `axios` ^1.7.2.

---

## Sécurité & conformité

Rappels issus du PRD §9, appliqués dans le code :

- **Anonymisation à l'import**, **avant tout stockage** :
  - DICOM — tags identifiants écrasés (`PatientName`, `PatientID`,
    `PatientBirthDate`, `PatientAddress`, `PatientTelephoneNumbers`,
    `OtherPatientIDs`, `OtherPatientNames`, `ReferringPhysicianName`,
    `InstitutionName`, `InstitutionAddress`, `StudyDate`, `AccessionNumber`,
    `StudyID`).
  - Toutes images — EXIF supprimé par ré-encodage PNG.
  - Seuls les pixels sont conservés : le fichier d'origine n'est jamais
    persisté, ce qui rend l'écrasement des tags redondant par sécurité.
- **Aucune donnée patient identifiante en base** : uniquement des métadonnées
  techniques et des coordonnées de boîtes.
- **Images et rapports dans le stockage objet**, chiffrés au repos côté S3 en
  production ; accès uniquement par URL présignée à durée limitée (1 h,
  signature v4).
- **Mention légale obligatoire** imprimée en pied de chaque PDF : prototype non
  certifié, décision réservée au praticien
  ([`report.py`](backend/app/services/report.py)).

> ⚠️ **Les annotations incrustées dans les pixels ne sont pas retirées.**
> Certaines panoramiques portent le nom du patient, la date ou l'établissement
> gravés dans l'image elle-même. L'anonymisation actuelle ne traite que les
> métadonnées : ces incrustations survivent au pipeline et se retrouvent dans le
> stockage objet **et dans le PDF**. Un masquage de zone (ou un OCR de
> détection) est nécessaire avant tout usage sur données réelles.

### Avant toute mise en production

Cette configuration est calibrée pour le **développement local** et ne doit pas
être déployée telle quelle :

- [ ] Restreindre le CORS (actuellement `allow_origins=["*"]`, avec `allow_methods`
      et `allow_headers` également ouverts —
      [`backend/app/main.py`](backend/app/main.py)).
- [ ] Changer `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
- [ ] Ne plus exposer les ports `5432`, `9000`, `9001` et `8001` sur l'hôte.
- [ ] Activer HTTPS (terminaison TLS devant nginx).
- [ ] Ajouter authentification et contrôle d'accès sur l'API (les dépendances
      JWT sont présentes, la protection des routes reste à écrire).
- [ ] Traiter les annotations incrustées dans les pixels (cf. encadré ci-dessus).
- [ ] Héberger les données dans l'UE (RGPD) et activer le chiffrement au repos
      côté fournisseur S3.
- [ ] Mettre en place journalisation d'audit, rétention et sauvegardes.
- [ ] Épingler les images de base (`minio/minio:latest` n'est pas reproductible)
      et figer les dépendances npm (`npm ci` avec le lockfile).

---

## Limites connues

État réel du prototype, à ne pas confondre avec la cible du PRD :

**Fonctionnel**

- **Revue praticien non implémentée.** Les colonnes `reviewed` et `source`
  existent, mais aucune route ne permet de valider, corriger, ajouter ou
  supprimer une détection, et l'UI ne propose pas d'édition. Le rapport PDF
  reprend donc les détections brutes du modèle.
- **Pas d'authentification.** Toutes les routes sont ouvertes ; `JWT_SECRET` et
  `python-jose` sont provisionnés mais inutilisés.
- **Pas de suppression d'analyse.** Aucune route `DELETE`, alors que la cascade
  est en place en base.
- **Frontend mono-page** : pas de liste d'historique dans l'UI, bien que
  `GET /api/analyses` existe côté API.
- **Table `model_versions` jamais alimentée** par le code :
  `GET /api/model/versions` renvoie une liste vide tant qu'on n'insère pas les
  entrées à la main.

**Modèle**

- **Aucun modèle entraîné fourni.** Sans `inference/weights/model.pt`, les
  détections sont **factices** — utiles pour tester le pipeline, sans aucune
  valeur diagnostique.
- **`fdi` non renseigné en mode réel** : le mapping boîte → numéro de dent reste
  à écrire.
- **Bascule mock silencieuse** : un fichier de poids corrompu ou incompatible ne
  fait pas échouer le démarrage, le service repart en mock avec un simple
  message de log.
- **En mock, les anomalies partagent la boîte de la dent** : les rectangles se
  superposent exactement, ce qui est attendu et n'indique aucun bug.

**Infrastructure**

- **URLs présignées non résolvables depuis le navigateur.** Elles sont générées
  à partir de `S3_ENDPOINT=http://minio:9000`, un nom de service interne au
  réseau Docker : l'affichage de l'image dans le viewer et l'ouverture du PDF
  échouent depuis l'hôte. L'analyse elle-même (upload, inférence, persistance,
  génération du PDF côté serveur) fonctionne, et le viewer **dégrade
  proprement** — il affiche « Image non affichable… » au lieu d'un canvas vide.
  Contournements : ajouter `127.0.0.1 minio` au fichier `hosts` de la machine,
  ou faire signer les URLs avec une adresse publique
  (`http://localhost:9000`) tout en gardant l'endpoint interne pour les appels
  serveur.
- **`VITE_API_BASE` dans [docker-compose.yml](docker-compose.yml)** est un
  reliquat de la migration Vite → Next.js : il n'a aucun effet. Il est de plus
  passé en `environment` (runtime du conteneur nginx) alors que Next.js inline
  la valeur au **build** — le renommer en `NEXT_PUBLIC_API_BASE` ne suffirait
  donc pas, il faudrait un `build.args`. En l'état, le frontend retombe sur
  `/api`, qui est la valeur correcte derrière le proxy nginx.
- **Build frontend non reproductible** : le [Dockerfile](frontend/Dockerfile)
  copie `package.json` seul avant `npm install`, donc `package-lock.json` est
  ignoré ; la CI utilise également `npm install` plutôt que `npm ci`.
- **Pas de healthcheck backend ni frontend** dans Compose : `docker compose ps`
  les affiche « running » avant que l'API réponde.
- **Le PDF est écrit sans accents** (libellés `Detections proposees`, `Modele`,
  disclaimer) : les polices de base de ReportLab sont utilisées sans police
  embarquée. Il reprend en outre les **noms de classes bruts en anglais**
  (`tooth`, `deep_caries`…), là où l'UI affiche des libellés français — la table
  de traduction n'existe que côté frontend
  ([`entities/detection`](frontend/src/entities/detection/model/detection.js)).
- **Bandeau d'état non rafraîchi** : `/api/health` n'est appelé qu'au montage de
  la page. Un service qui tombe (ou qui revient) après le chargement n'est pas
  reflété tant qu'on ne recharge pas.
- **Timeout nginx à 60 s sur `/api/`** : [nginx.conf](frontend/nginx.conf) ne
  fixe pas `proxy_read_timeout`, donc la valeur par défaut de 60 s s'applique.
  Elle coïncide avec le timeout du client d'inférence : une analyse lente en
  mode réel peut être coupée en `504` par le proxy avant que le backend
  n'abandonne. Le client axios, lui, patiente 120 s.
- **Couverture de tests quasi nulle** : un seul test unitaire, sur
  l'anonymisation.
- **`Makefile`** : `up-gpu` n'est pas déclaré dans `.PHONY`, et `build`, `seed`,
  `fmt` y figurent sans cible correspondante.

---

## Feuille de route

Par ordre de valeur, en partant de l'état actuel :

1. **Rendre les URLs présignées utilisables depuis le navigateur** — dissocier
   endpoint interne et endpoint public de signature. Débloque le viewer et le
   PDF, donc la démonstration complète.
2. **Routes de revue praticien** — `PATCH`/`POST`/`DELETE` sur les détections,
   alimentation de `reviewed` et `source="human"`, puis édition dans le viewer.
   Le rapport devient un document validé plutôt qu'une sortie brute.
3. **Authentification** — protéger les routes avec les dépendances JWT déjà
   provisionnées, et restreindre le CORS.
4. **Historique dans l'UI** — brancher `GET /api/analyses`, déjà disponible.
5. **Entraînement et branchement du modèle réel** — plus mapping FDI et
   alimentation de `model_versions` à chaque déploiement de modèle.
6. **Tests d'intégration** — le mode mock étant déterministe, un test
   bout-en-bout du pipeline est peu coûteux à écrire.

---

## Dépannage

| Symptôme | Cause probable et remède |
|---|---|
| Bandeau « backend indisponible » | Le backend n'a pas fini de migrer. Suivre `docker compose logs -f backend` |
| `inference_reachable: false` | Le conteneur `inference` a crashé : `docker compose logs inference` |
| Mode toujours `mock` après ajout des poids | Poids absents de `inference/weights/model.pt`, `ultralytics`/`torch` non décommentés, ou échec de chargement — chercher `échec du chargement du modèle` dans les logs. Un rebuild (`--build`) est requis après décommentage |
| Erreur 500 à l'upload d'un DICOM | DICOM sans `pixel_array` exploitable (compression non supportée par pydicom) |
| Erreur 500 à l'upload d'une image | Format non lisible par Pillow, ou fichier tronqué |
| « Image non affichable… » dans le viewer / lien PDF mort | L'URL présignée pointe vers `http://minio:9000`, inconnu du navigateur — voir [Limites connues](#limites-connues) |
| Upload refusé au-delà de ~50 Mo | Limite `client_max_body_size` dans [frontend/nginx.conf](frontend/nginx.conf) |
| Timeout à l'analyse d'une grande image en mode réel | Le client d'inférence coupe à 60 s ([`inference_client.py`](backend/app/services/inference_client.py)), et nginx à 60 s également (`proxy_read_timeout` par défaut) |
| `504 Gateway Time-out` sur `/api/analyses` | Inférence plus lente que le timeout nginx : ajouter `proxy_read_timeout` dans [frontend/nginx.conf](frontend/nginx.conf) |
| Bandeau d'état figé après redémarrage d'un service | `/api/health` n'est lu qu'au montage : recharger la page |
| Ports déjà utilisés | Adapter les mappings dans [docker-compose.yml](docker-compose.yml) |
| `make test` / `make migrate` échouent | Ils utilisent `docker compose exec` : la stack doit être démarrée |
| Base incohérente après changement de schéma | `make clean` puis `make up` (⚠️ efface les volumes) |
| Le frontend ne reflète pas un changement de `NEXT_PUBLIC_API_BASE` | Variable de build : rebuilder l'image frontend |

---

## Commandes utiles

```bash
make up        # démarre toute la stack (CPU, build inclus)
make up-gpu    # démarre avec le service d'inférence sur GPU
make logs      # suit les logs de tous les services
make migrate   # applique les migrations (déjà fait au démarrage du backend)
make test      # tests backend dans le conteneur
make down      # arrête et retire les conteneurs
make clean     # arrête + supprime les volumes (DONNÉES PERDUES)
```

Équivalents Docker Compose directs, utiles sous Windows sans `make` :

```bash
docker compose up --build                  # = make up
docker compose logs -f backend             # logs d'un seul service
docker compose exec backend pytest -q      # = make test
docker compose exec backend alembic upgrade head   # = make migrate
docker compose exec db psql -U panoradent  # console SQL
docker compose down -v                     # = make clean
docker compose build --no-cache inference  # rebuild propre d'un service
```

---

## Licence et usage

Prototype de recherche. Non certifié dispositif médical, non conforme MDR, non
destiné à un usage clinique ou à la prise en charge de patients réels.
