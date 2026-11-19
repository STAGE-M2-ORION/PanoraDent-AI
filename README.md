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
| **Stack** | Next.js 14 · design system maison · FastAPI · PostgreSQL 16 · MinIO · YOLO (optionnel) |
| **Prérequis** | Docker + Docker Compose v2, ~4 Go de disque. Aucun GPU requis |
| **Démarrage** | `cp .env.example .env && docker compose up --build` |

**Documentation** : [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) est la
**référence complète de la plateforme** — périmètre, exigences du PRD confrontées
à l'implémentation, méthodologie de validation, conformité, matrice de
traçabilité. Ce fichier-ci couvre la stack et son exploitation ;
[docs/architecture.md](docs/architecture.md) en donne la vue condensée ;
[training/README.md](training/README.md) détaille le pipeline d'entraînement,
les datasets et la méthodologie de validation ;
[frontend/README.md](frontend/README.md) détaille le Feature-Sliced Design et le
design system du client.

---

## Démarrage rapide

Ports libres attendus : `3000`, `8000`, `8001`, `5432` (ou `DB_PORT`), `9000`, `9001`.

```bash
cp .env.example .env        # ajuster si besoin
docker compose up --build   # ou : make up
```

| Service | URL | Identifiants |
|---|---|---|
| Application web | http://localhost:3000 | — |
| Connexion | http://localhost:3000/connexion | compte Google `ADMIN_EMAIL` du `.env` (voir [Authentification](#authentification-et-rôles)) |
| Poste d'analyse | http://localhost:3000/analyse | session requise |
| Administration | http://localhost:3000/admin/comptes | rôle avec `user:manage` / `role:manage` |
| Design system | http://localhost:3000/design-system | — |
| API (Swagger) | http://localhost:8000/docs | — |
| Service d'inférence | http://localhost:8001/health | — |
| Console MinIO | http://localhost:9001 | `minioadmin` / `minioadmin` |
| PostgreSQL | `localhost:5432` | `panoradent` / `panoradent` |

```bash
curl http://localhost:8000/api/v1/health
# {"status":"ok","inference_reachable":true,"inference_mode":"mock"}
```

En mode `mock`, le poste de lecture affiche « Mode démonstration du modèle » et la
supervision marque l'inférence « Dégradé » : les détections affichées sont **factices**.

