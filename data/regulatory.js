/* =========================================================================
 * regulatory.js — Cruzamento opcional com base regulatoria (FCC/Anatel).
 *
 * Carrega data/regulatory.json (gerado por tools/build-regulatory.mjs). Para
 * cada estacao com frequencia detectada, procura um transmissor licenciado na
 * MESMA frequencia dentro de um raio geografico. Se achar, eleva a confianca
 * da classificacao e anexa o indicativo (callsign).
 *
 * Tudo opcional: se o JSON nao existir, as funcoes viram no-op e o app segue
 * com a classificacao por plano de frequencia (bandplan.js).
 * ========================================================================= */

(function (global) {
  "use strict";

  const STATE = { loaded: false, ready: false, byFreq: new Map(), count: 0,
                  index: null, loadedCountries: new Set(), mode: "none" };

  const MATCH_RADIUS_KM = 80;     // raio de busca por transmissor compativel
  const FM_TOLERANCE = 0.15;      // +/- MHz
  const AM_TOLERANCE = 5;         // +/- kHz

  function freqKey(f, unit) {
    // chave por "balde" de frequencia para indexar (1 casa em FM, inteiro em AM)
    return unit === "MHz" ? `FM:${Math.round(f * 10)}` : `AM:${Math.round(f)}`;
  }

  function haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const la1 = aLat * Math.PI / 180;
    const la2 = bLat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Indexa um array de transmissores no mapa de frequencias. */
  function indexRecords(arr) {
    let added = 0;
    for (const t of arr) {
      if (!Number.isFinite(t.f) || !Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
      const k = freqKey(t.f, t.u);
      let bucket = STATE.byFreq.get(k);
      if (!bucket) { bucket = []; STATE.byFreq.set(k, bucket); }
      bucket.push(t);
      added++;
    }
    STATE.count += added;
    if (added > 0) STATE.ready = true;
    return added;
  }

  /**
   * Inicializa a base regulatoria.
   * Preferencia: indice particionado (data/regulatory/index.json) p/ carga
   * sob demanda por pais. Fallback: arquivo monolitico data/regulatory.json.
   */
  async function load(opts = {}) {
    if (STATE.loaded) return STATE.ready;
    STATE.loaded = true;

    // 1) tenta o indice de particoes
    try {
      const res = await fetch(opts.indexUrl || "data/regulatory/index.json", { cache: "force-cache" });
      if (res.ok) {
        const idx = await res.json();
        if (idx && typeof idx === "object" && Object.keys(idx).length) {
          STATE.index = idx;
          STATE.mode = "partitioned";
          const pre = opts.preload || [];
          await Promise.all(pre.map((cc) => loadCountry(cc)));
          STATE.ready = STATE.byFreq.size > 0 || Object.keys(idx).length > 0;
          return true;
        }
      }
    } catch (_) { /* sem particoes; tenta monolitico */ }

    // 2) fallback: arquivo monolitico
    try {
      const res = await fetch(opts.url || "data/regulatory.json", { cache: "force-cache" });
      if (!res.ok) return false;
      const arr = await res.json();
      if (!Array.isArray(arr) || arr.length === 0) return false;
      STATE.mode = "monolithic";
      indexRecords(arr);
      return STATE.ready;
    } catch (_) {
      return false;
    }
  }

  /** Carrega sob demanda a particao de um pais (ISO-3166-1 alpha-2). */
  async function loadCountry(cc) {
    if (!cc) return false;
    cc = cc.toUpperCase();
    if (STATE.mode !== "partitioned") return STATE.ready; // monolitico ja tem tudo
    if (STATE.loadedCountries.has(cc)) return true;
    if (STATE.index && !(cc in STATE.index)) {
      STATE.loadedCountries.add(cc);   // pais sem dados; evita refetch
      return false;
    }
    try {
      const res = await fetch(`data/regulatory/${cc}.json`, { cache: "force-cache" });
      if (!res.ok) return false;
      const arr = await res.json();
      STATE.loadedCountries.add(cc);
      indexRecords(Array.isArray(arr) ? arr : []);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Gera as chaves vizinhas para tolerancia de frequencia. */
  function candidateKeys(freq, unit) {
    if (unit === "MHz") {
      const base = Math.round(freq * 10);
      const span = Math.round(FM_TOLERANCE * 10);
      const keys = [];
      for (let d = -span; d <= span; d++) keys.push(`FM:${base + d}`);
      return keys;
    }
    const base = Math.round(freq);
    const keys = [];
    for (let d = -AM_TOLERANCE; d <= AM_TOLERANCE; d++) keys.push(`AM:${base + d}`);
    return keys;
  }

  /**
   * Tenta confirmar uma estacao contra a base regulatoria.
   * @returns {null | { callsign, distanceKm, service, freq, unit }}
   */
  function match(station) {
    if (!STATE.ready) return null;
    if (station.freq == null || !station.freqUnit) return null;
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;

    let best = null;
    for (const key of candidateKeys(station.freq, station.freqUnit)) {
      const bucket = STATE.byFreq.get(key);
      if (!bucket) continue;
      for (const t of bucket) {
        if (station.countrycode && t.cc && station.countrycode !== t.cc) continue;
        const dist = haversineKm(station.lat, station.lng, t.lat, t.lng);
        if (dist <= MATCH_RADIUS_KM && (!best || dist < best.distanceKm)) {
          best = { callsign: t.c || "", distanceKm: Math.round(dist * 10) / 10, service: t.s, freq: t.f, unit: t.u };
        }
      }
    }
    return best;
  }

  /** Aplica o cruzamento a um array de estacoes (muta band/confidence). */
  function refine(stations) {
    if (!STATE.ready) return { confirmed: 0 };
    let confirmed = 0;
    for (const s of stations) {
      const hit = match(s);
      if (hit) {
        s.band = hit.service.toLowerCase();   // "fm"/"am" oficial
        s.bandConfidence = "verified";
        s.callsign = hit.callsign;
        s.regDistanceKm = hit.distanceKm;
        confirmed++;
      }
    }
    return { confirmed };
  }

  global.RadioRegulatory = { load, loadCountry, match, refine, get ready() { return STATE.ready; }, get count() { return STATE.count; }, get mode() { return STATE.mode; } };
})(typeof self !== "undefined" ? self : this);
