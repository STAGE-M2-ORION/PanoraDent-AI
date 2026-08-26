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
| **Stack** | Next.js 14 · shadcn/ui · FastAPI · PostgreSQL 16 · MinIO · YOLO (optionnel) |
| **Prérequis** | Docker + Docker Compose v2, ~4 Go de disque. Aucun GPU requis |
| **Démarrage** | `cp .env.example .env && docker compose up --build` |

**Documentation** : [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) est la
**référence complète de la plateforme** — périmètre, exigences du PRD confrontées
à l'implémentation, méthodologie de validation, conformité, matrice de
traçabilité. Ce fichier-ci couvre la stack et son exploitation ;
[docs/architecture.md](docs/architecture.md) en donne la vue condensée ;
[frontend/README.md](frontend/README.md) détaille le Feature-Sliced Design et le
design system du client.

---

## Démarrage rapide

Ports libres attendus : `3000`, `8000`, `8001`, `5432`, `9000`, `9001`.

```bash
cp .env.example .env        # ajuster si besoin
docker compose up --build   # ou : make up
```

| Service | URL | Identifiants |
|---|---|---|
| Application web | http://localhost:3000 | — |
| Poste d'analyse | http://localhost:3000/analyse | — |
| Design system | http://localhost:3000/design-system | — |
| API (Swagger) | http://localhost:8000/docs | — |
| Service d'inférence | http://localhost:8001/health | — |
| Console MinIO | http://localhost:9001 | `minioadmin` / `minioadmin` |
| PostgreSQL | `localhost:5432` | `panoradent` / `panoradent` |

```bash
curl http://localhost:8000/api/health
# {"status":"ok","inference_reachable":true,"inference_mode":"mock"}
```

`Inférence : mock` dans le bandeau de l'application signifie que les détections
affichées sont **factices**.

