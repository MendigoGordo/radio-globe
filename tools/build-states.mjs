#!/usr/bin/env node
/* =========================================================================
 * build-states.mjs — Particiona o admin-1 (estados/provincias) por pais.
 *
 * Entrada : assets/geo/_states10m.geojson (Natural Earth 10m, ~40 MB)
 * Saida   : assets/geo/states/<CC>.geojson  (um arquivo por pais, enxuto)
 *           assets/geo/states/index.json    (mapa CC -> contagem)
 *
 * Por que: o 10m completo (~40 MB, 4.596 estados) e detalhado demais para
 * carregar inteiro. Particionando por pais (ISO-3166-1 alpha-2), o cliente
 * baixa so o pais em foco (poucos KB), mantendo a performance do WebGL.
 *
 * Reducao aplicada por feature:
 *   - mantem apenas propriedades uteis (name, name_pt, iso_a2, latitude,
 *     longitude) — descarta dezenas de campos irrelevantes.
 *   - arredonda coordenadas da geometria para 4 casas (~11 m) p/ reduzir peso.
 *
 * Uso: node tools/build-states.mjs
 * ========================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "tools", "_states10m.geojson");
const OUT_DIR = path.join(ROOT, "assets", "geo", "states");

const COORD_PRECISION = 4; // casas decimais (~11 m)

function roundCoords(coords) {
  if (typeof coords[0] === "number") {
    return [Math.round(coords[0] * 1e4) / 1e4, Math.round(coords[1] * 1e4) / 1e4];
  }
  return coords.map(roundCoords);
}

function slimFeature(f) {
  const p = f.properties || {};
  return {
    type: "Feature",
    properties: {
      name: p.name_pt || p.name || p.name_en || "",
      name_en: p.name_en || p.name || "",
      iso_a2: p.iso_a2 || "",
      iso_3166_2: p.iso_3166_2 || "",
      latitude: p.latitude,
      longitude: p.longitude,
    },
    geometry: f.geometry
      ? { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) }
      : null,
  };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[erro] origem nao encontrada: ${SRC}`);
    console.error(`Baixe o ne_10m_admin_1_states_provinces.geojson para esse caminho.`);
    process.exit(1);
  }

  const gj = JSON.parse(fs.readFileSync(SRC, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".geojson") || f === "index.json") fs.rmSync(path.join(OUT_DIR, f));
  }

  const byCC = new Map();
  for (const f of gj.features) {
    const cc = (f.properties.iso_a2 || f.properties.adm0_a3 || "ZZ").toUpperCase();
    if (cc === "-99" || cc === "") continue;
    if (!byCC.has(cc)) byCC.set(cc, []);
    byCC.get(cc).push(slimFeature(f));
  }

  const index = {};
  let totalBytes = 0;
  for (const [cc, feats] of byCC) {
    const fc = { type: "FeatureCollection", features: feats };
    const out = path.join(OUT_DIR, `${cc}.geojson`);
    fs.writeFileSync(out, JSON.stringify(fc));
    const sz = fs.statSync(out).size;
    totalBytes += sz;
    index[cc] = feats.length;
  }
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));

  const countries = Object.keys(index).sort();
  console.log(`Particionado: ${countries.length} paises, ${gj.features.length} estados.`);
  console.log(`Total em disco: ${(totalBytes / 1048576).toFixed(1)} MB (vs 40.7 MB monolitico).`);
  console.log(`Ex.: BR=${index.BR || 0}, US=${index.US || 0}, GB=${index.GB || 0}`);
  console.log(`Saida: assets/geo/states/<CC>.geojson + index.json`);
}

main();
