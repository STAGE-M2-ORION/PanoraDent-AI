#  PanoraDent AI — Infrastructure

Aide au diagnostic par analyse IA des radiographies panoramiques dentaires.

> ⚠️ **Prototype de recherche — NON certifié dispositif médical.**
> Les détections produites sont des propositions. **La décision médicale relève
> exclusivement du praticien.** Ne pas utiliser en contexte clinique réel, ni
> sur des données patient réelles.

Monorepo lançable en une commande. Cinq services orchestrés par Docker Compose :
frontend (Next.js), backend (FastAPI), service d'inférence IA **isolé**
(PyTorch/YOLO), PostgreSQL et stockage objet S3-compatible (MinIO).

**La chaîne tourne immédiatement, même sans modèle publié.** Le service d'inférence
démarre en **mode mock** et renvoie des détections factices mais plausibles, ce
qui permet de valider tout le pipeline (import → anonymisation → stockage →
inférence → persistance → rapport PDF) dès le premier jour.

| | |
|---|---|
| **Statut** | Prototype fonctionnel de bout en bout ; première version entraînée `dentex-2026.11` (dents mAP@0,50 0,987, anomalies 0,510 au test interne — [rapport](docs/evaluation/dentex-2026.11/rapport.md)) |
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
| Connexion | http://localhost:3000/connexion | `ADMIN_EMAIL` du `.env` : mot de passe choisi par le lien des journaux du backend, ou compte Google (voir [Authentification](#authentification-et-rôles)) |
| Poste d'analyse | http://localhost:3000/analyse | session requise |
| Administration | http://localhost:3000/admin/comptes | rôle avec `user:manage` / `role:manage` |
| Design system | http://localhost:3000/design-system | — |
| API (Swagger) | http://localhost:8000/docs | — |
| Service d'inférence | http://localhost:8001/health | — |
| Console MinIO | http://localhost:9001 | `minioadmin` / `minioadmin` |
| PostgreSQL | `localhost:5432` | `panoradent` / `panoradent` |

```bash
curl http://localhost:8000/api/v1/health
# {"statut":"ok","services":{"base":"ok","stockage":"ok","file":"ok","inference":"ok"}}
```

En mode `mock`, le poste de lecture affiche « Mode démonstration du modèle » et la
supervision marque l'inférence « Dégradé » : les détections affichées sont **factices**.

