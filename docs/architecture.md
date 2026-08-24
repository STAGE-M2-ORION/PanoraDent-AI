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
                 └───┬─────┬───┘      └──────────────┘
                     │     │
          ┌──────────▼─┐ ┌─▼───────────┐
          │ PostgreSQL │ │   MinIO     │ (stockage objet S3)
          │ métadonnées│ │ images+PDF  │
          └────────────┘ └─────────────┘
```

## Principes
- **Service d'inférence isolé** : joint uniquement en HTTP (`POST /infer`), sans accès
  base ni stockage — remplaçable sans toucher au backend (traçabilité modèle).
- **Aucune donnée identifiante en base** : anonymisation à l'import, *avant* tout
  stockage. Images et PDF ne sortent du stockage objet que par URL présignée (1 h) ;
  le chiffrement au repos reste à activer (cf. README, « Avant toute mise en production »).
- **Mode mock** : la chaîne complète tourne avant tout entraînement.
- **CPU par défaut**, GPU via `docker-compose.gpu.yml`.
- **Migrations au démarrage** : `alembic upgrade head` dans le `CMD` du backend.

## Flux d'une analyse
1. Import → 2. Anonymisation (DICOM/EXIF) → 3. Stockage image → 4. Inférence →
5. Persistance des détections → 6. *Revue praticien* → 7. Rapport PDF.

L'étape 6 n'est **pas implémentée** : les colonnes `reviewed` / `source` existent en
base, mais ni route ni UI d'édition. Le PDF est donc un document non validé.

## Routes du frontend
| Route | Rôle |
|---|---|
| `/` | Vitrine : présentation de la plateforme (animée avec GSAP) |
| `/analyse` | Poste de travail : import, détections, rapport |
| `/design-system` | Catalogue des composants |

## Où brancher le vrai modèle
Déposer `inference/weights/model.pt` (export YOLOv11), décommenter `ultralytics`
et l'installation de `torch` dans `inference/Dockerfile`, puis rebuild.
Le service passe automatiquement en mode `real` — et retombe **silencieusement**
en mock si les poids sont illisibles (vérifier `GET :8001/health`).

## Pour aller plus loin
[README.md](../README.md) — stack complète, API, variables, limites connues ·
[frontend/README.md](../frontend/README.md) — Feature-Sliced Design et design system.
