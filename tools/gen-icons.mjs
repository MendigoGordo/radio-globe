#!/usr/bin/env node
/* =========================================================================
 * gen-icons.mjs — Gera icones PNG (192/512) a partir do assets/icon.svg.
 *
 * Usa o Chromium do Playwright (ja instalado para os testes) para rasterizar
 * o SVG em PNG nos tamanhos exigidos pelo manifesto PWA (Android/iOS).
 *
 * Uso: node tools/gen-icons.mjs
 * ========================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "assets", "icon.svg");
const SIZES = [192, 512];

async function main() {
  if (!fs.existsSync(SVG)) {
    console.error(`[erro] SVG nao encontrado: ${SVG}`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SVG, "utf8");
  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      const html = `<!doctype html><html><head><style>
        html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
        svg{width:${size}px;height:${size}px;display:block}
      </style></head><body>${svg}</body></html>`;
      await page.setContent(html, { waitUntil: "networkidle" });
      const el = await page.$("svg");
      const out = path.join(ROOT, "assets", `icon-${size}.png`);
      await el.screenshot({ path: out, omitBackground: false });
      await page.close();
      console.log(`gerado: assets/icon-${size}.png (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
