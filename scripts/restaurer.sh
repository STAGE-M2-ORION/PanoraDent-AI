#!/usr/bin/env bash
# Restauration d'une sauvegarde (sprint 12, lot E) : `make restaurer SAUVEGARDE=…`.
#
#   scripts/restaurer.sh sauvegardes/panoradent-20261126-101500 [--oui]
#
# REMPLACE la base de la pile visée par celle de la sauvegarde (les objets sont
# rechargés par-dessus). Étapes :
#   1. empreintes vérifiées (une sauvegarde altérée est refusée) ;
#   2. base et stockage démarrés seuls, backend et worker arrêtés ;
#   3. base recréée puis pg_restore ; objets rechargés ; certificats (production) ;
#   4. contrôles : chaque fichier cité par la base existe, l'inventaire
#      restauré égale celui de la sauvegarde ; sinon, la pile reste arrêtée ;
#   5. restauration inscrite au journal, pile redémarrée, durée affichée.
#
# Sur une pile vierge : `docker compose up -d db minio` suffit avant (le script
# le fait), les migrations n'ont rien à faire (la base restaurée est à jour).
set -euo pipefail
# Git Bash (Windows) réécrirait « / » en chemin Windows dans les arguments.
export MSYS_NO_PATHCONV=1

read -ra C <<< "${COMPOSE:-docker compose}"
DIR="${1:?Indiquez le dossier de la sauvegarde à restaurer.}"
[ -f "$DIR/SHA256SUMS" ] || { echo "$DIR : pas une sauvegarde PanoraDent (SHA256SUMS absent)." >&2; exit 1; }

if [ "${2:-}" != "--oui" ]; then
  echo "La base de la pile « ${C[*]} » va être REMPLACÉE par la sauvegarde $DIR."
  read -r -p "Tapez RESTAURER pour continuer : " reponse
  [ "$reponse" = "RESTAURER" ] || { echo "Abandon."; exit 1; }
fi
debut=$(date +%s)
etape() { echo "→ $1 ($(( $(date +%s) - debut )) s)"; }

etape "empreintes"
(cd "$DIR" && sha256sum --quiet -c SHA256SUMS)

etape "base et stockage seuls"
"${C[@]}" stop backend worker >/dev/null 2>&1 || true
"${C[@]}" up -d db minio
for _ in $(seq 1 60); do
  "${C[@]}" exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER"' && break
  sleep 2
done

etape "base de données"
"${C[@]}" exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
# Rejoué en UNE transaction, arrêtée à la première erreur. Seule retouche : les
# options de colonne « pg_attver », héritées d'une base créée sous une autre
# image PostgreSQL (alpine, avant le sprint 9), que PostgreSQL 16 refuse de
# recréer ; elles ne portent aucune donnée. Une base créée par l'image actuelle
# n'en a pas.
"${C[@]}" exec -T db sh -c 'pg_restore --no-owner -f -   | sed "/ ALTER COLUMN .* SET (pg_attver=[0-9]*);\$/d"   | psql -q -X -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null' < "$DIR/base.dump"

# Conteneur ponctuel du backend : mêmes réglages, sans démarrer l'application.
backend() { "${C[@]}" run --rm --no-deps -T backend "$@"; }

etape "stockage objet"
backend python -m app.sauvegarde importer-objets < "$DIR/objets.tar"

if [ -f "$DIR/caddy.tar" ] && "${C[@]}" config --services | grep -qx caddy; then
  etape "certificats HTTPS (Caddy)"
  "${C[@]}" run --rm --no-deps -T caddy tar xf - -C / < "$DIR/caddy.tar"
fi

etape "contrôles"
backend python -m app.sauvegarde verifier
backend python -m app.sauvegarde comparer < "$DIR/inventaire.json"
backend python -m app.sauvegarde journaliser-restauration < "$DIR/inventaire.json"

etape "redémarrage"
"${C[@]}" up -d
echo "Restauration terminée en $(( $(date +%s) - debut )) s depuis $DIR."
