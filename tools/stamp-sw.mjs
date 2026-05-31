#!/usr/bin/env node
/* =========================================================================
 * stamp-sw.mjs — Carimba o Service Worker com um hash de versao do shell.
 *
 * Calcula um SHA-256 curto a partir do conteudo dos arquivos do app shell e
 * substitui __CACHE_VERSION__ em sw.js. Isso garante que, ao publicar qualquer
 * mudanca, o CACHE_NAME muda e o cache antigo e descartado de forma limpa.
 *
 * Uso: node tools/stamp-sw.mjs
 * ========================================================================= */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SHELL = [
  "index.html", "style.css", "app.js",
  "data/cache.js", "data/idbcache.js", "data/bandplan.js",
  "data/regulatory.js", "data/geolayers.js", "data/fpsmeter.js",
  "data/normalize.worker.js",
  "vendor/globe.gl.min.js", "vendor/hls.min.js",
  "manifest.webmanifest",
];

const hash = crypto.createHash("sha256");
for (const rel of SHELL) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) hash.update(fs.readFileSync(p));
}
const version = hash.digest("hex").slice(0, 12);

const swPath = path.join(ROOT, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
// substitui tanto o placeholder quanto um hash anterior ja carimbado
sw = sw.replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "${version}";`);
fs.writeFileSync(swPath, sw);

console.log(`Service Worker carimbado: CACHE_VERSION = ${version}`);
