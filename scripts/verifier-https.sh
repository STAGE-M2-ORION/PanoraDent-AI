#!/usr/bin/env bash
# Vérifie la terminaison HTTPS de la production (docker-compose.prod.yml) :
# redirection HTTP → HTTPS, en-têtes de sécurité, certificat de l'autorité
# interne de Caddy, et que l'application répond derrière.
#
#   scripts/verifier-https.sh [URL_HTTP] [URL_HTTPS]
#   scripts/verifier-https.sh http://localhost:8080 https://localhost:8443
#
# -k : le certificat vient de l'autorité interne de Caddy, que la machine qui
# lance ce script n'a pas forcément installée (les postes du cabinet, si).
set -euo pipefail

HTTP="${1:-http://localhost}"
HTTPS="${2:-https://localhost}"
echecs=0

ok() { printf '  ok      %s\n' "$1"; }
ko() { printf '  ÉCHEC   %s\n' "$1"; echecs=$((echecs + 1)); }

echo "Redirection HTTP → HTTPS"
entetes=$(curl -sI "$HTTP/connexion")
code=$(printf '%s' "$entetes" | head -1 | awk '{print $2}')
cible=$(printf '%s' "$entetes" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')
[[ "$code" =~ ^30[178]$ ]] && ok "HTTP répond $code" || ko "HTTP répond $code (redirection attendue)"
[[ "$cible" == https://* ]] && ok "redirige vers $cible" || ko "Location : '$cible' (https:// attendu)"

echo "En-têtes de sécurité (HTTPS)"
entetes=$(curl -skI "$HTTPS/connexion" | tr -d '\r')
printf '%s' "$entetes" | head -1 | grep -q " 200" && ok "page de connexion : 200" || ko "page de connexion : $(printf '%s' "$entetes" | head -1)"
for nom in Strict-Transport-Security Content-Security-Policy X-Frame-Options X-Content-Type-Options Referrer-Policy Permissions-Policy; do
  ligne=$(printf '%s\n' "$entetes" | grep -i "^$nom:" || true)
  [[ -n "$ligne" ]] && ok "$ligne" || ko "$nom absent"
done
printf '%s\n' "$entetes" | grep -qi "^server:" && ko "en-tête Server présent (version divulguée)" || ok "pas d'en-tête Server"

echo "Certificat et application"
hote_port=$(printf '%s' "$HTTPS" | sed -E 's#^https://([^/]+).*#\1#')
[[ "$hote_port" == *:* ]] || hote_port="$hote_port:443"
emetteur=$(echo | openssl s_client -connect "$hote_port" -servername "${hote_port%%:*}" 2>/dev/null | grep -i "issuer" | head -1 || true)
[[ "$emetteur" == *"Caddy Local Authority"* ]] && ok "émis par l'autorité interne de Caddy" || ko "émetteur inattendu : $emetteur"
sante=$(curl -sk -o /dev/null -w '%{http_code}' "$HTTPS/api/v1/health")
[[ "$sante" == 200 ]] && ok "API derrière Caddy : /api/v1/health 200" || ko "/api/v1/health : $sante"

if (( echecs )); then
  echo "$echecs vérification(s) en échec."
  exit 1
fi
echo "HTTPS conforme."
