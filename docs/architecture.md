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
- **Service d'inférence isolé** : remplaçable sans toucher au backend (traçabilité modèle).
- **Aucune donnée identifiante en base** : anonymisation à l'import, images chiffrées côté stockage objet.
- **Mode mock** : la chaîne complète tourne avant tout entraînement.
- **CPU par défaut**, GPU via `docker-compose.gpu.yml`.

## Flux d'une analyse
1. Import → 2. Anonymisation (DICOM/EXIF) → 3. Stockage image → 4. Inférence → 5. Persistance des détections → 6. Revue praticien → 7. Rapport PDF.

## Où brancher le vrai modèle
Déposer `inference/weights/model.pt` (export YOLOv11), décommenter `ultralytics`
et l'installation de `torch` dans `inference/Dockerfile`, puis rebuild.
Le service passe automatiquement en mode `real`.
