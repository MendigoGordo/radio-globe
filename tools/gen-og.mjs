#!/usr/bin/env node
/* =========================================================================
 * gen-og.mjs — Gera assets/og-image.png (1200x630) para preview social.
 * Usa o Chromium do Playwright para rasterizar um cartao HTML.
 * Uso: node tools/gen-og.mjs
 * ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const W = 1200, H = 630;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;overflow:hidden;
    background:radial-gradient(circle at 32% 38%,#0a1226 0%,#05070f 72%);
    font-family:'Segoe UI',system-ui,sans-serif;color:#e8edf7;position:relative}
  .globe{position:absolute;right:-120px;top:50%;transform:translateY(-50%);
    width:560px;height:560px;border-radius:50%;
    background:radial-gradient(circle at 38% 32%,#1b3a6b 0%,#0c1c3a 60%,#060d1f 100%);
    box-shadow:0 0 90px rgba(78,161,255,.35),inset -40px -30px 90px rgba(0,0,0,.6)}
  .ring{position:absolute;right:160px;top:50%;transform:translateY(-50%) rotate(18deg);
    width:560px;height:560px;border:2px solid rgba(78,161,255,.25);border-radius:50%}
  .dot{position:absolute;border-radius:50%;box-shadow:0 0 12px currentColor}
  .content{position:absolute;left:80px;top:0;height:100%;display:flex;
    flex-direction:column;justify-content:center;max-width:640px}
  .logo{font-size:30px;color:#4ea1ff;font-weight:700;letter-spacing:.5px;margin-bottom:18px}
  h1{font-size:62px;line-height:1.08;font-weight:800;margin-bottom:22px}
  h1 span{color:#36d399}
  p{font-size:26px;color:#93a0bd;line-height:1.4}
  .legend{display:flex;gap:22px;margin-top:34px;font-size:20px;color:#bcd6ff}
  .lg{display:flex;align-items:center;gap:9px}
  .sw{width:16px;height:16px;border-radius:50%}
</style></head><body>
  <div class="ring"></div>
  <div class="globe">
    <div class="dot" style="width:18px;height:18px;color:#36d399;background:#36d399;left:160px;top:150px"></div>
    <div class="dot" style="width:14px;height:14px;color:#ffb547;background:#ffb547;left:280px;top:300px"></div>
    <div class="dot" style="width:12px;height:12px;color:#36d399;background:#36d399;left:360px;top:200px"></div>
    <div class="dot" style="width:14px;height:14px;color:#36d399;background:#36d399;left:220px;top:380px"></div>
    <div class="dot" style="width:11px;height:11px;color:#ffb547;background:#ffb547;left:130px;top:280px"></div>
  </div>
  <div class="content">
    <div class="logo">📡 GLOBAL RADIO 3D</div>
    <h1>Rádios <span>AM/FM</span> do mundo em um globo 3D</h1>
    <p>Explore e ouça ao vivo milhares de estações, estilo Google Earth.</p>
    <div class="legend">
      <div class="lg"><span class="sw" style="background:#36d399"></span>FM</div>
      <div class="lg"><span class="sw" style="background:#ffb547"></span>AM</div>
      <div class="lg"><span class="sw" style="background:#8b93a7"></span>Internet</div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  const out = path.join(ROOT, "assets", "og-image.png");
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
  console.log(`gerado: assets/og-image.png (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
} finally {
  await browser.close();
}
