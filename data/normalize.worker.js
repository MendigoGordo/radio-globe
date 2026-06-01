/* =========================================================================
 * normalize.worker.js — Normalizacao + classificacao AM/FM fora da main thread.
 *
 * Recebe o array bruto da API e devolve estacoes limpas, deduplicadas e
 * classificadas. Mantem a UI fluida mesmo com milhares de estacoes.
 *
 * Protocolo:
 *   postMessage({ id, raw: [...] })  ->  postMessage({ id, stations: [...] })
 *   Em erro: postMessage({ id, error: "mensagem" })
 * ========================================================================= */

/* eslint-disable no-restricted-globals */
"use strict";

// Carrega o classificador (define self.RadioBandPlan).
try {
  importScripts("bandplan.js");
} catch (e) {
  // Sem o bandplan, usamos fallback fraco abaixo.
}

// Carrega os centroides de pais (define self.RadioCentroids). Usados para
// posicionar de forma aproximada as estacoes SEM coordenadas reais.
try {
  importScripts("centroids.js");
} catch (e) {
  // Sem centroides, estacoes sem geo seguem sem ponto (lista/contagem ok).
}

function fallbackClassify(s) {
  const hay = `${s.name || ""} ${s.tags || ""}`.toLowerCase();
  if (/\bfm\b/.test(hay)) return { band: "fm", freq: null, unit: "", confidence: "low" };
  if (/\bam\b/.test(hay)) return { band: "am", freq: null, unit: "", confidence: "low" };
  return { band: "net", freq: null, unit: "", confidence: "none" };
}

function normalize(raw) {
  const classify = (self.RadioBandPlan && self.RadioBandPlan.classify) || fallbackClassify;
  const centroids = self.RadioCentroids || null;
  const approxCount = Object.create(null); // contador por pais p/ espalhar
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    let lat = Number(s.geo_lat);
    let lng = Number(s.geo_long);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      && !(lat === 0 && lng === 0);
    if (!hasGeo) { lat = null; lng = null; }
    const id = s.stationuuid;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // Sem coordenada real: posiciona de forma APROXIMADA no pais (centroide +
    // espalhamento deterministico) para nao "sumir" do globo. Marca approx.
    let approxLocation = false;
    if (!hasGeo && centroids && s.countrycode) {
      const cc = String(s.countrycode).toUpperCase();
      const n = approxCount[cc] || 0;
      const p = centroids.placeApprox(cc, n);
      if (p) {
        lat = p.lat; lng = p.lng;
        approxLocation = true;
        approxCount[cc] = n + 1;
      }
    }

    const cls = classify({ name: s.name, tags: s.tags });
    out.push({
      id,
      name: (s.name || "").trim() || "Sem nome",
      lat, lng,
      approxLocation,
      url: s.url_resolved || s.url || "",
      homepage: s.homepage || "",
      favicon: s.favicon || "",
      country: s.country || "",
      countrycode: s.countrycode || "",
      state: s.state || "",
      tags: (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      codec: s.codec || "—",
      bitrate: s.bitrate || 0,
      language: s.language || "",
      votes: s.votes || 0,
      clickcount: s.clickcount || 0,
      band: cls.band,
      freq: cls.freq,
      freqUnit: cls.unit,
      bandConfidence: cls.confidence,
    });
  }
  return out;
}

self.onmessage = (e) => {
  const { id, raw } = e.data || {};
  try {
    const stations = normalize(raw || []);
    self.postMessage({ id, stations });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
