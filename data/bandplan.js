/* =========================================================================
 * bandplan.js — Classificacao AM/FM baseada em planos de frequencia reais.
 *
 * Por que isso existe:
 *   A heuristica anterior so olhava se as letras "AM"/"FM" apareciam no nome.
 *   Isso erra (ex.: "Miami", "amor", "Jazz FM" sem frequencia). Aqui usamos os
 *   limites REAIS das bandas de radiodifusao para validar a frequencia extraida
 *   do nome/tags da estacao. Nao inventamos dados: aplicamos os intervalos
 *   oficiais definidos pela ITU / FCC / Anatel.
 *
 * Limites usados (radiodifusao sonora):
 *   - FM (banda II VHF): 87.5–108.0 MHz (Brasil/Europa/maioria).
 *       EUA/FCC: 88.0–108.0 MHz. Japao: 76–95 MHz (caso especial, opcional).
 *       Brasil ainda usa 76–87.5 (eFM / migracao), entao aceitamos 76–108.
 *   - AM (onda media / MW): 520–1710 kHz (ITU 531–1602; FCC ate 1700;
 *       Americas/ITU-2 ate 1710). Usamos faixa abrangente 520–1710 kHz.
 *
 * Referencias (band plans publicos):
 *   FCC FM: 88–108 MHz / AM (MW): 540–1700 kHz (ITU-2 ate 1710).
 *   Anatel (BR): FM 76–108 MHz; OM 525–1705 kHz.
 * ========================================================================= */

(function (global) {
  "use strict";

  const BANDPLAN = {
    fm: { minMHz: 76.0, maxMHz: 108.0 },     // VHF banda II (inclui eFM BR/JP)
    am: { minKHz: 520, maxKHz: 1710 },        // onda media (MW)
  };

  // Captura "101.7", "101,7", "1017" seguido/precedido de FM/MHz, etc.
  // Grupos: numero antes da marca OU numero depois da marca.
  const FM_FREQ = /(?:\b(\d{2,3}(?:[.,]\d)?)\s*(?:mhz|fm)\b)|(?:\bfm\s*(\d{2,3}(?:[.,]\d)?)\b)/i;
  const AM_FREQ = /(?:\b(\d{3,4})\s*(?:khz|am)\b)|(?:\bam\s*(\d{3,4})\b)/i;

  // Marcas textuais sem frequencia (fallback fraco).
  const FM_WORD = /\bfm\b/i;
  const AM_WORD = /\bam\b/i;

  function parseNumber(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(",", "."));
  }

  function inFM(mhz) {
    return Number.isFinite(mhz) && mhz >= BANDPLAN.fm.minMHz && mhz <= BANDPLAN.fm.maxMHz;
  }
  function inAM(khz) {
    return Number.isFinite(khz) && khz >= BANDPLAN.am.minKHz && khz <= BANDPLAN.am.maxKHz;
  }

  /**
   * Classifica a banda de uma estacao.
   * Estrategia (do mais forte ao mais fraco):
   *   1) Frequencia FM valida no plano  -> "fm" (confianca alta)
   *   2) Frequencia AM valida no plano  -> "am" (confianca alta)
   *   3) Apenas a marca textual FM/AM   -> "fm"/"am" (confianca baixa)
   *   4) Nada                           -> "net"
   *
   * @param {{name?:string, tags?:string}} station
   * @returns {{band:'fm'|'am'|'net', freq:number|null, unit:''|'MHz'|'kHz', confidence:'high'|'low'|'none'}}
   */
  function classify(station) {
    const hay = `${station.name || ""} ${station.tags || ""}`;

    // --- 1/2: frequencia explicita ---
    const fmM = hay.match(FM_FREQ);
    if (fmM) {
      const mhz = parseNumber(fmM[1] || fmM[2]);
      // "1017" sem ponto pode ser 101.7 — normaliza se vier > 200
      const norm = mhz > 200 ? mhz / 10 : mhz;
      if (inFM(norm)) return { band: "fm", freq: round1(norm), unit: "MHz", confidence: "high" };
    }
    const amM = hay.match(AM_FREQ);
    if (amM) {
      const khz = parseNumber(amM[1] || amM[2]);
      if (inAM(khz)) return { band: "am", freq: Math.round(khz), unit: "kHz", confidence: "high" };
    }

    // --- 3: marca textual sem frequencia valida ---
    const hasFM = FM_WORD.test(hay);
    const hasAM = AM_WORD.test(hay);
    if (hasFM && !hasAM) return { band: "fm", freq: null, unit: "", confidence: "low" };
    if (hasAM && !hasFM) return { band: "am", freq: null, unit: "", confidence: "low" };
    if (hasFM && hasAM)  return { band: "fm", freq: null, unit: "", confidence: "low" };

    // --- 4: indeterminado ---
    return { band: "net", freq: null, unit: "", confidence: "none" };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  global.RadioBandPlan = { classify, BANDPLAN };
})(typeof self !== "undefined" ? self : this);
