#!/usr/bin/env bash
# Paquet modèle (sprint 12, lot F) : transporter une version publiée vers le
# serveur du cabinet (poids non versionnés, base du cabinet non exposée).
#
#   Sur la machine où la version est publiée :
#     scripts/modele.sh exporter dentex-2026.11 [dossier]    # défaut : ./paquets-modeles
#   → <dossier>/dentex-2026.11/{dents.pt, anomalies.pt, publication.json}
#
#   Sur le serveur du cabinet, après copie du dossier (clé USB, réseau) :
#     COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml" \
#       scripts/modele.sh installer /chemin/dentex-2026.11
#
# L'installation vérifie les empreintes des poids contre la fiche AVANT toute
# copie, dépose la paire dans inference/weights/<version>/, l'inscrit au
# registre (non active) et redémarre le service d'inférence. Activation :
# Administration › Modèles, avec un motif (le service revérifie les empreintes).
set -euo pipefail
export MSYS_NO_PATHCONV=1

read -ra C <<< "${COMPOSE:-docker compose}"
POIDS="inference/weights"
action="${1:-}"

empreinte_attendue() {   # empreinte_attendue <publication.json> <dents|anomalies>
  grep -o "\"sha256_$2\": *\"[0-9a-f]\{64\}\"" "$1" | grep -o '[0-9a-f]\{64\}'
}

case "$action" in
  exporter)
    version="${2:?Indiquez la version à exporter (ex. dentex-2026.11).}"
    dest="${3:-paquets-modeles}/$version"
    [ -f "$POIDS/$version/dents.pt" ] && [ -f "$POIDS/$version/anomalies.pt" ] \
      || { echo "$POIDS/$version : poids absents sur cette machine." >&2; exit 1; }
    mkdir -p "$dest"
    "${C[@]}" exec -T backend python -m app.modeles exporter "$version" > "$dest/publication.json"
    cp "$POIDS/$version/dents.pt" "$POIDS/$version/anomalies.pt" "$dest/"
    for role in dents anomalies; do
      [ "$(sha256sum "$dest/$role.pt" | cut -d' ' -f1)" = "$(empreinte_attendue "$dest/publication.json" "$role")" ] \
        || { echo "$role.pt ne correspond pas à la version publiée : paquet supprimé." >&2; rm -rf "$dest"; exit 1; }
    done
    echo "Paquet prêt : $dest ($(du -sh "$dest" | cut -f1)). À copier sur le serveur du cabinet."
    ;;
  installer)
    src="${2:?Indiquez le dossier du paquet (…/<version>).}"
    [ -f "$src/publication.json" ] || { echo "$src : pas de publication.json." >&2; exit 1; }
    version=$(grep -o '"version": *"[^"]*"' "$src/publication.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    for role in dents anomalies; do
      [ "$(sha256sum "$src/$role.pt" | cut -d' ' -f1)" = "$(empreinte_attendue "$src/publication.json" "$role")" ] \
        || { echo "$role.pt : empreinte différente de la fiche, rien n'est installé." >&2; exit 1; }
    done
    mkdir -p "$POIDS/$version"
    cp "$src/dents.pt" "$src/anomalies.pt" "$POIDS/$version/"
    "${C[@]}" exec -T backend python -m app.modeles installer < "$src/publication.json"
    # En production, le service d'inférence ne démarre qu'avec une paire installée.
    "${C[@]}" restart inference >/dev/null
    echo "Poids déposés dans $POIDS/$version. Activez la version dans Administration › Modèles."
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
