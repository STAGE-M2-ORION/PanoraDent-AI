.PHONY: up down build logs migrate seed fmt test clean sauvegarder restaurer demo

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

test:          ## Lance les tests backend et inference
	docker compose exec backend pytest -q
	docker compose exec inference pytest -q

clean:         ## Supprime conteneurs + volumes (DONNÉES PERDUES)
	docker compose down -v

sauvegarder:   ## Sauvegarde base + stockage (+ certificats) : DOSSIER=sauvegardes
	scripts/sauvegarder.sh $(or $(DOSSIER),sauvegardes)

restaurer:     ## Restaure une sauvegarde (REMPLACE la base) : SAUVEGARDE=sauvegardes/panoradent-…
	@test -n "$(SAUVEGARDE)" || (echo "Indiquez SAUVEGARDE=sauvegardes/panoradent-…" && exit 1)
	scripts/restaurer.sh $(SAUVEGARDE)

demo:          ## Jeu de démonstration (refusé en production)
	scripts/demo.sh