**Premier essai** : depuis la page d'accueil, suivre « Analyser une panoramique »
(ou aller directement sur `/analyse`), importer n'importe quel JPG/PNG (ou
`.dcm`), puis « Générer le rapport PDF ». Les objets produits sont visibles dans MinIO (`images/`,
`reports/`). L'aperçu affiche en revanche « Image non affichable… » et le lien
PDF ne s'ouvre pas : les URLs présignées ne sont pas résolvables depuis le
navigateur en configuration par défaut — voir [Limites connues](#limites-connues).

En ligne de commande :

```bash
curl -F "file=@panoramique.jpg" http://localhost:8000/api/analyses
curl -X POST http://localhost:8000/api/analyses/<id>/report
```

Les migrations sont appliquées **automatiquement** au démarrage du backend
(`alembic upgrade head` dans le `CMD`, cf. [backend/Dockerfile](backend/Dockerfile)).

---

## Architecture

```
                 ┌─────────────┐
   navigateur ──▶│  frontend   │ Next.js (export statique) + nginx — 3000
                 └──────┬──────┘
                        │ /api  (proxy nginx → backend:8000)
                 ┌──────▼──────┐      ┌──────────────┐
                 │   backend   │─────▶│  inference   │ FastAPI + YOLO — 8001
                 │  (FastAPI)  │ HTTP │  ISOLÉ       │ (mock si pas de poids)
                 └───┬─────┬───┘      └──────────────┘
                     │     │
          ┌──────────▼─┐ ┌─▼───────────┐
          │ PostgreSQL │ │   MinIO     │ stockage objet S3
          │ métadonnées│ │ images+PDF  │ 9000 / 9001
          └────────────┘ └─────────────┘
```

Les services se résolvent par leur nom sur le réseau bridge par défaut de
Compose. Principes :

- **Service d'inférence isolé** — joint uniquement en HTTP (`POST /infer`), sans
  accès ni à la base ni au stockage : il ne reçoit que des pixels. Remplaçable
  ou déployable sur une machine GPU distincte sans toucher au backend.
- **Aucune donnée patient identifiante en base** — anonymisation à l'import,
  *avant* tout stockage.
- **Mode mock de bout en bout** — pipeline testable avant tout entraînement.
- **CPU par défaut**, GPU en option via un override Compose.
- **Migrations au démarrage** — schéma toujours à jour sans étape manuelle.

### Flux d'une analyse

1. **Import** — `POST /api/analyses` en `multipart/form-data`. Corps vide → `400`.
2. **Anonymisation** ([anonymize.py](backend/app/services/anonymize.py)) — format
   détecté par l'extension `.dcm` **ou** la signature `DICM` à l'offset 128.
   DICOM : tags identifiants écrasés, puis seul le `pixel_array` est conservé
   (normalisé 0–255, niveaux de gris). JPG/PNG : niveaux de gris et ré-encodage
   PNG, ce qui supprime l'EXIF.
3. **Stockage** — PNG anonymisé dans MinIO sous `images/<uuid>.png`. L'original
   n'est **jamais** écrit sur disque.
4. **Inférence** — le backend `POST` le PNG au service `inference`
   ([inference_client.py](backend/app/services/inference_client.py), timeout **60 s**).
5. **Persistance** — une ligne `analyses` + N `detections`, créées avec
   `source="model"` et `reviewed=false`.
6. **Revue praticien** — schéma prêt, API et UI absentes (cf. limites).
7. **Rapport PDF** — `POST /api/analyses/{id}/report` relit l'image, la ré-annote
   côté serveur, génère un PDF A4 (image, tableau, mention légale), le stocke
   sous `reports/<id>.pdf` et renvoie une URL présignée (1 h). Un second appel
   **écrase** le PDF existant.

---

## Services et ports

| Service | Build / image | Ports | Healthcheck |
|---|---|---|---|
| `frontend` | `./frontend` (node:20-alpine → nginx:alpine) | `3000` → `80` | *aucun* |
| `backend` | `./backend` (python:3.11-slim) | `8000` | *aucun* |
| `inference` | `./inference` (python:3.11-slim) | `8001` | `/health`, 10 s, 5 essais |
| `db` | `postgres:16-alpine` | `5432` | `pg_isready`, 5 s, 10 essais |
| `minio` | `minio/minio:latest` | `9000`, `9001` | `mc ready local`, 5 s, 10 essais |

**Ordre de démarrage** : `backend` attend `db` et `minio` *healthy*, mais
seulement le **lancement** de `inference` (`service_started`) — il peut donc
démarrer avant le chargement du modèle, sans conséquence. `frontend` dépend de
`backend` sans condition de santé.

**Volumes** : `db_data` et `minio_data`. `make clean` (`docker compose down -v`)
les supprime — **données perdues**.

---

## Variables d'environnement

Copier [`.env.example`](.env.example) en `.env` (jamais committé).

| Variable | Défaut | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `panoradent` | PostgreSQL |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `minioadmin` | Stockage objet (= `MINIO_ROOT_*`) |
| `S3_BUCKET` | `panoradent` | Bucket, créé à la volée |
| `MODEL_VERSION` | `mock-0.0.0` | Version tracée dans chaque analyse |
| `JWT_SECRET` | `change-me-in-prod` | **à changer** |

**Écrites en dur dans [docker-compose.yml](docker-compose.yml)**, non
surchargeables : `DATABASE_URL`, `S3_ENDPOINT` (`http://minio:9000`),
`INFERENCE_URL` (`http://inference:8001`), `MODEL_WEIGHTS_PATH`.

Le backend les lit via `pydantic-settings` ([config.py](backend/app/config.py)),
qui **ignore silencieusement** les variables inconnues.

Côté frontend, `NEXT_PUBLIC_API_BASE` (défaut `/api`) est une variable **de
build** : Next l'inline au `npm run build`, la définir au runtime nginx n'a
aucun effet.

---

## API backend

Routes préfixées par `/api`. Documentation interactive : http://localhost:8000/docs.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État backend + joignabilité et mode de l'inférence (timeout 3 s, erreurs absorbées) |
| `POST` | `/api/analyses` | Upload → anonymise, stocke, infère, persiste. Champ `file` |
| `GET` | `/api/analyses` | Liste des résumés, plus récentes d'abord |
| `GET` | `/api/analyses/{id}` | Détail + détections |
| `GET` | `/api/analyses/{id}/image` | URL présignée (1 h) vers le PNG |
| `POST` | `/api/analyses/{id}/report` | Génère le PDF, renvoie une URL présignée |
| `GET` | `/api/model/versions` | Versions de modèle + métriques (table jamais alimentée → `[]`) |

Les routes image et rapport renvoient `{"url": "…"}` — une URL présignée valable
**3600 s**, pas une redirection ni le binaire.

```json
// POST /api/analyses
{ "id": "9f1c…", "image_key": "images/9f1c….png", "report_key": null,
  "model_version": "mock-0.0.0", "inference_mode": "mock",
  "width": 1024, "height": 512,
  "detections": [ { "label": "tooth", "fdi": 11, "confidence": 0.94,
                    "x": 64, "y": 180, "w": 64, "h": 85,
                    "reviewed": false, "source": "model" } ] }
```

| Code | Cas |
|---|---|
| `400` | Fichier vide |
| `404` | `analysis_id` inconnu |
| `422` | Champ `file` absent (validation FastAPI) |
| `500` | Image/DICOM illisible, inférence indisponible, stockage injoignable |

Schémas : [`backend/app/schemas.py`](backend/app/schemas.py).

---

## Modèle de données

[`backend/app/models.py`](backend/app/models.py) (SQLAlchemy 2.0), migré par
Alembic ([`0001_initial`](backend/alembic/versions/0001_initial.py)).

- **`analyses`** — `id` (UUID), `created_at`, `image_key`, `report_key?`,
  `model_version`, `inference_mode` (`mock` | `real`), `width`, `height`.
- **`detections`** — `id`, `analysis_id` (FK `ON DELETE CASCADE`), `label`,
  `fdi?`, `confidence` (0–1), `x`/`y`/`w`/`h` en pixels, `reviewed` (défaut
  `false`), `source` (`model` | `human`). Relation en
  `cascade="all, delete-orphan"`.
- **`model_versions`** — `version` (unique), `dataset`, `metrics_json`, `notes`.

> Aucune de ces tables ne contient de donnée identifiante patient : ni nom, ni
> identifiant, ni date de naissance, ni date d'examen.

---

## Service d'inférence

Service FastAPI autonome ([`inference/`](inference/)), sans accès base ni
stockage. `GET /health` → `{status, mode, version}` ; `POST /infer` → détections.
Le modèle est chargé une seule fois au `startup`.

```json
{ "mode": "mock", "model_version": "mock-0.0.0",
  "image_size": { "width": 1024, "height": 512 },
  "detections": [ { "label": "tooth", "fdi": 11, "confidence": 0.94,
                    "bbox": [64, 180, 64, 85] } ] }
```

`bbox` = `[x, y, largeur, hauteur]` en pixels. C'est le **contrat d'interface** :
toute implémentation qui le respecte est substituable sans toucher au backend.

**Classes** ([config.py](inference/app/config.py)) : `tooth`, `caries`,
`deep_caries`, `periapical_lesion`, `impacted_tooth` — l'index renvoyé par YOLO
est mappé sur cette liste, dans cet ordre.

**Mode mock** ([model.py](inference/app/model.py)) : 6 à 12 boîtes `tooth`
réparties sur l'arcade (confiance 0,80–0,99), plus jusqu'à 3 anomalies tirées au
sort (0,55–0,90) qui **réutilisent la boîte exacte d'une dent** — la
superposition est attendue. Le générateur est initialisé sur `width`/`height` :
les détections sont **déterministes pour une taille d'image donnée**, ce qui rend
les tests reproductibles.

### Brancher le vrai modèle

1. Entraîner YOLOv11 sur DENTEX en respectant l'ordre des classes, exporter en `.pt`.
2. Déposer le fichier dans [`inference/weights/model.pt`](inference/weights/)
   (monté en lecture seule, `*.pt` exclus du dépôt).
3. Décommenter `ultralytics` dans [requirements.txt](inference/requirements.txt)
   et le bloc `torch` du [Dockerfile](inference/Dockerfile).
4. Renseigner `MODEL_VERSION` dans `.env`.
5. `docker compose up --build` — le rebuild est obligatoire.

**En cas d'échec de chargement, le service retombe silencieusement en mock**
(message `échec du chargement du modèle` dans les logs). Vérifier :

```bash
curl http://localhost:8001/health          # → {"mode":"real", ...}
docker compose logs inference | grep mode=
```

> En mode `real`, `fdi` est renvoyé à `null` : le mapping boîte → numérotation
> dentaire reste à implémenter. Les PDF afficheront `FDI -`.

---

## Environnement CPU / GPU

- **CPU (défaut)** : `docker compose up --build`.
- **GPU** (NVIDIA Container Toolkit requis) : `make up-gpu`, qui applique
  [`docker-compose.gpu.yml`](docker-compose.gpu.yml) — réserve un GPU au service
  `inference` et passe `TORCH_VARIANT=gpu` au build. Sans le bloc `torch`
  décommenté, cet override est sans effet : le mock ne consomme pas de GPU.

---

## Frontend et design system

Next.js 14 en **export statique** (`output: "export"`), servi par nginx. Code
organisé en **Feature-Sliced Design**, habillé par **shadcn/ui** sur Tailwind v4.

Conventions, couches, règles d'import et fonctionnement du design system :
**[frontend/README.md](frontend/README.md)**.

Trois routes : `/` présente la plateforme (vitrine animée avec GSAP), `/analyse`
est le poste de travail — import, détections, rapport —, `/design-system` le
catalogue des composants.

Le projet expose sa propre documentation de design à
**http://localhost:3000/design-system** — **55 composants** en huit onglets
(Fondations, Base, Formulaires, Données, Navigation, Surcouches, Retours,
Métier). La page rend les **vrais composants**, elle ne peut donc pas diverger
de l'application ; elle n'appelle aucune API.

Points structurants :

- Les composants shadcn sont **copiés dans le dépôt**
  ([`src/shared/ui/`](frontend/src/shared/ui/)), pas installés en dépendance.
  `shared/ui/index.js` est **généré** (`npm run ui:index`).
- Jetons en **OKLCH** dans [globals.css](frontend/src/app/styles/globals.css),
  convertis depuis la charte teal `#0F766E` / `#134E4A` sans dérive de teinte.
  Plus aucun CSS Module.
- `package.json` déclare `"sideEffects": ["*.css"]` — sans quoi le baril
  d'exports embarque les 55 composants dans chaque page (JS partagé : 137 ko
  avec, 213 ko sans).
