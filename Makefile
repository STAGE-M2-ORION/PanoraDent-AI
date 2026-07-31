.PHONY: up down build logs migrate seed fmt test clean

up:            ## Démarre toute la stack (CPU)
	docker compose up --build

up-gpu:        ## Démarre avec le service d'inférence sur GPU
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build

down:          ## Arrête et retire les conteneurs
	docker compose down

logs:          ## Suit les logs
	docker compose logs -f

migrate:       ## Applique les migrations de base
	docker compose exec backend alembic upgrade head

test:          ## Lance les tests backend
	docker compose exec backend pytest -q

clean:         ## Supprime conteneurs + volumes (DONNÉES PERDUES)
	docker compose down -v