**Premier essai** : renseigner `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `ADMIN_EMAIL`
(votre adresse Google) dans `.env`, se connecter sur `/connexion` avec « Continuer avec Google »,
puis ouvrir « Nouvelle analyse » dans la barre latérale (`/nouvelle-analyse`), importer
n'importe quel JPG/PNG (ou `.dcm`), « Ouvrir la relecture », puis « Générer le compte rendu »
› « Télécharger le PDF ». Les objets produits sont visibles dans MinIO (`images/`,
`reports/`). L'image et le PDF sont servis au navigateur par le proxy nginx
(`/storage/`, voir [Limites connues](#limites-connues)).

La session vit dans des cookies `httpOnly` posés au retour de Google : pour essayer
l'API, ouvrir une session dans le navigateur, pas avec `curl`.

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
- **Entraînement hors ligne** — le pipeline [`training/`](training/) n'est
  embarqué dans aucun conteneur et ne tourne pas dans la stack. Le seul
  artefact qui franchit la frontière est un fichier de poids `.pt`.
- **Aucune donnée patient identifiante en base** — anonymisation à l'import,
  *avant* tout stockage.
- **Mode mock de bout en bout** — pipeline testable avant tout entraînement.
- **CPU par défaut**, GPU en option via un override Compose.
- **Migrations au démarrage** — schéma toujours à jour sans étape manuelle.

### Flux d'une analyse

1. **Import** — `POST /api/v1/analyses` en `multipart/form-data`. Corps vide → `400`.
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
7. **Rapport PDF** — `POST /api/v1/analyses/{id}/report` relit l'image, la ré-annote
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
| `minio` | `pgsty/minio:latest` | `9000`, `9001` | `mc ready local`, 5 s, 10 essais |

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
| `MODEL_STRICT` | `0` | `1` = le service d'inférence **refuse de démarrer** au lieu de retomber en mock. À activer dès qu'un modèle est branché |
| `MODEL_IMAGE_SIZE` | `640` | Taille d'entrée du modèle — **doit être identique** au `--imgsz` de l'entraînement |
| `MODEL_CONF_THRESHOLD` | `0.25` | Seuil de confiance en mode réel |
| `ASSIGN_FDI` | `1` | Numérotation FDI déduite de la géométrie des boîtes |
| `APP_ENV` | `development` | `production` : le backend **refuse de démarrer** si `JWT_SECRET` est la valeur par défaut ou fait moins de 32 caractères, ou sans client Google |
| `JWT_SECRET` | `change-me-in-prod` | **Obligatoire hors développement** : secret long et aléatoire (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(vide)* | Client OAuth de la console Google. **Obligatoires** en production ; le secret ne vit que côté serveur |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/v1/auth/google/retour` | URI de retour, déclarée **exactement** dans la console Google |
| `APP_URL` | `http://localhost:3000` | Destination après connexion (et `/connexion?erreur=…` en cas de refus) |
| `GOOGLE_ALLOWED_DOMAIN` | *(vide)* | Restreint la connexion à un domaine Google Workspace |
| `ADMIN_EMAIL` | *(vide)* | **Adresse Google** de l'administrateur initial, créé par le jeu de départ |
| `IDENTITY_PROVIDER` | `google` | `fake` = fournisseur de remplacement des tests, **refusé hors** `APP_ENV=test` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | `15` / `7` | Durée de vie des jetons |
| `ALLOWED_ORIGINS` | `["http://localhost:3000"]` | Origines CORS, **au format JSON**. Sans effet derrière nginx (même origine) ; utile avec `next dev` |
| `DB_PORT` | `5432` | Port PostgreSQL publié sur l'hôte (`5433` si un PostgreSQL local occupe déjà 5432) |

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

Routes préfixées par `/api/v1`. Documentation interactive : http://localhost:8000/docs.