- [nginx.conf](frontend/nginx.conf) : `try_files $uri $uri.html $uri/ /index.html`.
  Le `$uri.html` est **indispensable** — l'export produit `design-system.html`,
  pas `design-system/index.html`.

---

## Développement local (hors Docker)

**Backend** (nécessite base et MinIO joignables) :

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://panoradent:panoradent@localhost:5432/panoradent
export S3_ENDPOINT=http://localhost:9000 INFERENCE_URL=http://localhost:8001
alembic upgrade head && uvicorn app.main:app --reload --port 8000
```

Astuce : `docker compose up db minio inference` pour ne lancer que les
dépendances.

**Inférence** : `cd inference && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8001`
(démarre en mock, aucune dépendance ML nécessaire).

**Frontend** : `cd frontend && npm install && NEXT_PUBLIC_API_BASE=http://localhost:8000/api npm run dev`.
En `next dev` il n'y a pas de proxy nginx : la variable doit pointer vers le
backend. Sous PowerShell : `$env:NEXT_PUBLIC_API_BASE="…"; npm run dev`.

---

## Tests et CI

```bash
make test                  # docker compose exec backend pytest -q (stack démarrée)
cd backend && pytest -q    # en local
```

Un seul test aujourd'hui, sur l'anonymisation
([test_anonymize.py](backend/app/tests/test_anonymize.py)) : niveaux de gris,
dimensions conservées, ré-encodage PNG sans EXIF. **Ni l'API, ni le stockage, ni
l'inférence ne sont testés.**

