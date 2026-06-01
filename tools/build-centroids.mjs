/* =========================================================================
 * build-centroids.mjs — Gera data/centroids.js (centroide + raio por pais).
 *
 * Por que existe:
 *   O Radio Browser tem MILHARES de estacoes SEM coordenadas (geo_lat/long
 *   vazios). Elas existem (entram na contagem do pais), mas nao apareciam no
 *   globo porque o app exigia geo valido. Ex.: China tem 2046 estacoes, mas so
 *   ~26 tem coordenadas. Para nao "sumir" com elas, posicionamos cada uma de
 *   forma APROXIMADA dentro do seu pais (centroide do Natural Earth + leve
 *   espalhamento deterministico), marcada como approxLocation.
 *
 * Fonte: assets/geo/countries.geojson (Natural Earth 110m):
 *   - ISO_A2 / ISO_A2_EH  -> codigo do pais
 *   - LABEL_X / LABEL_Y   -> ponto de rotulo (centro representativo)
 *   - geometria           -> bbox para estimar o raio de espalhamento
 *
 * Saida: { "CC": [lat, lng, spreadDeg] }  — spreadDeg = raio (graus) do disco
 *   onde espalhamos as estacoes sem coordenada, para nao empilharem num pixel.
 *
 * Uso: node tools/build-centroids.mjs
 * ========================================================================= */
"use strict";

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../assets/geo/countries.geojson");
const OUT = resolve(__dirname, "../data/centroids.js");

const SPREAD_FACTOR = 0.55;  // fracao da menor meia-dimensao do pais
const SPREAD_MIN = 0.25;     // graus
const SPREAD_MAX = 7.0;      // graus (evita transbordar paises gigantes)

function bboxOf(geometry) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const eat = (ring) => {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  };
  const g = geometry;
  if (!g) return null;
  if (g.type === "Polygon") g.coordinates.forEach(eat);
  else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(eat));
  else return null;
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

function spreadDeg(bbox, latC) {
  if (!bbox) return SPREAD_MIN;
  const halfLat = (bbox.maxLat - bbox.minLat) / 2;
  const lngSpan = bbox.maxLng - bbox.minLng;
  let r;
  if (lngSpan > 180) {
    // Pais cruza o antimeridiano (RU/FJ/NZ): a largura em longitude fica
    // artificialmente ~360. O centroide (LABEL) fica na massa principal, entao
    // estimamos o raio so pela dimensao em latitude — mantem os pontos no pais.
    r = SPREAD_FACTOR * halfLat;
  } else {
    // Corrige a largura em longitude pela latitude (graus de lng "encolhem").
    const halfLng = (lngSpan / 2) * Math.cos((latC * Math.PI) / 180);
    r = SPREAD_FACTOR * Math.min(halfLat, Math.max(halfLng, 0.01));
  }
  return Math.round(Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, r)) * 1000) / 1000;
}

const gj = JSON.parse(readFileSync(SRC, "utf8"));

const map = {};
let skipped = 0;
for (const f of gj.features) {
  const p = f.properties || {};
  let cc = (p.ISO_A2 && p.ISO_A2 !== "-99") ? p.ISO_A2
    : (p.ISO_A2_EH && p.ISO_A2_EH !== "-99") ? p.ISO_A2_EH
    : null;
  const lat = Number(p.LABEL_Y);
  const lng = Number(p.LABEL_X);
  if (!cc || !Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }
  cc = String(cc).toUpperCase();
  const r = spreadDeg(bboxOf(f.geometry), lat);
  // Mantem o de maior bbox se houver colisao (ISO_A2_EH pode repetir).
  const prev = map[cc];
  const entry = [Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, r];
  if (!prev || entry[2] > prev[2]) map[cc] = entry;
}

const ordered = {};
for (const k of Object.keys(map).sort()) ordered[k] = map[k];

const banner = `/* =========================================================================
 * centroids.js — Centroide + raio de espalhamento por pais. GERADO.
 *
 * NAO EDITE A MAO. Regenere com: node tools/build-centroids.mjs
 *
 * Origem: Natural Earth 110m (LABEL_X/LABEL_Y + bbox) via
 *   assets/geo/countries.geojson.
 *
 * Uso: posicionar de forma APROXIMADA estacoes sem coordenadas reais (marcadas
 *   como approxLocation). Funciona na main thread (window.RadioCentroids) e no
 *   Web Worker (self.RadioCentroids).
 *
 * Formato do mapa: { "CC": [lat, lng, spreadDeg] } — ISO 3166-1 alpha-2.
 * Total de paises: ${Object.keys(ordered).length}
 * ========================================================================= */
`;

const body =
`(function (global) {
  "use strict";
  var CENTROIDS = ${JSON.stringify(ordered)};

  // Angulo aureo (rad): distribui pontos num disco sem padroes visiveis.
  var GOLDEN = 2.399963229728653;
  var CAP = 1500; // resolucao do disco (acima disso, reinicia o padrao)

  function get(cc) {
    if (!cc) return null;
    var v = CENTROIDS[String(cc).toUpperCase()];
    return v ? { lat: v[0], lng: v[1], r: v[2] } : null;
  }

  /**
   * Posiciona de forma APROXIMADA a n-esima estacao sem coordenada de um pais,
   * espalhando num disco (raio = r do pais) ao redor do centroide. Determinis-
   * tico: o mesmo (cc, n) sempre cai no mesmo ponto. Retorna null se nao houver
   * centroide para o pais.
   */
  function placeApprox(cc, n) {
    var c = get(cc);
    if (!c) return null;
    var k = (n | 0) % CAP;
    var frac = (k + 0.5) / CAP;
    var rr = c.r * Math.sqrt(frac);          // raio (uniforme no disco)
    var theta = k * GOLDEN;                    // angulo
    var dLat = rr * Math.cos(theta);
    var cosLat = Math.cos((c.lat * Math.PI) / 180);
    if (Math.abs(cosLat) < 1e-3) cosLat = 1e-3;
    var dLng = (rr * Math.sin(theta)) / cosLat;
    var lat = c.lat + dLat;
    var lng = c.lng + dLng;
    if (lat > 89.5) lat = 89.5; else if (lat < -89.5) lat = -89.5;
    if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  }

  global.RadioCentroids = { map: CENTROIDS, get: get, placeApprox: placeApprox };
})(typeof self !== "undefined" ? self : this);
`;

writeFileSync(OUT, banner + body + "\n", "utf8");
console.log(`OK: ${Object.keys(ordered).length} centroides -> ${OUT} (ignorados: ${skipped})`);