**Premier essai** : renseigner `ADMIN_EMAIL` dans `.env` (et, pour Google,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), démarrer, puis ouvrir le lien de première
connexion affiché par `docker compose logs backend | grep "première connexion" -A1` pour
choisir le mot de passe administrateur — ou se connecter avec « Continuer avec Google ».
Ensuite ouvrir « Nouvelle analyse » dans la barre latérale (`/nouvelle-analyse`), importer
n'importe quel JPG/PNG (ou `.dcm`), « Ouvrir la relecture », puis « Générer le compte rendu »
› « Télécharger le PDF ». Les objets produits sont visibles dans MinIO (`images/`,
`reports/`). L'image et le PDF sont servis au navigateur par le proxy nginx
(`/storage/`, voir [Limites connues](#limites-connues)).

La session vit dans des cookies `httpOnly; Secure` : pour essayer l'API, ouvrir une
session dans le navigateur (ou `POST /api/v1/auth/connexion` puis renvoyer les
cookies à la main : `curl` ne renvoie pas un cookie `Secure` en HTTP).

Les migrations sont appliquées **automatiquement** au démarrage du backend
(`alembic upgrade head` dans le `CMD`, cf. [backend/Dockerfile](backend/Dockerfile)).

---

## Architecture

```
                 ┌─────────────┐
   navigateur ──▶│  frontend   │ Next.js (export statique) + nginx — 3000
                 └──────┬──────┘
                        │ /api  (proxy nginx → backend:8000)
                 ┌──────▼──────┐
                 │   backend   │ met l'analyse en file, répond aussitôt
                 │  (FastAPI)  │
                 └──┬───────┬──┘
                    │       │
       ┌────────────▼─┐   ┌─▼────────────┐
       │  PostgreSQL  │   │    MinIO     │ stockage objet S3 — 9000 / 9001
       │ métadonnées  │   │  images+PDF  │
       │   + file     │   └─▲────────────┘
       └────────────▲─┘     │
                    │       │
                 ┌──┴───────┴──┐  HTTP   ┌──────────────┐
                 │   worker    │────────▶│  inference   │ FastAPI + YOLO — 8001
                 │ app.worker  │         │  ISOLÉ       │ (mock si pas de poids)
                 └─────────────┘         └──────────────┘
```

Le backend ne joint plus le modèle pendant une requête : il **met l'analyse en
file** (table `analyses`, colonne `statut`) et répond aussitôt. Le **worker**
— même image que le backend, autre commande (`python -m app.worker`) — prend
les analyses une à une (`SELECT … FOR UPDATE SKIP LOCKED` : plusieurs workers
possibles, jamais deux pour la même analyse), interroge le service
d'inférence et enregistre les détections. Pas de Redis ni de courtier :
PostgreSQL suffit au volume d'un cabinet.

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
   PNG, ce qui supprime l'EXIF. Inscriptions incrustées masquées par le
   détecteur de texte (voir ci-dessous).
3. **Stockage** — PNG anonymisé dans MinIO sous `images/<uuid>.png`. L'original
   n'est **jamais** écrit sur disque.
4. **Mise en file** — la ligne `analyses` est créée au statut `en_file` ; la
   réponse (`201`) part aussitôt, sans attendre le modèle.
5. **Traitement** ([worker.py](backend/app/worker.py)) — le worker passe
   l'analyse `en_cours`, `POST` l'image au service `inference`
   ([inference_client.py](backend/app/services/inference_client.py), timeout
   **60 s**), puis enregistre les `detections` (confiance ≥ 0,10, l'écran filtre
   ensuite) **en fractions de l'image** (0 à 1) avec la version du modèle ;
   statut `terminee`, durée en millisecondes. Modèle injoignable ou réponse
   invalide : statut `echouee` et motif lisible ; `POST /{id}/lancer` remet en
   file sans réimporter. Au démarrage, le worker remet en file les analyses
   restées `en_cours` (arrêt brutal). En production, le mode mock est refusé.
   L'interface relit `GET /{id}/statut` toutes les 2 s tant que l'analyse est en
   file ou en cours.
6. **Relecture** ([revue.py](backend/app/services/revue.py)) — le praticien
   valide, corrige (type, dent, cadre) ou rejette chaque détection, avec un
   commentaire facultatif, et trace celles que le modèle n'a pas vues. Une
   proposition du modèle n'est **jamais écrasée** : chaque verdict est une ligne
   de `verdicts` qui porte les valeurs retenues, la détection garde les siennes.
   La clôture exige un verdict sur chaque anomalie (les cadres de numérotation
   des dents servent de repère et n'en demandent pas) ; elle verrouille
   l'analyse, ce que **le service** vérifie avant toute écriture. Seul
   l'administrateur rouvre, avec un motif inscrit au journal.
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
| `worker` | `./backend`, commande `python -m app.worker` | *aucun* | *aucun* (journal « Worker prêt. ») |
| `inference` | `./inference` (python:3.11-slim) | `8001` | `/health`, 10 s, 5 essais |
| `db` | `pgvector/pgvector:0.8.0-pg16` (PostgreSQL 16 + pgvector) | `5432` | `pg_isready`, 5 s, 10 essais |
| `minio` | `pgsty/minio:latest` | `9000`, `9001` | `mc ready local`, 5 s, 10 essais |

**Ordre de démarrage** : `backend` attend `db` et `minio` *healthy*, mais
seulement le **lancement** de `inference` (`service_started`) — il peut donc
démarrer avant le chargement du modèle, sans conséquence. `frontend` dépend de
`backend` sans condition de santé.

**Volumes** : `db_data` et `minio_data`. `make clean` (`docker compose down -v`)
les supprime — **données perdues**.

**Passage de `postgres:16-alpine` à `pgvector/pgvector:0.8.0-pg16` (sprint 9).**
Même version majeure : le volume `db_data` existant est repris tel quel. Mais
l'ancienne image (musl) et la nouvelle (glibc) ne trient pas le texte de la
même façon ; les index sur des colonnes de texte (adresses e-mail, journal…)
doivent être reconstruits **une fois**, juste après le changement d'image :

```bash
docker compose up -d db
docker compose exec db psql -U panoradent -d panoradent -c "REINDEX DATABASE panoradent;"
docker compose up -d
```

Inutile sur une base neuve (CI, e2e, première installation).

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
| `MODEL_WEIGHTS_DIR` | `/weights` | Service d'inférence : dossier des versions publiées (`<version>/dents.pt`, `anomalies.pt`) |
| `MODEL_CACHE_MAX` | `3` | Service d'inférence : nombre de versions gardées en mémoire |
| `MODEL_IMAGE_SIZE` | `640` | Taille d'entrée du modèle — **doit être identique** au `--imgsz` de l'entraînement |
| `MODEL_CONF_THRESHOLD` | `0.25` | Seuil de confiance en mode réel |
| `ASSIGN_FDI` | `1` | Numérotation FDI déduite de la géométrie des boîtes |
| `APP_ENV` | `development` | `production` : le backend **refuse de démarrer** si `JWT_SECRET` est la valeur par défaut ou fait moins de 32 caractères, sans client Google, sans SMTP ou avec `BCRYPT_COUT` < 12 |
| `JWT_SECRET` | `change-me-in-prod` | **Obligatoire hors développement** : secret long et aléatoire (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(vide)* | Client OAuth de la console Google. **Obligatoires** en production ; le secret ne vit que côté serveur |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/v1/auth/google/retour` | URI de retour, déclarée **exactement** dans la console Google |
| `APP_URL` | `http://localhost:3000` | Destination après connexion (et `/connexion?erreur=…` en cas de refus) |
| `GOOGLE_ALLOWED_DOMAIN` | *(vide)* | Restreint la connexion à un domaine Google Workspace |
| `ADMIN_EMAIL` | *(vide)* | Administrateur initial, créé par le jeu de départ avec les deux modes ; son lien de première connexion s'affiche dans `docker compose logs backend` (hors production) |
| `BCRYPT_COUT` | `12` | Coût bcrypt des mots de passe (12 minimum en production ; 4 dans les tests) |
| `COURRIEL_MODE` | `console` | `console` : e-mails affichés dans les journaux du backend ; `smtp` : envoyés (**obligatoire** en production) ; `memoire` : tests seulement |
| `COURRIEL_EXPEDITEUR` | `PanoraDent AI <no-reply@panoradent.local>` | Expéditeur des e-mails |
| `SMTP_HOTE` / `SMTP_PORT` | *(vide)* / `587` | Serveur d'envoi (obligatoire avec `COURRIEL_MODE=smtp`) |
| `SMTP_UTILISATEUR` / `SMTP_MOT_DE_PASSE` | *(vide)* | Identifiants SMTP, côté serveur seulement |
| `SMTP_STARTTLS` | `true` | STARTTLS ; `false` uniquement pour un relais local |
| `IDENTITY_PROVIDER` | `google` | `fake` = fournisseur de remplacement des tests, **refusé hors** `APP_ENV=test` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | `15` / `7` | Durée de vie des jetons |
| `ALLOWED_ORIGINS` | `["http://localhost:3000"]` | Origines CORS, **au format JSON**. Sans effet derrière nginx (même origine) ; utile avec `next dev` |
| `STOCKAGE_ALERTE_GO` | `50` | Seuil d'alerte (Go) du volume occupé dans le stockage objet (`GET /api/v1/stockage`) |
| `PANORADENT_HOTE` | `panoradent.local` | Production : nom sous lequel les postes joignent le serveur, certificat émis par Caddy pour ce nom |
| `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` | `80` / `443` | Production : ports publiés par Caddy |
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
| `GET` | `/api/v1/health` | Publique : un état par service (base, stockage, file, inférence), sondes bornées à 2 s ; 503 si la base est injoignable |
| `POST` | `/api/v1/analyses/apercu` | Contrôle et anonymisation, **sans rien stocker** : aperçu avant / après (data URL JPEG) et zones masquées. Champs `fichier`, `masques` (JSON) — `analysis:create` |
| `POST` | `/api/v1/analyses` | Confirmation : même fichier + `masques`, `date_examen`, `note` ; ré-anonymisation, stockage de la seule image masquée, **mise en file**, `201` immédiat (statut `en_file`) — `analysis:create` |
| `GET` | `/api/v1/analyses` | Analyses du cabinet, plus récentes d'abord ; `?mine=true` : les siennes — `analysis:read` |
| `GET` | `/api/v1/analyses/{id}` | Détail + détections (boîtes en fractions de l'image), référence, déposant, statut, durée — `analysis:read` |
| `GET` | `/api/v1/analyses/{id}/statut` | Suivi de la file : `statut` (`en_file`, `en_cours`, `terminee`, `echouee`), `erreur`, `tentatives`, `duree_ms`, `position` (analyses devant celle-ci) — `analysis:read` |
| `POST` | `/api/v1/analyses/{id}/lancer` | Relance après échec (journalisée) ; déjà en file ou en cours : rien ne change ; terminée : `409` — `analysis:create` |
| `GET` | `/api/v1/analyses/{id}/image` | URL présignée (1 h) de la version d'affichage ; `?taille=pleine` pour la pleine résolution — `analysis:read` |
| `DELETE` | `/api/v1/analyses/{id}` | Déposant ou administrateur ; efface image, version d'affichage et compte rendu **puis** la ligne — `analysis:delete` |
| `POST` | `/api/v1/analyses/{id}/detections/{det}/verdict` | `{action: valider\|corriger\|rejeter, commentaire?, label?, fdi?, cadre?}` (cadre en fractions, borné à [0, 1]) — `detection:review` |
| `POST` | `/api/v1/analyses/{id}/detections/{det}/annuler` | Annule le dernier verdict de la détection ; un ajout annulé est retiré — `detection:review` |
| `POST` | `/api/v1/analyses/{id}/detections` | Ajout d'une détection tracée : origine praticien, née validée, `201` — `detection:review` |
| `PUT` | `/api/v1/analyses/{id}/conclusion` | Brouillon de la conclusion — `detection:review` |
| `POST` | `/api/v1/analyses/{id}/cloturer` | Clôture ; `409 detections_a_revoir` (avec le compte) tant qu'une anomalie reste sans verdict ; journalisée — `detection:review` |
| `POST` | `/api/v1/analyses/{id}/rouvrir` | Réouverture, motif obligatoire, journalisée — `analysis:reopen` |
| `POST` | `/api/v1/analyses/{id}/dents/{fdi}/absente` | Dent déclarée absente (auteur, date, journal) ; `409 dent_detectee` si une dent porte ce numéro — `detection:review` |
| `DELETE` | `/api/v1/analyses/{id}/dents/{fdi}/absente` | Retire la déclaration — `detection:review` |
| `POST` | `/api/v1/analyses/{id}/report` | Génère le PDF (valeurs retenues, rejets exclus), renvoie une URL présignée ; analyse non terminée : `409` — `report:generate` |
| `POST` | `/api/v1/analyses/{id}/rejouer` | Nouvelle analyse du même cliché avec le **modèle actif**, liée à l'originale (`origine_id`), avec sa propre copie de l'image ; l'originale n'est pas touchée (même clôturée). `409` : non terminée, aucun modèle actif, déjà faite avec le modèle actif — `analysis:create` |
| `GET` | `/api/v1/analyses/{id}/comparaison` | Sur un rejeu : propositions des deux modèles par classe (`?seuil=0.25`) — communes (même classe, IoU ≥ 0,50), vues seulement par l'un ou l'autre — `analysis:read` |
| `GET` | `/api/v1/stockage` | Volume occupé dans le stockage objet, alerte au-delà de `STOCKAGE_ALERTE_GO` — `user:manage` |
| `GET` | `/api/v1/model/versions` | Registre : versions publiées par [`training/publish_model.py`](training/publish_model.py), la plus récente d'abord — `actif`, `servable`, mesures, empreintes des poids et du découpage — `model:read` |
| `POST` | `/api/v1/model/versions/{version}/activer` | **Bascule**, motif obligatoire : le service d'inférence charge et vérifie la version **avant** qu'elle ne devienne active ; refus (`409`, `503`) : rien ne change. Journalisée — `model:manage` |
| `GET` | `/api/v1/model/bascules` | Journal des bascules (date, auteur, de, vers, motif) — `model:read` |

Toute écriture de relecture sur une analyse **clôturée** répond `409
analyse_cloturee`.

Les routes image et rapport renvoient `{"url": "…"}` — une URL présignée valable
**3600 s**, pas une redirection ni le binaire.

| Code | Cas (import) |
|---|---|
| `413 fichier_trop_volumineux` | Plus de 20 Mo (refusé avant lecture du corps ; nginx borne aussi à 21 Mo) |
| `415 format_non_pris_en_charge` | Ni PNG, ni JPEG, ni DICOM d'après les premiers octets (l'extension est ignorée) |
| `422 image_trop_petite` / `image_illisible` / `fichier_vide` / `masques_invalides` | Moins de 800 × 400 px, image ou DICOM illisible, fichier vide, masque mal formé |
| `403` | Suppression par quelqu'un d'autre que le déposant ou un administrateur |
| `503 inference_indisponible` | Le service d'analyse ne répond pas : **rien n'est conservé** |
| `503 stockage_indisponible` | Suppression impossible : la ligne est gardée tant que les objets n'ont pas disparu |

Schémas : [`backend/app/schemas.py`](backend/app/schemas.py).

---

## Authentification et rôles

Prototype de recherche : l'authentification protège l'accès aux analyses, elle ne
fait **pas** de cette plateforme un dispositif médical certifié.

**Deux modes de connexion.** Adresse e-mail + mot de passe, et compte Google
(OAuth 2.0 + OpenID Connect, code d'autorisation avec PKCE, mené côté serveur).
L'administrateur choisit, compte par compte, les modes autorisés : l'un, l'autre
ou les deux (`modes_connexion`). **Pas d'inscription publique** : seul un
administrateur crée des comptes. Le mot de passe sert aussi de filet de sécurité
le jour où la liaison Internet du cabinet tombe : Google devient alors injoignable,
pas le serveur local.

**Cycle de vie d'un compte.**
1. L'administrateur crée le compte (`POST /api/v1/utilisateurs`) : adresse, rôle,
   modes. Il ne choisit **jamais** le mot de passe.
2. L'intéressé reçoit un e-mail : un **lien de première connexion** (24 h, usage
   unique) s'il a le mode mot de passe, sinon une invitation à « Continuer avec
   Google ».
3. Il choisit son mot de passe (`/premiere-connexion`), sa session s'ouvre, et on
   lui propose de **rattacher son compte Google** (même adresse exigée).
4. Mot de passe oublié : `/mot-de-passe-oublie` envoie un lien d'**une heure** ;
   la réinitialisation ferme toutes les sessions ouvertes du compte.

**Mise en place.**
1. **Console Google Cloud** (à faire une fois, par vous) :
   - *API et services › Écran de consentement OAuth* : type « Externe » (ou
     « Interne » si le cabinet a un Google Workspace), portées `openid`, `email`,
     `profile`. En mode « Test », ajouter les adresses autorisées comme
     *utilisateurs de test*.
   - *API et services › Identifiants › Créer › ID client OAuth* : type
     « Application Web ». **URI de redirection autorisées**, à l'identique :
     `http://localhost:3000/api/v1/auth/google/retour` (développement) et
     `https://<adresse-du-cabinet>/api/v1/auth/google/retour` (production).
     Aucune « origine JavaScript » n'est nécessaire : le navigateur ne parle
     jamais à Google en JavaScript.
   - Le rattachement depuis le profil utilise **la même URI** : rien à ajouter.
2. **`.env`** : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (côté serveur seulement),
   `GOOGLE_REDIRECT_URI`, `APP_URL`, `ADMIN_EMAIL`, `JWT_SECRET`, et pour les
   e-mails `COURRIEL_MODE` + `SMTP_*` (voir [Variables d'environnement](#variables-denvironnement)).
3. `GOOGLE_ALLOWED_DOMAIN` (optionnel) restreint Google au domaine Workspace du
   cabinet ; vide par défaut, pour ne pas exclure une adresse personnelle.

**Premier démarrage.** Après `alembic upgrade head`, le backend lance
`python -m app.seed_auth`, rejouable sans erreur : huit permissions, trois rôles
système, et le compte administrateur `ADMIN_EMAIL` avec les deux modes. Tant qu'il
n'a pas de mot de passe, chaque démarrage émet un lien de première connexion,
**affiché dans `docker compose logs backend`** hors production (jamais en
production). L'administrateur peut aussi entrer directement avec Google.

**Connexion par mot de passe** (`POST /api/v1/auth/connexion`). bcrypt, coût 12.
- `401 identifiants_invalides`, **même code et même message** que l'adresse soit
  inconnue, mal formée, le mot de passe faux, absent ou non autorisé ; bcrypt tourne
  dans tous les cas (empreinte factice), pour que le temps de réponse ne trahisse
  pas l'existence du compte. Le motif précis ne va qu'au journal.
- `423 compte_verrouille` au-delà de **5 échecs consécutifs**, pour **15 minutes** ;
  le verrouillage est contrôlé **avant** la comparaison du mot de passe (sinon un
  compte verrouillé répondrait 401 au mauvais et 423 au bon). `Retry-After` et
  `details.secondes_restantes`.
- `403 compte_desactive`, quels que soient les identifiants.
- Politique : 12 caractères au moins, 72 octets au plus (limite de bcrypt), ni
  répétitif ni égal à l'adresse ; **aucun caractère spécial imposé**, un indicateur
  de robustesse guide à l'écran.

**Liens à usage unique** (table `jeton`). 32 octets aléatoires envoyés par e-mail ;
**seule leur empreinte sha256 est stockée**. Émettre un lien invalide les liens
encore ouverts du compte. `POST /auth/mot-de-passe/oubli` répond **toujours 204,
immédiatement** : recherche du compte, émission et envoi se font après la réponse
(tâche de fond). Un lien inexistant, expiré, déjà utilisé ou d'un autre type reçoit
le même `400 lien_invalide` ; un mot de passe trop faible reçoit `422` sans
consommer le lien.

**Connexion Google.** `GET /api/v1/auth/google/demarrer` tire `state`, `nonce` et le
couple PKCE, les garde dans un cookie de 10 min et redirige chez Google. Au retour,
le serveur vérifie que `state` est identique au cookie, échange le code avec le
`code_verifier`, puis vérifie le jeton d'identité : signature (clés publiques
Google en cache), `iss`, `aud` = notre client, `exp`, `nonce`, `email_verified`
(bibliothèque officielle `google-auth`), et que le compte autorise le mode `google`.
La route redirige toujours : vers l'application, ou vers `/connexion?erreur=<code>`
— `compte_inconnu`, `compte_desactive`, `google_non_autorise`,
`google_non_rattache`, `adresse_non_verifiee`, `etat_invalide`, `echec_google`.
Le `sub` Google identifie ensuite l'utilisateur ; une adresse connue revenant avec
un autre `sub` est refusée et journalisée. Depuis le profil,
`/demarrer?rattacher=1` rattache Google au compte connecté sans ouvrir de seconde
session.

**Session.** Jeton d'accès 15 min (utilisateur, session, rôle, permissions) et jeton
de rafraîchissement 7 j (identifiant de session), en cookies
`httpOnly; Secure; SameSite=Lax`, jamais lisibles par le JavaScript ni stockés
dans `localStorage`. Chaque session enregistre l'**empreinte** de son jeton de
rafraîchissement, l'appareil et l'adresse IP. `POST /auth/rafraichir` repose le
jeton d'accès ; `POST /auth/deconnexion` révoque la session et efface les cookies.
Chaque requête vérifie que la session n'est pas révoquée.

**Profil** (`/profil`, trois onglets). Informations (`PATCH /moi` : nom, prénom,
titre, spécialité, numéro d'ordre, téléphone, avec l'aperçu de la signature du
compte rendu ; photo `PUT|DELETE /moi/photo`, 2 Mo au plus, type lu dans le contenu,
recadrée 256 px + miniature 128 px, WebP sans métadonnées, servie depuis MinIO) ;
Préférences (`PATCH /moi/preferences` : thème clair/sombre/appareil, langue, seuil
de confiance par défaut, notifications — lues au chargement de l'application) ;
Sécurité (`POST /moi/mot-de-passe` avec vérification de l'ancien, qui ferme les
autres sessions ; `GET /moi/sessions`, `DELETE /moi/sessions/{id}` ; modes de
connexion et rattachement Google).

**Autorisation.** Une dépendance unique, `exiger("analysis:read")`, décode le jeton,
charge l'utilisateur, vérifie qu'il est actif et que la permission figure dans son
rôle. Les routes déclarent la **permission**, jamais le rôle. Un test parcourt toutes
les routes et échoue si l'une d'elles ne porte ni garde ni marque `publique` ; un
second fige la liste des routes publiques.

| Permission | Route(s) protégée(s) |
|---|---|
| `analysis:create` | `POST /api/v1/analyses`, `/apercu`, `/{id}/lancer` |
| `analysis:read` | `GET /api/v1/analyses`, `/{id}`, `/{id}/statut`, `/{id}/image` |
| `analysis:delete` | `DELETE /api/v1/analyses/{id}` (déposant ou administrateur) |
| `detection:review` | verdicts, annulation, ajout, conclusion, clôture (toute analyse du cabinet) |
| `analysis:reopen` | `POST /api/v1/analyses/{id}/rouvrir` (administrateur seul) |
| `report:generate` | `POST /api/v1/analyses/{id}/report` |
| `model:read` | `GET /api/v1/model/versions`, `/model/bascules` |
| `model:manage` | `POST /api/v1/model/versions/{version}/activer` (administrateur seul) |
| `user:manage` | `/api/v1/utilisateurs` (liste, création, modification), `/{id}/sessions` (liste, fermeture), `/{id}/renvoyer-lien`, `/{id}/reinitialiser-mot-de-passe` |
| `role:manage` | `/api/v1/roles` en écriture (création, modification, `/{id}/dupliquer`, suppression) — `GET /api/v1/roles` et `GET /api/v1/permissions` sont aussi ouverts à `user:manage` |
| *session ouverte* | `/api/v1/moi`, `/moi/*`, `/photos/{id}`, `/auth/deconnexion` |

| Rôle système | Permissions |
|---|---|
| Administrateur | les dix (dont `analysis:reopen` et `model:manage`) |
| Praticien | `analysis:create/read/delete`, `detection:review`, `report:generate`, `model:read` |
| Lecteur | `analysis:read`, `model:read` |

**Rôles.** Les trois rôles système sont **verrouillés** : ni renommés, ni
modifiés, ni supprimés, quel que soit l'appelant (indicateur `systeme` en base,
`400 role_systeme`) ; le jeu de départ les resynchronise (permissions et
description) à chaque démarrage. On les **duplique** pour créer une variante
personnalisée. Un rôle personnalisé porte un nom unique (insensible à la casse),
une description et ses permissions ; il ne se supprime que s'il n'est plus
attribué. Toute écriture sur un rôle est journalisée (avant / après). L'écran
`/admin/roles` montre la matrice permissions × rôles et, pour chaque rôle, un
**résumé en clair** de ce qu'il autorise et de ce qu'il n'autorise pas.

**Changement de rôle : immédiat.** Les permissions sont relues en base à chaque
requête : un compte rétrogradé perd ses droits sur le serveur tout de suite, et
le jeton rafraîchi porte les nouvelles permissions. Seule la navigation du
titulaire (barre latérale) change à son chargement suivant.

**Comptes** (`/admin/comptes`). Indicateurs (comptes par rôle, jamais connectés,
désactivés), recherche, filtres, tri, pagination. **Désactivation et changement de
rôle exigent un motif** (`422 motif_requis`), inscrit au journal avec le rôle
avant / après. La fiche d'un compte (`?compte=<id>`) montre ce que son rôle
autorise, ses modes de connexion (modifiables : retirer un mode efface le mot de
passe ou le rattachement Google et ferme les sessions), ses sessions ouvertes, et
permet de **renvoyer le lien de première connexion** ou de **réinitialiser le mot
de passe** (sessions fermées, lien d'une heure envoyé, nouveau mot de passe imposé
à la connexion suivante). L'administrateur ne voit ni ne choisit jamais un mot de
passe.

Garde-fous : impossible de désactiver ou rétrograder le **dernier administrateur
actif** (vérifié sous verrou de ligne, dans la transaction : deux désactivations
simultanées se succèdent), ni de se désactiver ou de changer son propre rôle
(`400`). Pas de suppression de compte : on désactive.

**Journal.** Connexions réussies et refusées avec leur motif, verrouillages,
demandes et usages de liens, changements de mot de passe, rattachements Google,
créations et modifications de compte, révocations de session et déconnexions
(table `journal` ; l'écran viendra plus tard). Jamais de jeton ni de mot de passe.

**Tests.** Google refuse l'automatisation : les tests utilisent un fournisseur
d'identité de remplacement (`IDENTITY_PROVIDER=fake`) qui signe localement ses
jetons, et les e-mails restent en mémoire (`COURRIEL_MODE=memoire`, lus par
`GET /api/v1/test/courriels`). Le backend refuse ces deux réglages hors
`APP_ENV=test`. Ils prouvent la logique, pas la configuration de la console
Google : **une vraie connexion Google manuelle reste nécessaire** pour clore le
sprint.

### Écarts assumés avec la spécification du sprint 1

| Spécification | Réalisé | Raison |
|---|---|---|
| Monorepo `apps/api`, `apps/web`, `apps/ml`, `infra/` | `backend/`, `frontend/`, `inference/`, `training/` | Dépôt existant conservé (décision du 2026-11-19) |
| Next.js App Router, TypeScript, Tailwind, shadcn/ui | Next.js 14 *pages router*, JavaScript, design system CSS maison, export statique servi par nginx | Interface déjà maquettée et construite ; décision du 2026-11-20 |
| Garde de route dans le middleware Next | Garde côté client (`AppShell`) | L'export statique interdit le middleware ; **la vérité reste côté serveur** (chaque route revérifie) |
| Caddy en production | nginx (frontend) ; Caddy prévu au sprint 3 (HTTPS) | Le plan place HTTPS au sprint 3 |
| Une seule migration | `0001` → `0005` | Historique conservé ; `0005` ajoute les deux modes sans perdre les comptes |
| Contrainte « mot de passe non nul si le mode est autorisé » | Contrainte inverse : empreinte **seulement si** le mode est autorisé (idem `google_sub`) | La version de la spec rendrait toute création de compte impossible (le mot de passe est choisi après) |
| Journal : `details` seul | `details` (jsonb) + colonne `resultat` | `resultat` vient du plan (PDF) et facilite les filtres |
| — | `photo_google` en plus | Photo du compte Google reprise à la connexion |
| Jeton de rafraîchissement | Empreinte vérifiée, **pas de rotation** à chaque usage | La rotation déconnecterait les onglets ouverts simultanément pour un gain faible |

---

## Modèle de données

[`backend/app/models.py`](backend/app/models.py) (SQLAlchemy 2.0), migré par
Alembic ([`0001_initial`](backend/alembic/versions/0001_initial.py)).

- **`analyses`** (migration `0007_analyse_import`) — `id` (UUID), `created_at`,
  `reference` (anonyme, unique, `PDX-AAAA-NNNN`), `utilisateur_id` (déposant,
  `SET NULL`), `date_examen?`, `note`, `image_key` (pleine résolution),
  `image_affichage_key?` (3 000 px), `report_key?`, `masques` (zones masquées à
  l'import, en fractions), `model_version`, `inference_mode` (`mock` | `real`),
  `width`, `height`.
- **`detections`** — `id`, `analysis_id` (FK `ON DELETE CASCADE`), valeurs
  **proposées** jamais modifiées (`label`, `fdi?`, `confidence?` — vide pour un
  ajout du praticien —, `x`/`y`/`w`/`h` en fractions de l'image),
  `model_version`, `source` (`model` | `human`), `etat` (`a_revoir`, `validee`,
  `corrigee`, `rejetee`), `revu_par_id?`, `revu_le?`, `cree_le`.
- **`verdicts`** (migration `0009_revue_cloture`) — un verdict par ligne, jamais
  modifié : `detection_id`, `numero` (rang sur la détection), `action`
  (`valider`, `corriger`, `rejeter`, `ajouter`), valeurs **retenues** (`label`,
  `fdi`, `x`/`y`/`w`/`h`), `commentaire`, `auteur_id`, `cree_le`, et en cas
  d'annulation `annule_le` / `annule_par_id`. L'écart entre le modèle et le
  praticien reste ainsi mesurable.
- **`analyses`**, relecture : `conclusion`, `cloturee_le?`, `cloturee_par_id?`.
- **Numérotation** (migration `0011_numerotation`, sprint 7) : `detections.rang` (rang
  appris, 1 à 8), `detections.dent_id` (dent qui porte une anomalie — l'anomalie suit
  le numéro **retenu** de sa dent, tant que le praticien ne lui en a pas fixé un autre) ;
  table `dents_absentes` (`fdi`, auteur, date). Les **incohérences** (doublon, ordre,
  quadrant surchargé, dent absente mais détectée) sont recalculées à chaque lecture
  sur les valeurs retenues, renvoyées avec l'analyse et les dents marquées `douteux` :
  signalées, jamais corrigées d'office. Corriger le numéro d'une dent passe par un
  verdict, comme pour une anomalie : la proposition reste intacte.
- **Seuils d'exploitation** (migration `0012_seuils_exploitation`) :
  `model_versions.seuils` ({classe: seuil}, choisis sur la validation et publiés
  avec la paire) est recopié dans `analyses.seuils` au traitement. Seules les
  anomalies au-dessus du seuil de leur classe attendent un verdict avant la
  clôture ; les autres restent visibles (« Facultative ») et n'entrent au compte
  rendu qu'avec un verdict. `NULL` : comportement antérieur (DOCUMENTATION §10.8).
- **`model_versions`** (registre, migration `0010_registre_modeles`) — une
  version est une **paire** : `poids_dents` / `poids_anomalies` (chemins sous le
  dossier des poids), `sha256_dents` / `sha256_anomalies`,
  `empreinte_decoupage`, `dataset`, `metrics_json`, `notes`, `actif` (**une
  seule** version active, tenu par un index unique partiel) et `active_le`.
  **`model_bascules`** : `horodatage`, `utilisateur_id`, `version_precedente`,
  `version`, `motif`.
- **`analyses`**, registre : `version_demandee` (version active **épinglée à la
  mise en file** : le worker la demande, une bascule ne la change pas) et
  `origine_id` (analyse d'origine d'un rejeu).
- **Authentification** (migrations `0003_auth_google`, `0004_photo_profil`,
  `0005_mot_de_passe_profil`) : `utilisateur` (UUID, `email` citext unique,
  `nom`, `prenom`, `mot_de_passe` = empreinte bcrypt nullable, `google_sub` unique
  nullable, `modes_connexion` jsonb, `role_id` restreint, `actif`,
  `doit_changer_mdp`, `echecs_connexion`, `verrouille_jusqu_a`, `titre`,
  `specialite`, `numero_ordre`, `telephone`, `photo_cle`, `photo_google`,
  `preferences` jsonb, `cree_le`, `modifie_le`, `derniere_connexion`), `role`
  (`libelle` unique, `systeme`), `permission` (`code` clé primaire, `libelle`),
  `role_permission`, `session` (`empreinte_refresh`, `agent`, `ip`, `cree_le`,
  `expire_le`, `revoquee_le`), `jeton` (`type`, `empreinte` sha256, `expiration`,
  `utilise_le`), `journal` (`horodatage`, `utilisateur_id`, `action`, `resultat`,
  `cible`, `details` jsonb, `ip`). Contraintes **tenues par la base** : modes non
  vides et connus, empreinte seulement si le mode `mot_de_passe` est autorisé,
  `google_sub` seulement si le mode `google` l'est.

> Les tables d'analyse ne contiennent aucune donnée identifiante patient : ni nom,
> ni identifiant, ni date de naissance, ni nom de fichier. La date d'examen (prévue
> par le plan, facultative) et la note libre sont les seuls champs saisis ; l'écran
> rappelle de n'y inscrire aucune donnée qui identifie le patient. Le
> rapprochement avec le dossier du patient se fait au cabinet, par la référence
> anonyme. Les tables
> d'authentification ne décrivent que les comptes des utilisateurs de la plateforme
> (praticiens, administrateurs), jamais des patients.

---

## Service d'inférence

Service FastAPI autonome ([`inference/`](inference/)), sans accès base ni
stockage. `GET /health` → `{status, mode, version, versions_chargees}` ;
`POST /infer` → détections ; `POST /charger` → précharge une version.

**Registre de versions** ([registre.py](inference/app/registre.py)). Une version
est une **paire** de modèles rangée sous `<MODEL_WEIGHTS_DIR>/<version>/` :
`dents.pt` (classe `tooth`) et `anomalies.pt` (les quatre diagnostics). Le
worker envoie à `/infer` la version épinglée sur l'analyse et les empreintes
sha256 publiées ; la paire est chargée une fois puis gardée en mémoire
(`MODEL_CACHE_MAX` versions, la moins récemment servie est évincée). Poids
absents : `404 modele_introuvable` ; empreinte différente de la publication :
`409 poids_differents` ; **jamais de repli silencieux sur le mock** quand une
version est demandée. Chaque modèle ne garde que ses classes, puis la
numérotation FDI porte sur l'ensemble. Sans version demandée (aucune version
active), le mode historique ci-dessous s'applique : fichier unique
`MODEL_WEIGHTS_PATH`, chargé au `startup`, ou mock.

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

**Numérotation FDI hybride** ([fdi.py](inference/app/fdi.py), sprint 7) — le
modèle des dents apprend le **rang** (classes `dent_1` … `dent_8`, lues dans ses
poids) ; la géométrie donne le **quadrant** : la médiane passe au centre des
incisives (l'image est vue *face au patient*, sa droite est à gauche des
pixels), un 2-moyennes sur les ordonnées situe le plan d'occlusion — qui n'est
**pas** à mi-hauteur de l'image. Un modèle sans rangs est numéroté par la
position depuis la médiane. Les incohérences (`doublon`, `ordre`,
`quadrant_surcharge`, `absente_detectee`) sont **signalées, jamais corrigées
d'office**. Chaque anomalie est reliée à la dent qui couvre au moins 20 % de son
aire (boîte prolongée de 25 % vers l'apex pour une lésion péri-apicale) ; sans
recouvrement, `fdi` reste `null` plutôt qu'inventé. Désactivable par
`ASSIGN_FDI=0`. Mesures et typologie : [DOCUMENTATION §10.7](docs/DOCUMENTATION.md).

**Mode mock** ([model.py](inference/app/model.py)) : 6 à 12 boîtes `tooth`
réparties sur l'arcade (confiance 0,80–0,99), plus jusqu'à 3 anomalies tirées au
sort (0,55–0,90) qui **réutilisent la boîte exacte d'une dent** — la
superposition est attendue — et en portent l'index (`dent`), comme la
numérotation ; chaque dent porte son rang. Le générateur est initialisé sur `width`/`height` :
les détections sont **déterministes pour une taille d'image donnée**, ce qui rend
les tests reproductibles.

### Brancher le vrai modèle

1. **Entraîner** les deux modèles (dents, anomalies) et les évaluer — tout est
   dans [training/README.md](training/README.md). Le pipeline tourne **hors de
   la stack**.
2. **Publier la paire** — `python training/publish_model.py --version <nom>
   --dents runs/<dents> --anomalies runs/<anomalies>` copie les poids sous
   [`inference/weights/<nom>/`](inference/weights/) (monté en lecture seule,
   `*.pt` exclus du dépôt) et inscrit la version au registre, **non active**.
3. **Rien à reconstruire** : l'image d'inférence embarque `torch` 2.3.1 et
   `ultralytics` 8.3.40 ([requirements-modele.txt](inference/requirements-modele.txt),
   mêmes versions que l'entraînement). Chaque modèle infère à **sa** taille
   d'entraînement, lue dans ses poids.
4. **Activer** — Administration › Modèles › Activer, avec un motif. Les
   versions suivantes se publient et s'activent **sans redéploiement** ; les
   analyses déjà en file gardent leur version.

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
  `inference` et passe `TORCH_VARIANT=gpu` au build (torch CUDA 12.1 au lieu de
  la version processeur). Sur processeur, une paire analyse un panoramique en
  quelques secondes.

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

## Sprint 8 : compte rendu, historique, lecture seule

- **Compte rendu** : `GET /api/v1/analyses/{id}/compte-rendu` (options `image`,
  `commentaires`, `rejetees`, `brouillon`, `telecharger`), reconstruit à la demande
  et jamais stocké ; refusé avant la clôture sauf aperçu « brouillon » ; aperçus et
  téléchargements journalisés. L'écran affiche le PDF du serveur lui-même.
- **Cabinet** : Administration › Cabinet (nom, adresse, mentions, logo), permission
  `cabinet:manage` ; migration `0013_parametres_cabinet`.
- **Historique** : `GET /api/v1/historique` (recherche, filtres, tri, pagination par
  clé), `GET /api/v1/historique.csv`, `GET /api/v1/analyses/{id}/historique` (fiche
  lue dans le journal) ; migration `0014_index_historique`. Le worker journalise
  chaque traitement (`analyse_traitee`, `analyse_echouee`).
- **Lecteur** : consulte analyses, historique, fiches et export CSV ; ne produit
  rien. Côté serveur, deux tests couvrent TOUTES les routes montées : la liste des
  routes ouvertes à tous les rôles est fermée, et le lecteur reçoit 403 sur toute
  route d'écriture hors son propre compte — une route ajoutée sans contrôle fait
  échouer la suite. Côté écran, aucune action d'écriture ne lui est proposée
  (parcours `parcours-lecteur.spec.js`).

## Assistant documentaire (sprint 9)

L'assistant répond aux questions du praticien **à partir des seuls documents
de référence** déposés dans la base documentaire, en citant ses sources. Les
modèles tournent dans le cabinet (Ollama) : aucune donnée ne sort.

**Mise en route** (une fois ; plusieurs Go à télécharger) :

```bash
docker compose --profile assistant up -d
docker compose exec ollama ollama pull bge-m3       # vectorisation, ~1,2 Go
docker compose exec ollama ollama pull qwen2.5:3b   # rédaction, ~2 Go
```

**Ingestion d'un document** (`services/indexation.py`) :

1. extraction du texte (`services/extraction_texte.py`) — Markdown : sections
   tirées des titres (`Lésions › Signes`) ; PDF : une page par bloc, section
   tirée du sommaire (signets). Un PDF scanné, sans texte, est refusé (pas d'OCR) ;
2. découpage (`services/decoupage.py`) en passages d'environ **800 caractères**,
   **120 de recouvrement**, coupés en fin de phrase, sans déborder d'une
   section ni d'une page ;
3. vectorisation (`services/vectorisation.py`) par `MODELE_VECTEURS`, par lots
   de 16 ; le titre de section précède le texte vectorisé ;
4. enregistrement : chaque passage garde le **modèle qui l'a vectorisé**.

Réindexer un document ne touche que ses passages. Un échec (texte introuvable,
Ollama absent) met le document à l'état `echec` avec son motif, sans effacer
ses passages précédents. Si `MODELE_VECTEURS` change, les passages vectorisés
avec l'ancien modèle sont **signalés périmés** (`etat_index`) et ne seront
jamais comparés aux nouveaux.

**Recherche et réponse** (`services/recherche.py`, `redaction.py`, `assistant.py`) :
la question est comparée aux seuls passages vectorisés par le modèle courant ;
si aucun ne passe le **seuil de similarité**, l'assistant refuse (« je ne
trouve rien dans la documentation ») **sans appeler le modèle**. Sinon, le
modèle rédige à partir des passages retenus et, si la question vient d'une
analyse, de son **contexte anonyme** (version du modèle, type, dent et
confiance des anomalies retenues — ni image, ni référence, ni note, ni
conclusion, ni praticien). Chaque paragraphe doit citer un passage (`[1]`) :
une réponse sans source valide est un échec, jamais affichée. Question,
statut, réponse et sources sont inscrits au journal.

**Routes et permissions** :

| Route | Rôle | Permission |
|---|---|---|
| `POST /assistant/questions` | `{question, analyse_id?}` → réponse sourcée ou refus | `assistant:use` |
| `GET` / `PUT /assistant/parametres` | passages (1–10) et seuil (0–1), journalisé | `document:manage` |
| `GET /documents` | documents, état de l'index, réglages | `document:manage` |
| `POST /documents` | dépôt (PDF ou Markdown, 20 Mo, doublon refusé) | `document:manage` |
| `PUT /documents/{id}/fichier` | nouvelle version du fichier | `document:manage` |
| `POST /documents/{id}/reindexation` | réindexer un document | `document:manage` |
| `POST /documents/reindexation` | réindexer les périmés et les échecs | `document:manage` |
| `DELETE /documents/{id}` | retirer un document et ses passages | `document:manage` |
| `GET /documents/{id}/fichier` | ouvrir une source citée | `assistant:use` |

`assistant:use` est accordée à l'administrateur et au praticien ; le lecteur,
en lecture seule, ne pose pas de question (chaque question est journalisée).
L'indexation est faite par le **worker**, jamais pendant la requête : un
document déposé est « en attente », puis « indexé » ou « en échec » avec son
motif ; les analyses passent toujours avant les documents. Écran :
**Administration › Base documentaire**.

**Dans la page d'analyse** (onglet *Assistant*) : la question part avec
l'identifiant de l'analyse, le serveur y joint le contexte anonyme. La réponse
s'affiche avec ses renvois `[1]` : un clic déplie la source (document,
section, page, extrait) et mène au document — à la bonne page pour un PDF.
Refus et échecs s'affichent comme tels, sans source. L'avertissement « pas de
diagnostic » accompagne chaque réponse. Sans `assistant:use` (lecteur), le
panneau le dit et reste fermé. La démonstration garde ses réponses fictives.

**Fil par analyse et réponse au fil de l'eau (sprint 10).** Chaque praticien a
**son** fil par analyse (`GET`/`DELETE /analyses/{id}/conversation`), repris
intact ; l'effacement est journalisé ; après clôture, le fil se lit mais ne
s'écrit plus. `POST /analyses/{id}/conversation/flux` répond en flux
d'événements (`text/event-stream`) :

| Événement | Contenu |
|---|---|
| `debut` | nombre de passages retenus |
| `fragment` | un morceau de texte — **brouillon non vérifié** |
| `fin` | question et réponse **vérifiées**, telles qu'enregistrées dans le fil |

Le contrôle des citations porte sur la réponse complète : un brouillon sans
source est **retiré** à la fin (`fin` porte alors l'échec) et n'entre jamais
dans le fil. **Arrêter** coupe le flux : la rédaction s'arrête côté serveur (la
connexion à Ollama est fermée, il cesse de générer) ; le fil garde la question
avec une réponse « interrompue ». Les refus (droits, analyse clôturée, question
invalide) restent des réponses JSON, rendues avant l'ouverture du flux.
nginx relaie chaque événement sans le retenir (`X-Accel-Buffering: no`) et
attend jusqu'à 5 minutes entre deux (`proxy_read_timeout`) ; Caddy relaie les
flux d'événements sans réglage.

**Dans le panneau** : le fil est repris à l'ouverture ; la réponse s'écrit en
brouillon (« les sources sont vérifiées à la fin »), puis la réponse vérifiée
la remplace — ou le message d'échec si elle ne citait pas ses sources.
**Arrêter** coupe la connexion. Une réponse se **copie** (avec ses sources) ou
s'**insère dans la conclusion**, à la suite, marquée `[Assistant documentaire]`
avec ses sources en clair : le praticien la relit et la réécrit, c'est lui qui
signe (réservé à qui peut relire, avant clôture ; 4000 caractères au plus).
**Effacer la conversation** demande une confirmation. Après clôture, le fil se
relit mais ne se poursuit plus. Les parcours e2e ralentissent le rédacteur
factice (`ASSISTANT_DELAI_FACTICE`) pour pouvoir l'arrêter.

**Tests et e2e** : `ASSISTANT_FOURNISSEUR=factice` remplace Ollama par un
hachage des mots, déterministe — assez pour éprouver toute la chaîne. Refusé
avec `APP_ENV=production`.

## Performances du modèle (sprint 10)

La page **Performance du modèle** affiche les mesures **publiées au registre**
avec chaque version (`metrics` de `GET /model/versions`, écrites par
`training/publish_model.py`), **telles quelles** : rien n'est recalculé à
l'ouverture, une mesure absente reste absente (« non publiée »), aucune valeur
fictive. Par défaut la version en service ; les autres se consultent.

- **Mesures par classe** (jeu de test) : mAP@50, rappel, précision, nombre
  d'anomalies, et par cliché la sensibilité et la spécificité ;
- **Effet du seuil** : pour chaque classe, une phrase en clair (rappel,
  précision, fausses alertes par cliché au seuil retenu, objectif atteint ou
  non) et la **courbe précision-rappel de la validation** (un panneau par
  classe ; survol ou focus d'un point : seuil, rappel, précision ; tableau des
  données). Une version publiée sans seuils le dit, sans courbe inventée ;
- **Matrice de confusion** (jeu de test), effectifs écrits dans les cases ;
- **Comparaison de deux versions** : écart affiché seulement si les deux ont
  été mesurées sur le même jeu de test (même empreinte du découpage) ; sinon,
  signalé, colonnes côte à côte, sans conclusion.

## Journal d'audit (administration)

`GET /api/v1/journal` (`user:manage`) lit le journal (table `journal`, en ajout
seul) et les verdicts de la relecture, sur une période (1 à 365 jours), avec des
filtres par auteur, catégorie et résultat. Chaque action reçoit un libellé
français et une catégorie (`services/journal_audit.py` ; un test exige un libellé
pour toute action journalisée par le code). Les entrées sont rattachées à leur
**session** : exactement quand elles la citent (connexion et déconnexion,
« session:<id> »), sinon par période ; poste lisible (« Chrome · Windows »),
méthode de connexion, état (en cours, déconnectée, expirée). Les connexions
refusées forment un groupe « Tentatives de connexion » (avec leur motif), les
traitements du worker un groupe « Traitements de la plateforme ».
`GET /api/v1/journal.csv` exporte les mêmes entrées ; l'export est lui-même
journalisé. Écran : Administration › Journal d'audit.

**Sprint 11.** Filtres par **action** et par **cible** (référence d'analyse,
compte, rôle…) ; `GET /journal/entrees/{id}` rend une entrée avec tout son
contexte (fenêtre de détail à l'écran). Pagination **par clé** : `avant` est le
curseur (date, identifiant) de la dernière entrée lue, `suivant` celui de la
page d'après (« Charger les entrées plus anciennes ») — jamais de décalage.

**Écriture seule.** Aucune route ne modifie ni ne supprime une entrée, aucun
code non plus : deux tests le vérifient (routes et code source). Seule
exception, déclarée : la **purge par rétention** (`services/retention.py`).
La durée de conservation se règle dans Administration › Cabinet (365 jours par
défaut, de 180 à 3650, contrainte en base) ; `POST /journal/purge`, confirmé,
supprime les seules entrées plus anciennes et s'inscrit lui-même au journal
(nombre de lignes, date limite). Il est **refusé dans la session qui vient
d'abaisser la durée** — abaisser puis purger dans la foulée est le geste par
lequel on efface une trace. Les verdicts, données cliniques, ne sont jamais
purgés.

## Supervision et administration (sprint 11)

- **Page de santé publique** `GET /health` : un état par service (`ok`,
  `degrade`, `panne`) et un statut global, rien d'autre (ni version, ni trace,
  ni nom de machine) ; 503 seulement si la base est injoignable. Quatre sondes
  en parallèle, **2 s chacune, en échec seules** : base, stockage, file (une
  analyse qui attend plus de 10 min la dégrade), inférence (le modèle factice
  n'est « dégradé » qu'en production).
- **Supervision** (`GET /supervision`, `user:manage`) : latence et explication
  de chaque sonde, analyses par jour, durée moyenne, taux d'échec ; écran
  Administration › Supervision, relu toutes les 30 s.
- **Bandeau** sur toutes les pages, pour tous, dès qu'un service est dégradé :
  une phrase qui dit ce que l'incident change (« Le service d'analyse est
  indisponible : les nouvelles analyses attendront dans la file. »).
- **Tableau de bord de l'administrateur** (`GET /administration/indicateurs`) :
  comptes par rôle, jamais connectés, connexions et échecs de la semaine,
  analyses du mois, nouveaux comptes par mois, espace occupé, dernières
  actions sur les comptes. Aucune donnée fictive.
- **Comptes** : export CSV de la liste (`GET /utilisateurs.csv`, journalisé),
  renvoi groupé du lien de première connexion aux comptes actifs jamais
  connectés (`POST /utilisateurs/renvoyer-liens`).
- **Écart assumé avec le plan** : pas de « seuil de confiance par défaut » dans
  les paramètres du cabinet ; chaque classe a son seuil d'exploitation, choisi
  sur la validation et publié avec le modèle (sprint 7), et chaque praticien
  garde son seuil d'affichage dans son profil.
- Ni le praticien ni le lecteur n'atteignent l'administration : un test calcule
  les routes qui exigent une permission d'administration et vérifie le refus
  sur chacune, pour les deux rôles.

## Tests et CI

```bash
cd backend   && pytest -q          # API : base SQLite recréée à chaque test
cd inference && pytest -q
cd frontend  && npm test           # vitest : tests unitaires du web
```

**Backend** (pytest + client HTTP de FastAPI, base recréée à chaque test,
fournisseur d'identité de remplacement, e-mails en mémoire, bcrypt au coût 4) :
anonymisation, modèle et contraintes de la base, mots de passe et politique,
connexion par mot de passe et verrouillage, liens (oubli, réinitialisation,
première connexion), connexion et rattachement Google (les six contrôles du jeton
d'identité), routes `/moi`, création de compte et e-mails, rôles, et le test qui
**échoue si une route n'est ni gardée ni déclarée publique** ; relecture
(sprint 5, [test_revue.py](backend/app/tests/test_revue.py)) : les quatre
verdicts avec auteur et date, correction qui laisse la proposition d'origine
intacte, ajout du praticien (origine, état validé), clôture refusée avec le
compte des détections à revoir, réouverture réservée à l'administrateur et
journalisée, reprise après fermeture du navigateur, et le test qui **échoue si
une route d'écriture sur une analyse n'est ni verrouillée par la clôture ni
exemptée explicitement** (écriture refusée, route par route). Seul
[`pytest.ini`](backend/pytest.ini) fixe le dossier de tests : un module
applicatif nommé comme un test (`test_*.py`, `*_test.py`) serait sinon importé
avant `conftest.py`, avec la mauvaise configuration.

**Inférence** — numérotation FDI géométrique
([test_fdi.py](inference/app/tests/test_fdi.py)) et hybride
([test_numerotation.py](inference/app/tests/test_numerotation.py) : rang appris,
médiane des incisives, incohérences, rattachement à 0,20, prolongement vers
l'apex, générateur factice), registre des modèles
([test_registre.py](inference/app/tests/test_registre.py)) ; sans image réelle ni
modèle entraîné.

**Web** — vitest ([vitest.config.mjs](frontend/vitest.config.mjs)) : client HTTP
(un seul rafraîchissement partagé, requête rejouée une fois, jamais sur un refus
d'identifiants), indicateur de robustesse, messages de l'écran de connexion,
masques d'anonymisation, puis pour la visionneuse (sprint 4) : boîtes reçues en
fractions et ramenées aux pixels, statuts de la file, **seuil de confiance
appliqué sans aucun appel réseau** (client HTTP et `fetch` piégés), **cadres
alignés sur l'image quel que soit le zoom** (point sous le curseur immobile,
aller-retour écran ↔ image exact), navigation J / K, raccourcis inactifs dans
un champ de saisie, contenu et nom de l'export PNG ; pour la relecture
(sprint 5) : état serveur → statut affiché, proposition d'origine et
historique, cadres édités **toujours dans l'image** (déplacement,
redimensionnement par chaque coin, tracé), envoi en fractions bornées à
[0, 1], seules les valeurs corrigées envoyées au serveur, annulation d'un
ajout, décompte de l'écran de clôture ; pour la numérotation (sprint 7) : états
des 32 dents du schéma, navigation au clavier, export SVG autonome, typologie
(définition, urgence, une forme par type — test de luminance en niveaux de
gris), résumé type × quadrant et filtres cumulés.

**Parcours dans un navigateur** — Playwright
([parcours-connexion.spec.js](frontend/e2e/parcours-connexion.spec.js)), contre une
stack complète lancée avec [docker-compose.e2e.yml](docker-compose.e2e.yml) :
l'administrateur crée un compte praticien avec les deux modes ; le praticien lit
son lien dans la boîte de test, choisit son mot de passe, remplit son profil,
passe en thème sombre, se déconnecte, oublie son mot de passe, le réinitialise,
se reconnecte, puis entre avec Google sur le même compte
([parcours-roles.spec.js](frontend/e2e/parcours-roles.spec.js), sprint 2) :
l'administrateur crée un rôle personnalisé (rôles système verrouillés, nom déjà
pris refusé), l'attribue avec un motif, le titulaire voit sa navigation changer à
sa connexion suivante et l'écran « Accès refusé » sur une page qui ne lui est plus
permise, puis le compte est désactivé avec motif et ne peut plus entrer
([parcours-import.spec.js](frontend/e2e/parcours-import.spec.js), sprint 3) : un PDF
et une image de 400 px sont refusés avec leur message, l'aperçu montre les deux
inscriptions masquées, un masque se trace puis se retire, l'abandon ne laisse
aucune analyse, la confirmation donne une référence anonyme retrouvée dans « Mes
analyses », puis le déposant la supprime
([parcours-analyse.spec.js](frontend/e2e/parcours-analyse.spec.js), sprint 4) :
worker arrêté, la confirmation répond aussitôt « En file d'attente » (import et
historique), puis le worker relancé la traite ; service d'inférence arrêté,
l'analyse échoue avec son motif, puis « Relancer l'analyse » aboutit sans
réimporter ; dans la visionneuse, le seuil filtre sans requête vers l'API, un
cadre garde sa place sur l'image après zoom, J / K / + / 0 / H agissent, et
l'export PNG est téléchargé sous la seule référence anonyme. Ces étapes
arrêtent un instant des conteneurs de la stack de test avec la CLI `docker`
(sautées si elle n'est pas accessible)
([parcours-relecture.spec.js](frontend/e2e/parcours-relecture.spec.js), sprint 5) :
le praticien valide (touche V), rejette avec un commentaire, voit la clôture
refusée tant qu'une détection reste à revoir, corrige le type et le cadre
(poignée) — la proposition d'origine reste affichée, cadre fantôme compris —,
annule ce verdict, trace une détection oubliée, recharge la page et retrouve
son avancement et sa sélection, puis clôture avec une conclusion : l'analyse
passe en lecture seule, que le praticien ne peut pas rouvrir ; l'administrateur
la rouvre avec un motif
([parcours-numerotation.spec.js](frontend/e2e/parcours-numerotation.spec.js),
sprint 7) : le schéma montre les 32 dents et se parcourt au clavier ; la
typologie s'affiche (définition, urgence, marques) ; une case du résumé filtre
la liste, le sélecteur de quadrant aussi ; une dent non détectée est déclarée
absente, le reste après rechargement, puis est rétablie ; une dent renumérotée
dans le schéma emporte son anomalie ; deux dents au même numéro sont signalées
en orange avec le message du serveur ; le schéma s'exporte en PNG sous la seule
référence anonyme. Sur un poste qui fait
déjà tourner la stack de développement, la stack de test est un projet séparé
(sa propre base) sur le port 3100 :

```bash
E2E_PORT=3100 docker compose -p panoradent-e2e -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
cd frontend && E2E_COMPOSE_PROJECT=panoradent-e2e E2E_BASE_URL=http://localhost:3100 npm run test:e2e
docker compose -p panoradent-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
```

`E2E_COMPOSE_PROJECT` désigne la stack dont le parcours du sprint 4 arrête le
worker et l'inférence (indispensable quand la stack de développement tourne
aussi). Repartir d'une base vide (`down -v`) avant de relancer la suite : les
comptes accumulés par des passages successifs finissent par paginer la liste
des comptes.

La CI ([ci.yml](.github/workflows/ci.yml)) exécute sur `push` vers `main` et
chaque pull request : `backend` (pytest), `inference` (pytest), `frontend`
(`npm ci`, `npm test`, build), `compose-build`, puis `e2e` (stack de test +
Playwright) et `https` (stack de production avec Caddy sur 8080 / 8443 :
[verifier-https.sh](scripts/verifier-https.sh), et aucun autre port ouvert sur l'hôte). **Le pipeline [`training/`](training/) n'est pas couvert** : il exige
torch et un GPU.

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

- **Anonymisation à l'import, avant tout stockage**
  ([anonymize.py](backend/app/services/anonymize.py)). Type lu dans les premiers
  octets, 20 Mo au plus. Seuls les pixels sont conservés : en-têtes DICOM (nom,
  identifiant, date de naissance…), EXIF et métadonnées disparaissent, l'image est
  ré-encodée en PNG. Les **inscriptions incrustées** sont repérées par un
  détecteur de texte ([detecteur_texte.py](backend/app/services/detecteur_texte.py) :
  modèle DB PP-OCRv3 du zoo OpenCV, lu par `cv2.dnn`, sans PyTorch ni OCR)
  sur le **pourtour** du cliché — bandes du haut et du bas (14 %) et bandes
  latérales (8 %), où les appareils impriment parfois à la verticale — puis
  masquées en noir plein. Le centre n'est jamais masqué automatiquement : un
  faux positif y cacherait des dents. Une détection trapue et épaisse (tache
  anatomique, condyle) est écartée. Si le modèle est absent ou altéré
  (empreinte sha256 vérifiée), l'heuristique du sprint 3 prend le relais
  (seuillage et composantes connexes, bandes du haut et du bas) et l'aperçu
  le signale. La méthode employée est conservée avec les masques. Le praticien
  vérifie l'aperçu avant / après et peut ajouter des masques à la main (il ne
  peut pas retirer un masque automatique).
- **Rien n'est stocké avant confirmation**, et **le fichier reçu n'est jamais
  écrit sur le disque**, même temporairement : il reste en mémoire (Starlette
  configuré pour ne pas le déverser jusqu'à 21 Mo, envois plus gros refusés avant
  lecture). L'original n'est jamais conservé ; la clé de stockage est tirée au
  hasard, le nom du fichier n'est pas gardé.
- **Suppression complète** : image, version d'affichage et compte rendu sont
  effacés du stockage avant la ligne en base.
- **Aucune donnée identifiante en base** : métadonnées techniques et
  coordonnées de boîtes uniquement.
- **Images et rapports dans le stockage objet**, accessibles uniquement par URL
  présignée à durée limitée (1 h, signature v4).
- **Mention légale** imprimée en pied de chaque PDF.

> ⚠️ **Masquage des inscriptions : à confirmer sur les clichés du cabinet.** Le
> détecteur est éprouvé sur des panoramiques fabriquées et sur 20 vrais
> panoramiques DENTEX où des inscriptions ont été incrustées (blanc sur noir,
> gris sur gris, verticales) : toutes masquées, centre jamais touché, quand
> l'heuristique du sprint 3 n'en trouvait aucune. Les lettres isolées de
> latéralité (« R », « L ») ne sont pas toujours masquées, ce qui n'identifie
> personne. Un texte posé au centre du cliché n'est jamais masqué
> automatiquement : c'est pourquoi le praticien vérifie l'aperçu et peut tracer
> un masque avant de confirmer.

### Avant toute mise en production

Cette configuration vise le **développement local** :

- [x] CORS restreint à `ALLOWED_ORIGINS` (plus de `*`).
- [ ] Définir `APP_ENV=production`, un `JWT_SECRET` aléatoire et `COURRIEL_MODE=smtp` avec `SMTP_*` (le backend refuse sinon de démarrer) ; changer `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`/`S3_SECRET_KEY` ; déclarer l'URI de redirection du cabinet dans la console Google.
- [x] Ne plus exposer `5432`, `9000`, `9001`, `8001`, `8000`, `3000` sur l'hôte : `docker-compose.prod.yml`.
- [x] HTTPS : Caddy devant nginx, autorité interne, en-têtes de sécurité — voir [HTTPS au cabinet](#https-au-cabinet).
- [x] Connexion par mot de passe (bcrypt, verrouillage, liens à usage unique) et par Google, contrôle d'accès par permissions — voir plus haut.
- [x] Jetons en cookies `httpOnly; Secure; SameSite=Lax`.
- [x] Journal des connexions, refus, verrouillages, liens et changements de mot de passe (table `journal`) ; l'écran viendra plus tard.
- [ ] 2FA (travaux futurs).
- [x] Masquer les inscriptions incrustées dans les pixels (à valider sur de vrais clichés).
- [ ] Héberger dans l'UE (RGPD), chiffrement au repos côté S3.
- [ ] Journalisation d'audit, rétention, sauvegardes.
- [ ] Épingler les images de base (`pgsty/minio:latest` n'est pas reproductible).

### HTTPS au cabinet

Le serveur vit sur le réseau local du cabinet, sans nom de domaine public :
[Caddy](caddy/Caddyfile) termine HTTPS avec **sa propre autorité de
certification** (`tls internal`), sans rien demander à l'extérieur.

1. Choisir le nom sous lequel les postes joindront le serveur (ex.
   `panoradent.cabinet.lan`) et le déclarer dans le DNS du cabinet ou le fichier
   `hosts` des postes. Dans `.env` : `PANORADENT_HOTE` = ce nom ;
   `APP_URL=https://<nom>`, `GOOGLE_REDIRECT_URI=https://<nom>/api/v1/auth/google/retour`
   (à déclarer aussi dans la console Google), `ALLOWED_ORIGINS=["https://<nom>"]`,
   `APP_ENV=production` et les secrets.
2. Démarrer : `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
   Seuls 80 et 443 (Caddy) sont publiés ; HTTP est redirigé vers HTTPS (308).
3. Récupérer le certificat racine de l'autorité interne :
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml cp caddy:/data/caddy/pki/authorities/local/root.crt panoradent-racine.crt`
   et **l'installer une fois sur chaque poste** (Windows : double-clic ›
   « Installer le certificat » › Ordinateur local › « Autorités de certification
   racines de confiance » ; macOS : Trousseau d'accès › Système › « Toujours
   approuver »). Le volume `caddy_data` contient cette autorité : le
   **sauvegarder**, sinon il faudra réinstaller un nouveau certificat partout.
4. Vérifier : `bash scripts/verifier-https.sh http://<nom> https://<nom>`
   (redirection, HSTS, CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
   `Permissions-Policy`, pas d'en-tête `Server`, certificat de l'autorité interne).
   La CI le rejoue sur 8080 / 8443.

---

## Limites connues

**Fonctionnel** — le compte rendu PDF reprend les valeurs retenues mais pas
encore la conclusion ni l'auteur de la relecture (sprint du compte rendu) ·
deux praticiens sur la même analyse : les écritures sont sérialisées, mais
l'écran de l'un ne se met pas à jour avec les verdicts de l'autre sans
rechargement · table `model_versions` alimentée uniquement par
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
2. ~~**Relecture par le praticien**~~ Fait (sprint 5) : verdicts, ajouts, clôture,
   verrouillage ; conclusion portée dans le compte rendu (sprint 8).
3. ~~**Authentification** — protéger les routes, restreindre le CORS.~~ Fait (mot de passe + Google, permissions, cookies `httpOnly`, journal et son écran).
4. ~~**Historique dans l'UI**~~ Fait (sprint 3), avec le suivi de la file (sprint 4).
5. **Modèle réel** — le pipeline [`training/`](training/) et la numérotation FDI
   sont en place ; il manque **les données**. Lancer les demandes d'accès
   (UFBA-425 immédiat, DENTEX et Tufts à délai) est le vrai chemin critique.
6. ~~**Page de performance**~~ Fait (sprint 10) : mesures du registre, courbes de
   seuil, matrice, comparaison ; les courbes viennent avec la publication de
   `dentex-2026.11b` (seuils par classe).
7. ~~**Tests d'intégration**~~ Fait : parcours Playwright des sprints 1 à 10 en CI.
8. ~~**Assistant documentaire**~~ Fait (sprints 9 et 10) : réponses sourcées, fil
   par analyse, réponse au fil de l'eau ; il reste à installer les modèles Ollama
   au cabinet, à déposer les documents de référence et à régler le seuil de
   similarité sur de vraies questions.

---

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Bandeau « backend indisponible » | Migrations en cours : `docker compose logs -f backend` |
| `"inference": "panne"` dans `/api/v1/health` | Conteneur `inference` arrêté : `docker compose logs inference` ; le détail est dans Administration › Supervision |
| Mode toujours `mock` après ajout des poids | Poids absents, `ultralytics`/`torch` non décommentés, ou échec de chargement (chercher `échec du chargement` dans les logs). Rebuild requis. Poser `MODEL_STRICT=1` transforme cette bascule en erreur de démarrage |
| Erreur 500 à l'upload | DICOM sans `pixel_array` exploitable, ou format illisible par Pillow |
| « Image indisponible » / lien PDF mort | URL présignée non relayée : vérifier `S3_PUBLIC_URL=/storage` (backend) et `location /storage/` dans [nginx.conf](frontend/nginx.conf) |
| Upload refusé > ~50 Mo | `client_max_body_size` dans [nginx.conf](frontend/nginx.conf) |
| Analyse bloquée « En file d'attente » | Worker arrêté ou absent : `docker compose ps worker`, `docker compose logs worker` (il doit écrire « Worker prêt. ») ; `docker compose up -d worker` |
| Analyse « Échec de l'analyse » | Motif affiché et détaillé dans `docker compose logs worker` (le plus souvent : service d'inférence arrêté ou en cours de chargement). Une fois `inference` *healthy*, « Relancer l'analyse » (historique ou page d'analyse) |
| Analyse restée « Analyse en cours » après un arrêt brutal | Remise en file automatiquement au redémarrage du worker |
| Bandeau figé après redémarrage d'un service | `/api/v1/health` est relu toutes les 30 s (et au retour sur l'onglet) : patienter, ou recharger |
| `make test` / `make migrate` échouent | Ils utilisent `docker compose exec` : la stack doit tourner |
| Base incohérente après changement de schéma | `make clean` puis `make up` (⚠️ efface les volumes) |
| Changement de `NEXT_PUBLIC_API_BASE` sans effet | Variable de build : rebuilder l'image frontend |
| `docker compose build` ne construit rien (« additional privileges requested: pass "--allow=fs.read=…" ») | Docker Compose récent passe par *bake*. Construire l'image directement, puis démarrer sans reconstruire : `docker build -t panoradent-ai-backend ./backend` (idem `frontend`), **`docker tag panoradent-ai-backend panoradent-ai-worker`** (le worker attend une image à son nom, construite depuis `./backend`), puis `docker compose up -d --no-build` |
| `docker build` : « failed to resolve source metadata … no such host » | Docker Hub injoignable (pas de réseau) : `DOCKER_BUILDKIT=0 docker build …` construit avec les images de base déjà présentes localement |
| Google : « Missing required parameter: client_id » | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` absents du `.env` : la page de connexion affiche « La connexion n'a pas abouti » et le backend l'écrit dans ses journaux |
| Google : `redirect_uri_mismatch` | L'URI de la console Google doit être **exactement** `GOOGLE_REDIRECT_URI` (schéma, port, chemin) |
| Aucun e-mail reçu (première connexion, mot de passe oublié) | `COURRIEL_MODE=console` : le message et son lien sont dans `docker compose logs backend`. En production : `COURRIEL_MODE=smtp` et `SMTP_*` |
| L'administrateur n'a pas de mot de passe | Lien de première connexion affiché au démarrage dans `docker compose logs backend` (hors production), ou « Mot de passe oublié », ou connexion Google |
| « Trop de tentatives échouées » | Verrouillage de 15 minutes après 5 échecs ; il se lève seul, ou par « Mot de passe oublié » |

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

**Composants tiers embarqués.** Détecteur de texte
`backend/app/modeles_texte/text_detection_en_ppocrv3_2023may.onnx` (PP-OCRv3,
zoo OpenCV, © PaddlePaddle Authors) : licence **Apache 2.0**, texte joint dans
[backend/app/modeles_texte/LICENSE](backend/app/modeles_texte/LICENSE).
**Données d'entraînement** DENTEX : CC BY-NC-SA 4.0, usage académique et non
commercial ; les poids entraînés sur ce jeu héritent de cette restriction.