La CI ([ci.yml](.github/workflows/ci.yml)) exécute trois jobs en parallèle sur
`push` vers `main` et chaque pull request : `backend` (pytest), `frontend`
(`npm ci` + build), `compose-build` (`docker compose build`). Aucun linter, pas
de gate de couverture.

---

## Structure du dépôt

```
panoradent-ai/
├── docker-compose.yml / .gpu.yml   # orchestration CPU / override GPU
├── Makefile · .env.example
├── backend/                        # FastAPI : API, anonymisation, stockage, PDF
│   ├── Dockerfile                  # migre puis démarre uvicorn
│   └── app/
│       ├── main.py · config.py · database.py · models.py · schemas.py
│       ├── routers/                # health, analyses, model
│       ├── services/               # anonymize, storage, inference_client, report
│       └── tests/
├── inference/                      # service IA isolé (mock ou réel)
│   ├── Dockerfile                  # bloc torch commenté
│   ├── app/                        # main.py, model.py, config.py
│   └── weights/                    # y déposer model.pt (non versionné)
├── frontend/                       # Next.js 14, FSD, shadcn/ui, export statique
│   ├── Dockerfile · .dockerignore  # npm ci ; exclut node_modules (binaires natifs)
│   ├── components.json             # config shadcn → @/shared/ui
│   ├── scripts/generate-ui-index.mjs
│   ├── pages/                      # routeur Next : adaptateurs uniquement
│   └── src/                        # app · views · widgets · features · entities · shared
├── .github/workflows/ci.yml
└── docs/architecture.md
```

