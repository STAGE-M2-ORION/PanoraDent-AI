# Architecture — PanoraDent AI

Monorepo orchestré par Docker Compose. Cinq services, conformes au PRD §7.

```
                 ┌─────────────┐
   navigateur ──▶│  frontend   │ (Next.js static export + nginx, port 3000)
                 └──────┬──────┘
                        │ /api  (proxy nginx)
                 ┌──────▼──────┐      ┌──────────────┐
                 │   backend   │─────▶│  inference   │ (PyTorch/YOLO, 8001)
                 │  (FastAPI)  │      │  isolé       │
                 └───┬─────┬───┘      └──────▲───────┘
                     │     │                 │ model.pt
          ┌──────────▼─┐ ┌─▼───────────┐  ┌──┴──────────┐
          │ PostgreSQL │ │   MinIO     │  │  training/  │ hors ligne
          │ métadonnées│ │ images+PDF  │  │ (Colab/GPU) │ hors stack
          └────────────┘ └─────────────┘  └─────────────┘
```

## Principes
- **Service d'inférence isolé** : joint uniquement en HTTP (`POST /infer`), sans accès
  base ni stockage — remplaçable sans toucher au backend (traçabilité modèle).
- **Entraînement hors ligne** : [`training/`](../training/) n'est embarqué dans aucun
  conteneur et ne tourne pas dans la stack. Le seul artefact qui franchit la
  frontière est un fichier de poids `.pt` (PRD §12).
- **Aucune donnée identifiante en base** : anonymisation à l'import, *avant* tout
  stockage. Images et PDF ne sortent du stockage objet que par URL présignée (1 h) ;
  le chiffrement au repos reste à activer (cf. README, « Avant toute mise en production »).
- **Mode mock** : la chaîne complète tourne avant tout entraînement.
- **CPU par défaut**, GPU via `docker-compose.gpu.yml`.
- **Migrations et amorçage au démarrage** : `alembic upgrade head` puis `python -m app.seed_auth` (idempotent) dans le `CMD` du backend.
- **Authentification JWT + RBAC** : toutes les routes métier exigent un jeton et une permission (`analysis:create`, `report:generate`…). Comptes créés par un administrateur uniquement. Le lecteur ne voit que les analyses qui lui sont confiées (permission `analysis:read_all` absente, table `attributions`). Détails dans le [README](../README.md#authentification-et-rôles).

## Flux d'une analyse
1. Import → 2. Anonymisation (DICOM/EXIF) → 3. Stockage image → 4. Inférence →
5. Persistance des détections → 6. *Revue praticien* → 7. Rapport PDF.

L'étape 6 n'est **pas implémentée** : les colonnes `reviewed` / `source` existent en
base, mais ni route ni UI d'édition. Le PDF est donc un document non validé.

## Routes du frontend
| Route | Rôle |
|---|---|
| `/` | Vitrine : présentation de la plateforme (animée avec GSAP) |
| `/login` | Connexion (email + mot de passe) |
| `/analyse` | Poste de travail : import, détections, rapport (session requise) |
| `/admin` | Comptes et rôles (`user:manage` / `role:manage`) |
| `/design-system` | Catalogue des composants |

## Numérotation FDI
Le détecteur renvoie des boîtes et une classe, **jamais un numéro de dent** : le FDI
est une propriété géométrique, déduite après l'inférence par
[`inference/app/fdi.py`](../inference/app/fdi.py) — médiane verticale de l'image pour
le côté, plan d'occlusion déduit des boîtes par 2-moyennes pour le maxillaire /
mandibule, puis position croissante depuis la médiane. Les anomalies héritent du
numéro de la dent qu'elles recouvrent.

## Où brancher le vrai modèle
Entraîner via [`training/`](../training/) (voir [training/README.md](../training/README.md)),
puis `python training/publish_model.py … --install` : les poids sont déposés dans
`inference/weights/model.pt` et les métriques écrites dans `model_versions`.
Décommenter `ultralytics` dans `inference/requirements.txt` et l'installation de
`torch` dans `inference/Dockerfile`, puis rebuild.

**Poser `MODEL_STRICT=1`** : sans cette variable, des poids illisibles font retomber
le service en mode mock **silencieusement**, et l'on sert des détections factices en
croyant servir un modèle. Vérifier `GET :8001/health` → `"mode":"real"`.

## Pour aller plus loin
[DOCUMENTATION.md](DOCUMENTATION.md) — référence complète : périmètre, exigences
PRD confrontées au code, validation, conformité, traçabilité ·
[README.md](../README.md) — stack complète, API, variables, limites connues ·
[training/README.md](../training/README.md) — pipeline d'entraînement, datasets,
méthodologie de validation ·
[frontend/README.md](../frontend/README.md) — Feature-Sliced Design et design system.
