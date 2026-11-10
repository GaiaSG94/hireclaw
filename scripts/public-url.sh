#!/usr/bin/env bash
# URL publique de Hireclaw + état des deux services.
# Usage : scripts/public-url.sh [--open]
set -euo pipefail

WEB=hireclaw-web.service
TUNNEL=hireclaw-tunnel.service

state() { systemctl --user is-active "$1" 2>/dev/null || echo "inactif"; }

URL=$(journalctl --user -u "$TUNNEL" --since "-24h" --no-pager 2>/dev/null \
  | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)

echo "service web    : $(state $WEB)"
echo "service tunnel : $(state $TUNNEL)"
echo "URL publique   : ${URL:-introuvable (tunnel pas encore prêt ?)}"
echo "URL locale     : http://127.0.0.1:8137/work"

if [ "${1:-}" = "--open" ] && [ -n "${URL:-}" ]; then
  xdg-open "$URL/work" >/dev/null 2>&1 || true
fi

if [ -n "${URL:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/work" || echo "000")
  echo "test HTTP      : $code sur $URL/work"
fi