**Dépendances** — backend : `fastapi`, `sqlalchemy`, `alembic`, `pydantic`,
`pydicom`, `pillow`, `numpy`, `boto3`, `reportlab`, `httpx`, `python-jose`
(*provisionné, non utilisé*), `pytest`. Inférence : `fastapi`, `pillow`,
`numpy` — `ultralytics` et `torch` commentés. Frontend : `next`, `react`,
`axios`, `tailwindcss` v4, `radix-ui`/`@base-ui/react`, `lucide-react`, plus les
paquets tirés par les composants shadcn (`react-hook-form`, `zod`, `recharts`,
`cmdk`, `vaul`, `embla-carousel-react`, `react-day-picker`, `sonner`…) et
`gsap`/`@gsap/react` pour les animations de la vitrine. Ces derniers ne pèsent
que sur les pages qui les utilisent — premier chargement par route :

| Route | Poids de la page | Premier chargement |
|---|---|---|
| `/` (vitrine) | 52,1 ko | **193 ko** |
| `/analyse` | 6,4 ko | **147 ko** |
| `/design-system` | 252 ko | **375 ko** |

Le poste d'analyse, seule route réellement utilisée en séance, reste la plus
légère. Les 46 ko qui séparent la vitrine du poste couvrent GSAP, ScrollTrigger
et le code des sections.

---

## Sécurité & conformité

- **Anonymisation à l'import, avant tout stockage.** DICOM : tags identifiants
  écrasés (`PatientName`, `PatientID`, `PatientBirthDate`, `StudyDate`,
  `InstitutionName`… — liste complète dans
  [anonymize.py](backend/app/services/anonymize.py)). Toutes images : EXIF
  supprimé par ré-encodage PNG. Seuls les pixels sont conservés.
- **Aucune donnée identifiante en base** : métadonnées techniques et
  coordonnées de boîtes uniquement.
- **Images et rapports dans le stockage objet**, accessibles uniquement par URL
  présignée à durée limitée (1 h, signature v4).
- **Mention légale** imprimée en pied de chaque PDF.

> ⚠️ **Les annotations incrustées dans les pixels ne sont pas retirées.**
> Certaines panoramiques portent le nom du patient ou l'établissement gravés
> dans l'image. Ces incrustations survivent au pipeline et se retrouvent dans le
> stockage **et dans le PDF**. Un masquage de zone est nécessaire avant tout
> usage sur données réelles.

### Avant toute mise en production

Cette configuration vise le **développement local** :

- [ ] Restreindre le CORS (actuellement `allow_origins=["*"]`).
- [ ] Changer `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
- [ ] Ne plus exposer `5432`, `9000`, `9001`, `8001` sur l'hôte.
- [ ] Activer HTTPS (terminaison TLS devant nginx).
- [ ] Ajouter authentification et contrôle d'accès (dépendances JWT présentes,
      protection des routes à écrire).
- [ ] Traiter les annotations incrustées dans les pixels.
- [ ] Héberger dans l'UE (RGPD), chiffrement au repos côté S3.
- [ ] Journalisation d'audit, rétention, sauvegardes.
- [ ] Épingler les images de base (`minio/minio:latest` n'est pas reproductible).

---

## Limites connues

**Fonctionnel** — revue praticien non implémentée (colonnes `reviewed`/`source`
présentes, aucune route ni UI d'édition) · pas d'authentification · pas de route
`DELETE` · frontend mono-page, sans historique bien que `GET /api/analyses`
existe · table `model_versions` jamais alimentée.

**Modèle** — aucun modèle entraîné fourni, les détections sont **factices** et
sans valeur diagnostique · `fdi` non renseigné en mode réel · bascule mock
**silencieuse** en cas de poids illisibles · en mock, les anomalies partagent la
boîte de la dent (attendu).

**Infrastructure**

- **URLs présignées non résolvables depuis le navigateur** — signées avec
  `S3_ENDPOINT=http://minio:9000`, nom interne au réseau Docker. L'analyse et la
  génération du PDF côté serveur fonctionnent ; le viewer **dégrade proprement**
  (« Image non affichable… »). Contournements : ajouter `127.0.0.1 minio` au
  fichier `hosts`, ou signer avec une adresse publique tout en gardant
  l'endpoint interne pour les appels serveur.
