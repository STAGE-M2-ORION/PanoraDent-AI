#!/usr/bin/env bash
# Jeu de démonstration (sprint 12, lot E) : `make demo`.
#
#   scripts/demo.sh            # 8 panoramiques du jeu de test public DENTEX
#   DEMO_NOMBRE=4 DEMO_IMAGES=/chemin/vers/pngs scripts/demo.sh
#
# Un praticien et un lecteur de démonstration, et des analyses importées au
# nom du praticien par le circuit réel (le worker les analyse ensuite).
# Refusé par le backend quand APP_ENV=production. Rejoué, il ne double rien.
#
# Images : jeu de test public DENTEX, usage académique (docs/DOCUMENTATION.md,
# §10.1) ; non versionné (data/ est ignoré par git). Sans lui, la panoramique
# de test des parcours e2e.
set -euo pipefail
# Git Bash (Windows) réécrirait « / » en chemin Windows dans les arguments.
export MSYS_NO_PATHCONV=1

read -ra C <<< "${COMPOSE:-docker compose}"
IMAGES="${DEMO_IMAGES:-data/dentex/test_data/disease/input}"
NOMBRE="${DEMO_NOMBRE:-8}"

if [ ! -d "$IMAGES" ]; then
  echo "$IMAGES introuvable : panoramique de test des parcours e2e à la place."
  IMAGES="frontend/e2e/fixtures"
  liste=(panoramique-inscriptions.png)
else
  # Images réparties sur tout le jeu (pas les N premières), dans un ordre stable.
  mapfile -t toutes < <(cd "$IMAGES" && ls -1 | grep -iE '\.(png|jpe?g)$' | sort -V)
  pas=$(( ${#toutes[@]} / NOMBRE )); [ "$pas" -ge 1 ] || pas=1
  liste=()
  for (( i = 0; i < ${#toutes[@]} && ${#liste[@]} < NOMBRE; i += pas )); do liste+=("${toutes[$i]}"); done
fi

echo "→ ${#liste[@]} panoramiques depuis $IMAGES"
tar cf - -C "$IMAGES" "${liste[@]}" | "${C[@]}" exec -T backend python -m app.demo
