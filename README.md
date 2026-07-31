# PanoraDent AI — Infrastructure

Aide au diagnostic par analyse IA des radiographies panoramiques.
**Prototype de recherche — non destiné à un usage clinique.**

Monorepo lançable en une commande. Cinq services orchestrés par Docker Compose :
frontend (React), backend (FastAPI), service d'inférence IA isolé (PyTorch/YOLO),
PostgreSQL et stockage objet S3 (MinIO).

## Démarrage rapide

Prérequis : Docker + Docker Compose.

```bash
cp .env.example .env        # ajuster si besoin
docker compose up --build   # ou : make up
```

Puis :
- Application : http://localhost:3000
- API (docs Swagger) : http://localhost:8000/docs
- Console stockage MinIO : http://localhost:9001 (minioadmin / minioadmin)

> **La chaîne tourne immédiatement, sans modèle entraîné.** Le service d'inférence
> démarre en **mode mock** et renvoie des détections factices, ce qui permet de
> valider tout le pipeline (import → anonymisation → inférence → revue → PDF)
> dès le premier jour.

## Environnement d'inférence

- **CPU (défaut)** : `docker compose up --build`
- **GPU** (quand disponible, NVIDIA Container Toolkit requis) :
  ```bash
  make up-gpu
  # = docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
  ```

## Brancher le vrai modèle

1. Entraîner YOLOv11 sur DENTEX et exporter les poids en `.pt`.
2. Déposer le fichier dans `inference/weights/model.pt`.
3. Dans `inference/Dockerfile`, décommenter l'installation de `torch` et, dans
   `inference/requirements.txt`, décommenter `ultralytics`.
4. `docker compose up --build`. Le service passe automatiquement en mode `real`.

## Structure

```
panoradent-ai/
├── docker-compose.yml          # orchestration (CPU)
├── docker-compose.gpu.yml      # override GPU
├── Makefile                    # raccourcis (up, down, migrate, test…)
├── backend/                    # FastAPI : API, anonymisation, stockage, PDF
│   ├── app/
│   │   ├── routers/            # health, analyses, model
│   │   ├── services/           # anonymize, storage, inference_client, report
│   │   ├── models.py           # SQLAlchemy (analyses, detections, model_versions)
│   │   └── main.py
│   └── alembic/                # migrations de base
├── inference/                  # service IA isolé (mock ou réel)
│   ├── app/model.py            # chargement modèle + mode mock
│   └── weights/                # y déposer model.pt
├── frontend/                   # Next.js + export static site (import, viewer, rapport)
├── .github/workflows/ci.yml    # tests backend + build frontend + build images
└── docs/architecture.md
```

## Sécurité & conformité (rappel PRD §9)

- Anonymisation des DICOM et retrait EXIF **à l'import**, avant tout stockage.
- **Aucune donnée patient identifiante** en base : uniquement des métadonnées.
- Images et rapports dans le stockage objet, chiffrés au repos côté S3.
- En production : restreindre le CORS, changer `JWT_SECRET`, activer HTTPS,
  héberger en UE.

## Commandes utiles

```bash
make up        # démarre tout (CPU)
make up-gpu    # démarre avec GPU
make migrate   # applique les migrations
make test      # tests backend
make down      # arrête
make clean     # arrête + supprime les volumes (DONNÉES PERDUES)
```