- **`VITE_API_BASE` dans [docker-compose.yml](docker-compose.yml)** est un
  reliquat de la migration Vite → Next.js, sans effet. Le renommer ne suffirait
  pas : passé en `environment`, il faudrait un `build.args`. Le frontend retombe
  sur `/api`, qui est la bonne valeur derrière le proxy.
- **`package.json` / `package-lock.json` à la racine du dépôt** déclarent
  `gsap-animations-lionel`, installé hors du frontend et **importé nulle part**.
  Le monorepo n'a pas de workspace npm : les dépendances du client vivent dans
  [frontend/package.json](frontend/package.json), et le build Docker n'utilise
  que celui-ci. Ces trois entrées (avec `node_modules/` racine) sont supprimables.
- **Timeout nginx à 60 s sur `/api/`** (`proxy_read_timeout` non fixé), identique
  au timeout du client d'inférence : une analyse lente en mode réel peut être
  coupée en `504` avant que le backend n'abandonne. Le client axios patiente 120 s.
- **PDF sans accents** (polices de base ReportLab) et **noms de classes bruts en
  anglais** — la table de traduction n'existe que côté frontend.
- **Thème sombre non appliqué à l'application** : les jetons `.dark` existent et
  se prévisualisent sur `/design-system`, mais les couleurs de tracé du canvas
  sont figées en clair dans `entities/detection`.
- **Pas de healthcheck backend ni frontend** dans Compose.
- **Couverture de tests quasi nulle** · `Makefile` : `up-gpu` absent de `.PHONY`,
  et `build`/`seed`/`fmt` déclarés sans cible.

---

## Feuille de route

1. **Rendre les URLs présignées utilisables depuis le navigateur** — dissocier
   endpoint interne et endpoint public de signature. Débloque la démonstration.
2. **Routes de revue praticien** — `PATCH`/`POST`/`DELETE`, puis édition dans le
   viewer. Le rapport devient un document validé.
3. **Authentification** — protéger les routes, restreindre le CORS.
4. **Historique dans l'UI** — `GET /api/analyses` est déjà disponible.
5. **Modèle réel** — entraînement, mapping FDI, alimentation de `model_versions`.
6. **Tests d'intégration** — le mock étant déterministe, un test bout-en-bout est
   peu coûteux.

---

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Bandeau « backend indisponible » | Migrations en cours : `docker compose logs -f backend` |
| `inference_reachable: false` | Conteneur `inference` crashé : `docker compose logs inference` |
| Mode toujours `mock` après ajout des poids | Poids absents, `ultralytics`/`torch` non décommentés, ou échec de chargement (chercher `échec du chargement` dans les logs). Rebuild requis |
| Erreur 500 à l'upload | DICOM sans `pixel_array` exploitable, ou format illisible par Pillow |
| « Image non affichable… » / lien PDF mort | URL présignée vers `http://minio:9000` — voir [Limites connues](#limites-connues) |
| Upload refusé > ~50 Mo | `client_max_body_size` dans [nginx.conf](frontend/nginx.conf) |
| `504` sur `/api/analyses` | Inférence plus lente que le timeout nginx : ajouter `proxy_read_timeout` |
| Bandeau figé après redémarrage d'un service | `/api/health` est relu toutes les 30 s (et au retour sur l'onglet) : patienter, ou recharger |
| `make test` / `make migrate` échouent | Ils utilisent `docker compose exec` : la stack doit tourner |
| Base incohérente après changement de schéma | `make clean` puis `make up` (⚠️ efface les volumes) |
| Changement de `NEXT_PUBLIC_API_BASE` sans effet | Variable de build : rebuilder l'image frontend |

---

## Commandes utiles

```bash
make up / up-gpu / logs / migrate / test / down / clean
```

Équivalents directs, utiles sous Windows sans `make` :

```bash
docker compose up --build                          # = make up
docker compose up -d frontend                      # recrée un seul service
docker compose logs -f backend
docker compose exec backend pytest -q              # = make test
docker compose exec backend alembic upgrade head   # = make migrate
docker compose exec db psql -U panoradent
docker compose down -v                             # = make clean (DONNÉES PERDUES)
```

---

## Licence et usage

Prototype de recherche. Non certifié dispositif médical, non conforme MDR, non
destiné à un usage clinique ou à la prise en charge de patients réels.
