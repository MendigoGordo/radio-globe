#!/usr/bin/env node
/* =========================================================================
 * setup.mjs — Prepara o ambiente de desenvolvimento numa maquina nova.
 *
 * Faz, de forma idempotente:
 *   1) npm install (dependencias de dev: Playwright)
 *   2) baixa o navegador Chromium do Playwright (para os testes)
 *   3) baixa o insumo de build Natural Earth 10m (tools/_states10m.geojson)
 *      — necessario apenas se voce for reparticionar estados (build:states).
 *
 * Nada disso e obrigatorio para apenas RODAR o site (as fronteiras ja estao
 * versionadas em assets/geo/). E util para desenvolver e rodar testes.
 *
 * Uso: node tools/setup.mjs [--skip-browser] [--skip-geo]
 * ========================================================================= */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));

const GEO_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";
const GEO_DEST = path.join(ROOT, "tools", "_states10m.geojson");

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { "User-Agent": "global-radio-3d-setup" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.rmSync(dest, { force: true });
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.rmSync(dest, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} em ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", (err) => { file.close(); fs.rmSync(dest, { force: true }); reject(err); });
  });
}

async function main() {
  console.log("== Global Radio 3D :: setup ==");

  // 1) dependencias
  try {
    run(fs.existsSync(path.join(ROOT, "package-lock.json")) ? "npm ci" : "npm install");
  } catch (e) {
    console.error("Falha no npm install. Verifique sua instalacao do Node/npm.");
    process.exit(1);
  }

  // 2) navegador do Playwright
  if (!args.has("--skip-browser")) {
    try { run("npx playwright install chromium"); }
    catch (_) { console.warn("Aviso: nao consegui baixar o Chromium do Playwright (testes podem falhar)."); }
  }

  // 3) insumo de build de estados (opcional)
  if (!args.has("--skip-geo")) {
    if (fs.existsSync(GEO_DEST)) {
      console.log(`\nJa existe: tools/_states10m.geojson (${(fs.statSync(GEO_DEST).size / 1048576).toFixed(1)} MB)`);
    } else {
      console.log("\nBaixando Natural Earth 10m (insumo de build, ~40 MB)...");
      try {
        await download(GEO_URL, GEO_DEST);
        console.log(`OK: tools/_states10m.geojson (${(fs.statSync(GEO_DEST).size / 1048576).toFixed(1)} MB)`);
      } catch (e) {
        console.warn(`Aviso: download do GeoJSON falhou (${e.message}).`);
        console.warn("Voce so precisa dele para rodar 'npm run build:states'.");
      }
    }
  }

  console.log("\nPronto. Rode:  npm run serve   (http://localhost:8777)");
  console.log("Testes:        npm test");
}

main().catch((e) => { console.error(e); process.exit(1); });