**Toutes les routes exigent une session** (cookie `pd_acces`) et la permission
indiquée, sauf celles marquées publiques (`health` et le parcours de connexion).
Sans session : `401` ; permission absente : `403`. Toute erreur a la forme
`{"code": "...", "message": "..."}` (message français affichable tel quel).
Authentification, comptes et rôles : voir [Authentification et rôles](#authentification-et-rôles).

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/v1/health` | État backend + joignabilité et mode de l'inférence (timeout 3 s, erreurs absorbées) |
| `POST` | `/api/v1/analyses` | Upload → anonymise, stocke, infère, persiste. Champ `file` |
| `GET` | `/api/v1/analyses` | Liste des résumés, plus récentes d'abord |
| `GET` | `/api/v1/analyses/{id}` | Détail + détections |
| `GET` | `/api/v1/analyses/{id}/image` | URL présignée (1 h) vers le PNG |
| `POST` | `/api/v1/analyses/{id}/report` | Génère le PDF, renvoie une URL présignée |
| `GET` | `/api/v1/model/versions` | Versions de modèle + métriques. Alimentée par [`training/publish_model.py`](training/publish_model.py) ; `[]` tant qu'aucun modèle n'a été publié |

Les routes image et rapport renvoient `{"url": "…"}` — une URL présignée valable
**3600 s**, pas une redirection ni le binaire.

```json
// POST /api/v1/analyses
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

## Authentification et rôles

Prototype de recherche : l'authentification protège l'accès aux analyses, elle ne
fait **pas** de cette plateforme un dispositif médical certifié.

**Google uniquement.** La connexion passe par un compte Google (OAuth 2.0 + OpenID
Connect, code d'autorisation avec PKCE, mené côté serveur). La plateforme ne
conserve **aucun mot de passe** : ni mot de passe provisoire, ni réinitialisation.
**Pas d'inscription publique** : l'administrateur crée le compte avec l'adresse
Google de l'intéressé ; une adresse inconnue est refusée et aucun compte n'est créé.

**Mise en place.**
1. Console Google Cloud › API et services › Identifiants › « ID client OAuth »
   (Application Web). URI de redirection autorisée, **exactement** :
   `http://localhost:3000/api/v1/auth/google/retour` (développement) et celle du
   cabinet. Écran de consentement : portées `openid`, `email`, `profile`.
2. `.env` : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (côté serveur seulement),
   `GOOGLE_REDIRECT_URI`, `APP_URL`, et `ADMIN_EMAIL` = **votre adresse Google** :
   sans elle, personne ne peut ouvrir la première session.
3. `GOOGLE_ALLOWED_DOMAIN` (optionnel) restreint la connexion au domaine Google
   Workspace du cabinet ; vide par défaut, pour ne pas exclure un praticien qui
   utilise une adresse personnelle.

**Premier démarrage.** Après `alembic upgrade head`, le backend lance
`python -m app.seed_auth`, rejouable sans erreur : huit permissions, trois rôles
système, et le compte administrateur `ADMIN_EMAIL`.

**Parcours.** `GET /api/v1/auth/google/demarrer` tire `state`, `nonce` et le couple
PKCE, les garde dans un cookie de 10 min et redirige chez Google. Au retour
(`GET /api/v1/auth/google/retour`), le serveur vérifie que `state` est identique au
cookie, échange le code avec le `code_verifier`, puis vérifie le jeton d'identité :
signature (clés publiques Google mises en cache et rechargées si une clé inconnue
se présente), `iss`, `aud` = notre client, `exp`, `nonce`, `email_verified`
(bibliothèque officielle `google-auth`). Cette route est une navigation : elle
redirige toujours, vers l'application ou vers `/connexion?erreur=<code>` avec
`compte_inconnu`, `compte_desactive`, `adresse_non_verifiee`, `etat_invalide` ou
`echec_google`.

**Identité.** Le `sub` Google est enregistré à la première connexion et identifie
ensuite l'utilisateur. Un `sub` connu avec une nouvelle adresse met la ligne à jour ;
une adresse connue avec un autre `sub` est refusée et journalisée.

**Session.** Jeton d'accès 15 min (utilisateur, session, rôle, permissions) et
jeton de rafraîchissement 7 j (identifiant de session), tous deux en cookies
`httpOnly; Secure; SameSite=Lax`, jamais lisibles par le JavaScript.
`POST /api/v1/auth/rafraichir` repose le jeton d'accès ; `POST /api/v1/auth/deconnexion`
marque la session révoquée et efface les deux cookies. Chaque requête vérifie que
la session n'est pas révoquée : la déconnexion ou la désactivation d'un compte
coupe l'accès immédiatement.

**Autorisation.** Une dépendance unique, `exiger("analysis:read")`, décode le jeton,
charge l'utilisateur, vérifie qu'il est actif et que la permission figure dans son
rôle. Les routes déclarent la **permission**, jamais le rôle. Un test parcourt toutes
les routes et échoue si l'une d'elles ne porte ni garde ni marque `publique`.

| Permission | Route(s) protégée(s) |
|---|---|
| `analysis:create` | `POST /api/v1/analyses` |
| `analysis:read` | `GET /api/v1/analyses`, `/{id}`, `/{id}/image` |
| `analysis:delete`, `detection:review` | *définies, aucune route pour l'instant* |
| `report:generate` | `POST /api/v1/analyses/{id}/report` |
| `model:read` | `GET /api/v1/model/versions` |
| `user:manage` | `/api/v1/utilisateurs` (liste, création, modification) |
| `role:manage` | `/api/v1/permissions`, `/api/v1/roles` (écriture) — `GET /api/v1/roles` est aussi ouvert à `user:manage` |

| Rôle système | Permissions |
|---|---|
| Administrateur | les huit (resynchronisées à chaque démarrage) |
| Praticien | `analysis:create/read/delete`, `detection:review`, `report:generate`, `model:read` |
| Lecteur | `analysis:read`, `model:read` |

**Endpoints.** `GET /api/v1/moi` ; `GET|POST /api/v1/utilisateurs`,
`GET|PATCH /api/v1/utilisateurs/{id}` (pas de suppression : on désactive) ;
`GET /api/v1/permissions`, `GET|POST /api/v1/roles`, `GET|PATCH|DELETE /api/v1/roles/{id}`.
Garde-fou **dernier administrateur** : impossible de désactiver ou rétrograder le
dernier compte actif capable de gérer utilisateurs *et* rôles (`400`).

**Photo de profil.** La photo du compte Google (revendication `picture`, acceptée
seulement en HTTPS depuis `*.googleusercontent.com`) est reprise à chaque connexion.
Chacun peut importer la sienne depuis `/profil` (`PUT /api/v1/moi/photo`, JPEG/PNG/WebP,
5 Mo au plus), prioritaire sur Google, ou la retirer (`DELETE /api/v1/moi/photo`).
L'image est recadrée en 256 × 256 et ré-encodée en WebP (métadonnées EXIF supprimées),
stockée dans MinIO et servie par `GET /api/v1/photos/{id}` à toute session ouverte.
Sans photo : initiales.

**Journal.** Connexions réussies, refus avec leur motif, créations et modifications
de compte, déconnexions sont inscrits dans la table `journal` (écran prévu plus tard).

**Limite assumée : connexion hors ligne.** La connexion exige un accès à Internet
alors que le serveur est installé au cabinet. Si la liaison tombe, les sessions
déjà ouvertes continuent (jusqu'à 7 jours), mais **personne ne peut en ouvrir une
nouvelle**. Choix retenu : l'accepter et le documenter, plutôt que de rouvrir un
compte de secours à mot de passe.

**Tests.** Google refuse l'automatisation : les tests utilisent un fournisseur
d'identité de remplacement (`IDENTITY_PROVIDER=fake`) qui signe localement ses jetons ;
le backend refuse de démarrer avec lui hors `APP_ENV=test`. Il prouve la logique,
pas la configuration de la console Google : une vraie connexion manuelle reste
nécessaire.

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
- **Authentification** (migration `0003_auth_google`, qui remplace `0002`) :
  `utilisateur` (UUID, `nom`, `prenom`, `email` unique en minuscules, `google_sub`
  unique, `role_id` restreint, `statut` `actif|desactive`, `derniere_connexion`,
  `date_creation`), `role` (`libelle` unique, `systeme`), `permission` (`code` clé
  primaire, `libelle`), `role_permission`, `session` (création, expiration,
  révocation), `journal` (date, action, auteur, adresse IP, résultat, détail).
  Aucune colonne de mot de passe.

> Les tables d'analyse ne contiennent aucune donnée identifiante patient : ni nom,
> ni identifiant, ni date de naissance, ni date d'examen. Les tables
> d'authentification ne décrivent que les comptes des utilisateurs de la plateforme
> (praticiens, administrateurs), jamais des patients.

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

**Numérotation FDI** ([fdi.py](inference/app/fdi.py)) — le détecteur renvoie
des boîtes et une classe, **jamais un numéro de dent**. Le FDI est donc déduit
après l'inférence : `width / 2` sépare les côtés (l'image est vue *face au
patient*, sa droite est à gauche des pixels), un 2-moyennes sur les ordonnées
des boîtes situe le plan d'occlusion — qui n'est **pas** à mi-hauteur de l'image
—, puis chaque dent reçoit sa position en s'éloignant de la médiane. Les
anomalies **héritent** du numéro de la dent qu'elles recouvrent à plus de 50 % ;
sans recouvrement, `fdi` reste `null` plutôt qu'inventé. Désactivable par
`ASSIGN_FDI=0`.

**Mode mock** ([model.py](inference/app/model.py)) : 6 à 12 boîtes `tooth`
réparties sur l'arcade (confiance 0,80–0,99), plus jusqu'à 3 anomalies tirées au
sort (0,55–0,90) qui **réutilisent la boîte exacte d'une dent** — la
superposition est attendue. Le générateur est initialisé sur `width`/`height` :
les détections sont **déterministes pour une taille d'image donnée**, ce qui rend
les tests reproductibles.

### Brancher le vrai modèle

1. **Entraîner** — tout est dans [training/README.md](training/README.md). Le
   pipeline vit dans [`training/`](training/) et tourne **hors de la stack**
   (Colab ou machine GPU). `train.py` refuse de démarrer si l'ordre des classes
   du dataset diverge de [config.py](inference/app/config.py).
2. **Publier** — `python training/publish_model.py … --install` dépose les poids
   dans [`inference/weights/model.pt`](inference/weights/) (monté en lecture
   seule, `*.pt` exclus du dépôt) et écrit les métriques dans `model_versions`.
3. Décommenter `ultralytics` dans [requirements.txt](inference/requirements.txt)
   et le bloc `torch` du [Dockerfile](inference/Dockerfile).
4. Renseigner `MODEL_VERSION`, `MODEL_STRICT=1` et `MODEL_IMAGE_SIZE` dans `.env`.
5. `docker compose up --build` — le rebuild est obligatoire.

**`MODEL_STRICT=1` est le réglage qui compte.** Par défaut, des poids illisibles
font retomber le service en mock **sans lever d'erreur** (message `échec du
chargement du modèle` dans les logs) : on sert alors des détections factices en
croyant servir un modèle. Avec `MODEL_STRICT=1`, le service refuse de démarrer.

```bash
curl http://localhost:8001/health          # → {"mode":"real", ...}
docker compose logs inference | grep mode=
```

> `MODEL_IMAGE_SIZE` doit être **identique** au `--imgsz` de l'entraînement. Une
> divergence ne provoque aucune erreur : elle dégrade les détections en silence.

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
organisé en **Feature-Sliced Design**. L'interface reproduit la **maquette haute
fidélité** de [`docs/maquette/`](docs/maquette/) : son design system (jetons,
icônes duotone, composants, graphiques) est écrit dans le dépôt, sans
bibliothèque d'interface ([`frontend/src/shared/ui/`](frontend/src/shared/ui/)).

Conventions, couches, routes, design system et part des données de démonstration :
**[frontend/README.md](frontend/README.md)**.

Écrans : vitrine (`/`), connexion, tableau de bord, nouvelle analyse, historique,
poste de lecture (`/analyse`), compte rendu, profil, performance du modèle et
administration (comptes, rôles, journal d'audit, supervision). Catalogue vivant
du design system : **http://localhost:3000/design-system**.

Points structurants :

- Styles de la maquette découpés par composant dans
  [`shared/ui/styles/`](frontend/src/shared/ui/styles/) ; le CSS propre à chaque
  écran est confiné sous la classe racine de sa vue (`.v-<écran>`).
- Quatre dépendances d'exécution seulement : Next, React, React DOM et axios.
- [nginx.conf](frontend/nginx.conf) : `try_files $uri $uri.html $uri/ /index.html`.
  Le `$uri.html` est **indispensable** — l'export produit `historique.html`,
  pas `historique/index.html`.

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
make test                    # backend + inférence (stack démarrée)
cd backend   && pytest -q    # en local
cd inference && pytest -q
```

**Backend** — un seul test, sur l'anonymisation
([test_anonymize.py](backend/app/tests/test_anonymize.py)) : niveaux de gris,
dimensions conservées, ré-encodage PNG sans EXIF. **Ni l'API ni le stockage ne
sont testés.**

**Inférence** — neuf tests sur la numérotation FDI
([test_fdi.py](inference/app/tests/test_fdi.py)) : denture complète couvrant les
quatre quadrants, convention droite patient / gauche image, héritage du numéro
par les anomalies, plan d'occlusion déduit malgré un cadrage décentré, arcade
unique, écrêtage à la huitième position. Ils n'exigent ni image ni modèle : la
numérotation est purement géométrique.

La CI ([ci.yml](.github/workflows/ci.yml)) exécute quatre jobs en parallèle sur
`push` vers `main` et chaque pull request : `backend` (pytest), `inference`
(pytest), `frontend` (`npm ci` + build), `compose-build` (`docker compose
build`). Aucun linter, pas de gate de couverture. **Le pipeline
[`training/`](training/) n'est pas couvert** : il exige torch et un GPU.

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
│   ├── app/                        # main.py · model.py · config.py · fdi.py
│   │   └── tests/                  # test_fdi.py
│   └── weights/                    # y déposer model.pt (non versionné)
├── training/                       # entraînement — HORS de la stack Docker
│   ├── prepare_dataset.py          # COCO → YOLO, découpage par patient
│   ├── train.py · evaluate.py      # ultralytics · métriques par classe
│   ├── publish_model.py            # model_versions + dépôt des poids
│   └── notebooks/                  # colab_panoradent.ipynb
├── frontend/                       # Next.js 14, FSD, design system maison, export statique
│   ├── Dockerfile · .dockerignore  # npm ci ; exclut node_modules (binaires natifs)
│   ├── public/                     # polices, logos et illustrations de la maquette
│   ├── pages/                      # routeur Next : adaptateurs uniquement
│   └── src/                        # app · views · widgets · features · entities · shared
├── .github/workflows/ci.yml
└── docs/                           # architecture.md · DOCUMENTATION.md
```

**Dépendances** — backend : `fastapi`, `sqlalchemy`, `alembic`, `pydantic`,
`pydicom`, `pillow`, `numpy`, `boto3`, `reportlab`, `httpx`, `python-jose`,
`google-auth`, `email-validator`, `pytest`. Inférence : `fastapi`, `pillow`,
`numpy`, `pytest` — `ultralytics` et `torch` commentés. Entraînement
([`training/requirements.txt`](training/requirements.txt), **jamais installé
dans un conteneur**) : `ultralytics`, `torch`, `torchvision`, `sqlalchemy`.
Frontend : `next`, `react`, `react-dom`, `axios` — rien d'autre à l'exécution :
le design system, les icônes et les graphiques sont écrits dans le dépôt.
Premier chargement par route : de 106 ko (redirections) à 135 ko (`/analyse`,
le poste de lecture complet) ; vitrine 123 ko, catalogue `/design-system` 126 ko.

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

- [x] CORS restreint à `ALLOWED_ORIGINS` (plus de `*`).
- [ ] Définir `APP_ENV=production` et un `JWT_SECRET` aléatoire (le backend refuse sinon de démarrer) ; changer `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`/`S3_SECRET_KEY` ; déclarer l'URI de redirection du cabinet dans la console Google.
- [ ] Ne plus exposer `5432`, `9000`, `9001`, `8001` sur l'hôte.
- [ ] Activer HTTPS (terminaison TLS devant nginx).
- [x] Connexion Google et contrôle d'accès par permissions — voir plus haut.
- [x] Jetons en cookies `httpOnly; Secure; SameSite=Lax`.
- [ ] 2FA / SSO, journal d'audit des connexions et des actions (travaux futurs).
- [ ] Traiter les annotations incrustées dans les pixels.
- [ ] Héberger dans l'UE (RGPD), chiffrement au repos côté S3.
- [ ] Journalisation d'audit, rétention, sauvegardes.
- [ ] Épingler les images de base (`pgsty/minio:latest` n'est pas reproductible).

---

## Limites connues

**Fonctionnel** — revue praticien non implémentée (colonnes `reviewed`/`source`
présentes, aucune route ni UI d'édition) · permissions `detection:review` et `analysis:delete` définies mais sans route correspondante · pas de route
`DELETE` · frontend mono-page, sans historique bien que `GET /api/v1/analyses`
existe · table `model_versions` alimentée uniquement par
[`training/publish_model.py`](training/publish_model.py), sans page de
restitution des métriques.

**Modèle** — aucun modèle entraîné fourni, les détections sont **factices** et
sans valeur diagnostique · **aucun dataset obtenu à ce jour** : le pipeline
[`training/`](training/) attend les données · `train.py` et `evaluate.py`
exigent torch et un GPU, ils n'ont donc **pas encore été exécutés de bout en
bout** · la bascule mock reste silencieuse tant que `MODEL_STRICT=1` n'est pas
posé · en mock, les anomalies partagent la boîte de la dent (attendu) et le FDI
affiché vient du générateur, **pas** de [fdi.py](inference/app/fdi.py) — seul le
mode réel emprunte la déduction géométrique.

**Infrastructure**

- **URLs présignées** — signées avec `S3_ENDPOINT=http://minio:9000`, nom interne
  au réseau Docker. Résolu : le backend réécrit leur origine vers
  `S3_PUBLIC_URL` (`/storage` par défaut), que nginx relaie vers MinIO en
  rétablissant `Host: minio:9000` (la signature v4 couvre cet en-tête). Hors
  Docker, laisser `S3_PUBLIC_URL` vide.
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
- **Couverture de tests faible** — anonymisation et numérotation FDI seulement ;
  ni l'API, ni le stockage, ni le pipeline d'entraînement · `Makefile` :
  `up-gpu` absent de `.PHONY`, et `build`/`seed`/`fmt` déclarés sans cible.

---

## Feuille de route

1. ~~**Rendre les URLs présignées utilisables depuis le navigateur**~~ Fait (proxy `/storage/`).
2. **Routes de revue praticien** — `PATCH`/`POST`/`DELETE`, puis édition dans le
   viewer. Le rapport devient un document validé.
3. ~~**Authentification** — protéger les routes, restreindre le CORS.~~ Fait (Google + permissions, cookies `httpOnly`, journal) ; reste l'écran du journal.
4. **Historique dans l'UI** — `GET /api/v1/analyses` est déjà disponible.
5. **Modèle réel** — le pipeline [`training/`](training/) et la numérotation FDI
   sont en place ; il manque **les données**. Lancer les demandes d'accès
   (UFBA-425 immédiat, DENTEX et Tufts à délai) est le vrai chemin critique.
6. **Page de performance** — `GET /api/v1/model/versions` sert les métriques dès
   qu'un modèle est publié ; l'UI de restitution reste à écrire.
7. **Tests d'intégration** — le mock étant déterministe, un test bout-en-bout est
   peu coûteux.

---

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Bandeau « backend indisponible » | Migrations en cours : `docker compose logs -f backend` |
| `inference_reachable: false` | Conteneur `inference` crashé : `docker compose logs inference` |
| Mode toujours `mock` après ajout des poids | Poids absents, `ultralytics`/`torch` non décommentés, ou échec de chargement (chercher `échec du chargement` dans les logs). Rebuild requis. Poser `MODEL_STRICT=1` transforme cette bascule en erreur de démarrage |
| Erreur 500 à l'upload | DICOM sans `pixel_array` exploitable, ou format illisible par Pillow |
| « Image indisponible » / lien PDF mort | URL présignée non relayée : vérifier `S3_PUBLIC_URL=/storage` (backend) et `location /storage/` dans [nginx.conf](frontend/nginx.conf) |
| Upload refusé > ~50 Mo | `client_max_body_size` dans [nginx.conf](frontend/nginx.conf) |
| `504` sur `/api/v1/analyses` | Inférence plus lente que le timeout nginx : ajouter `proxy_read_timeout` |
| Bandeau figé après redémarrage d'un service | `/api/v1/health` est relu toutes les 30 s (et au retour sur l'onglet) : patienter, ou recharger |
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
docker compose exec backend pytest -q              # tests backend
docker compose exec inference pytest -q            # tests inférence (= make test)
docker compose exec backend alembic upgrade head   # = make migrate
docker compose exec db psql -U panoradent
docker compose down -v                             # = make clean (DONNÉES PERDUES)
```

---

## Licence et usage

Prototype de recherche. Non certifié dispositif médical, non conforme MDR, non
destiné à un usage clinique ou à la prise en charge de patients réels.
