#!/usr/bin/env bash
# Sauvegarde complète de PanoraDent AI (sprint 12, lot E) : `make sauvegarder`.
#
#   scripts/sauvegarder.sh [dossier]          # défaut : ./sauvegardes
#   COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml" scripts/sauvegarder.sh /mnt/disque
#
# Produit <dossier>/panoradent-AAAAMMJJ-HHMMSS/ :
#   inventaire.json  comptes, version du schéma, objets (pour vérifier la restauration)
#   base.dump        pg_dump au format personnalisé (pg_restore)
#   objets.tar       images anonymisées, comptes rendus, documents, logo, photos
#   caddy.tar        autorité et certificats HTTPS (production seulement)
#   SHA256SUMS       empreintes : une sauvegarde altérée est refusée à la restauration
#
# L'application reste en service. L'ordre compte : la base d'abord, les objets
# ensuite ; un fichier écrit entre les deux est en trop (sans effet), jamais en
# moins (un fichier est toujours stocké AVANT la ligne qui le cite).
#
# Hors sauvegarde, à garder à part : le fichier .env (secrets) et les modèles
# Ollama (retéléchargeables). Les sauvegardes contiennent des données de santé :
# disque chiffré, accès restreint. GARDER=N (défaut 14) : nombre conservé.
set -euo pipefail
# Git Bash (Windows) réécrirait « / » en chemin Windows dans les arguments.
export MSYS_NO_PATHCONV=1

read -ra C <<< "${COMPOSE:-docker compose}"
DEST="${1:-sauvegardes}"
GARDER="${GARDER:-14}"
NOM="panoradent-$(date -u +%Y%m%d-%H%M%S)"
DIR="$DEST/$NOM"
debut=$(date +%s)

if ! "${C[@]}" ps --services --status running | grep -qx backend; then
  echo "La pile ne tourne pas (backend arrêté) : rien à sauvegarder." >&2
  exit 1
fi
mkdir -p "$DIR"
trap 'echo "Sauvegarde interrompue : $DIR incomplet, supprimé." >&2; rm -rf "$DIR"' ERR

echo "→ inventaire"
"${C[@]}" exec -T backend python -m app.sauvegarde inventaire > "$DIR/inventaire.json"
echo "→ base de données"
"${C[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DIR/base.dump"
echo "→ stockage objet"
"${C[@]}" exec -T backend python -m app.sauvegarde exporter-objets > "$DIR/objets.tar"
fichiers=(inventaire.json base.dump objets.tar)
if "${C[@]}" ps --services --status running | grep -qx caddy; then
  echo "→ certificats HTTPS (Caddy)"
  "${C[@]}" exec -T caddy tar cf - -C / data > "$DIR/caddy.tar"
  fichiers+=(caddy.tar)
fi
(cd "$DIR" && sha256sum "${fichiers[@]}" > SHA256SUMS)
trap - ERR

# Rotation : les plus anciennes au-delà de GARDER.
if [ "$GARDER" -gt 0 ]; then
  ls -1d "$DEST"/panoradent-* 2>/dev/null | sort | head -n -"$GARDER" | xargs -r rm -rf
fi

taille=$(du -sh "$DIR" | cut -f1)
echo "Sauvegarde terminée en $(( $(date +%s) - debut )) s : $DIR ($taille)"
