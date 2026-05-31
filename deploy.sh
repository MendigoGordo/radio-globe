#!/usr/bin/env bash
# =========================================================================
# deploy.sh - Publica o Global Radio 3D na VPS de forma segura/idempotente.
#   1) git pull (ff-only) no repo fonte (/opt/radio-globe)
#   2) carimba sitemap <lastmod> se houve commits novos
#   3) carimba o Service Worker (CACHE_VERSION) -> invalida cache antigo
#   4) publica SOMENTE os arquivos publicos no webroot via rsync --delete
#      (deixa .git/tools/tests/deploy.sh/etc FORA do diretorio servido)
#   5) corrige permissoes (dirs 755, arquivos 644; dono root:www-data)
#   6) valida (nginx -t) e recarrega o nginx
# Uso: bash /opt/radio-globe/deploy.sh
# =========================================================================
set -euo pipefail

APP_DIR="/opt/radio-globe"          # repo fonte (contem .git)
WEB_DIR="/var/www/globalradio3d"    # webroot publico (servido pelo nginx)
SITEMAP="$APP_DIR/sitemap.xml"

cd "$APP_DIR"

echo "==> [1/6] git pull"
git checkout -- sitemap.xml 2>/dev/null || true
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse HEAD)"

echo "==> [2/6] sitemap lastmod"
if [ "$BEFORE" != "$AFTER" ] && [ -f "$SITEMAP" ]; then
  TODAY="$(date +%F)"
  if grep -q "<lastmod>" "$SITEMAP"; then
    sed -i -E "s#<lastmod>[^<]*</lastmod>#<lastmod>${TODAY}</lastmod>#g" "$SITEMAP"
  else
    sed -i -E "s#(<loc>[^<]*</loc>)#\1\n    <lastmod>${TODAY}</lastmod>#" "$SITEMAP"
  fi
  echo "    commits novos -> lastmod=${TODAY}"
else
  echo "    sem commits novos"
fi

echo "==> [3/6] stamp service worker"
node tools/stamp-sw.mjs

echo "==> [4/6] publicar no webroot (rsync --delete)"
mkdir -p "$WEB_DIR"
rsync -a --delete \
  --exclude='.git' --exclude='.github' --exclude='.gitignore' \
  --exclude='tools' --exclude='tests' --exclude='node_modules' \
  --exclude='test-results' --exclude='playwright-report' \
  --exclude='.playwright' --exclude='.vscode' \
  --exclude='deploy.sh' --exclude='servir.bat' --exclude='playwright.config.mjs' \
  --exclude='package.json' --exclude='package-lock.json' \
  --exclude='README.md' --exclude='LICENSE' --exclude='*.bak*' \
  "$APP_DIR"/ "$WEB_DIR"/

echo "==> [5/6] permissoes (dirs 755 / arquivos 644)"
chown -R root:www-data "$WEB_DIR"
find "$WEB_DIR" -type d -exec chmod 755 {} +
find "$WEB_DIR" -type f -exec chmod 644 {} +

echo "==> [6/6] validar e recarregar nginx"
if nginx -t; then
  systemctl reload nginx
  echo "    nginx recarregado"
else
  echo "    ERRO: nginx -t falhou. Reload NAO executado." >&2
  exit 1
fi

echo "==> OK. https://globalradio3d.com publicado (HEAD: ${AFTER:0:7})."
