#!/usr/bin/env bash
# =========================================================================
# deploy.sh — Atualiza o Global Radio 3D na VPS a partir do GitHub.
#
# Faz, de forma segura e idempotente:
#   1) git pull (fast-forward) na pasta do projeto
#   2) atualiza <lastmod> do sitemap.xml para hoje SE houve commits novos
#   3) corrige permissoes de leitura para o nginx (www-data) -> evita 403
#   4) valida a config do nginx e recarrega (sem derrubar conexoes)
#
# Uso:  bash /opt/radio-globe/deploy.sh
# =========================================================================
set -euo pipefail

APP_DIR="/opt/radio-globe"
SITEMAP="$APP_DIR/sitemap.xml"

cd "$APP_DIR"

echo "==> [1/4] git pull"
# Garante working tree limpo para o sitemap (pode ter sido carimbado num deploy
# anterior), evitando que o --ff-only falhe por alteracao local.
git checkout -- sitemap.xml 2>/dev/null || true
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse HEAD)"

echo "==> [2/4] sitemap lastmod"
if [ "$BEFORE" != "$AFTER" ] && [ -f "$SITEMAP" ]; then
  TODAY="$(date +%F)"   # YYYY-MM-DD
  if grep -q "<lastmod>" "$SITEMAP"; then
    sed -i -E "s#<lastmod>[^<]*</lastmod>#<lastmod>${TODAY}</lastmod>#g" "$SITEMAP"
  else
    sed -i -E "s#(<loc>[^<]*</loc>)#\1\n    <lastmod>${TODAY}</lastmod>#" "$SITEMAP"
  fi
  echo "    houve commits novos -> lastmod = ${TODAY}"
else
  echo "    sem commits novos -> lastmod inalterado"
fi

echo "==> [3/4] permissoes de leitura (www-data)"
chmod o+rx "$APP_DIR"
chmod -R o+rX "$APP_DIR"

echo "==> [4/4] validando e recarregando nginx"
if nginx -t; then
  systemctl reload nginx
  echo "    nginx recarregado"
else
  echo "    ERRO: nginx -t falhou. Reload NAO executado." >&2
  exit 1
fi

echo "==> OK. https://globalradio3d.com atualizado (HEAD: ${AFTER:0:7})."
