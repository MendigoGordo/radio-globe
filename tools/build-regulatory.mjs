#!/usr/bin/env node
/* =========================================================================
 * build-regulatory.mjs — Pipeline OFFLINE: CSV regulatorio -> JSON enxuto.
 *
 * Objetivo: gerar data/regulatory.json com (frequencia, lat, lng, indicativo,
 * servico, pais) a partir de bases publicas (FCC, Anatel). O app usa esse JSON
 * para cruzar cada estacao do Radio Browser com o transmissor licenciado mais
 * proximo na mesma frequencia, elevando a confianca da classificacao AM/FM.
 *
 * Por que e source-agnostic:
 *   Os arquivos oficiais mudam de layout/URL ao longo do tempo. Em vez de
 *   embutir uma URL que pode quebrar, este script le um arquivo CSV LOCAL que
 *   voce baixa e um config de mapeamento de colunas (tools/sources/*.json).
 *   Assim nao dependemos de suposicoes sobre o schema exato.
 *
 * Uso:
 *   node tools/build-regulatory.mjs tools/sources/anatel.config.json
 *   node tools/build-regulatory.mjs tools/sources/fcc-fm.config.json tools/sources/anatel.config.json
 *
 * Saida: data/regulatory.json  (array de { f, u, lat, lng, c, s, cc })
 *   f   = frequencia numerica
 *   u   = unidade ("MHz" | "kHz")
 *   lat, lng = coordenadas decimais
 *   c   = indicativo/callsign (ex.: ZYC690, KQED)
 *   s   = servico ("FM" | "AM")
 *   cc  = codigo do pais (ISO-3166-1 alpha-2)
 * ========================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ----------------------- Parser CSV robusto ---------------------------- */
// Suporta aspas, virgula/; como separador, e campos com quebras de linha.
function parseCSV(text, delimiter) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (ch === "\r") {
      // ignora; o \n trata a quebra
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

function detectDelimiter(headerLine) {
  const semis = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semis > commas ? ";" : ",";
}

/* ----------------------- Conversores de coordenada --------------------- */
// Aceita decimal direto ("-23.55") ou DMS ("23S33'12\"" / "46W39'00\"").
function toDecimal(value, hemisphereHint) {
  if (value == null) return NaN;
  let s = String(value).trim();
  if (s === "") return NaN;
  // decimal simples (com , ou .)
  const dec = parseFloat(s.replace(",", "."));
  const dms = s.match(/(\d+)\D+(\d+)\D+(\d+(?:[.,]\d+)?)/);
  if (dms && /[NSEWLO]/i.test(s)) {
    const deg = parseInt(dms[1], 10);
    const min = parseInt(dms[2], 10);
    const sec = parseFloat(dms[3].replace(",", "."));
    let d = deg + min / 60 + sec / 3600;
    if (/[SWO]/i.test(s)) d = -d;       // Sul/Oeste/Oeste(O) negativos
    return d;
  }
  if (Number.isFinite(dec)) {
    if (hemisphereHint === "S" || hemisphereHint === "W") return -Math.abs(dec);
    return dec;
  }
  return NaN;
}

/* ----------------------- Normalizacao de frequencia -------------------- */
function normalizeFreq(raw, service) {
  let n = parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (service === "FM") {
    // FM costuma vir em MHz (88-108) ou kHz (88000-108000)
    if (n > 1000) n = n / 1000;
    if (n < 60 || n > 110) return null;
    return { f: Math.round(n * 10) / 10, u: "MHz" };
  }
  // AM em kHz (530-1710) ou MHz (0.53-1.71)
  if (n < 30) n = n * 1000;
  if (n < 500 || n > 1800) return null;
  return { f: Math.round(n), u: "kHz" };
}

/* ----------------------- Processa uma fonte ---------------------------- */
function processSource(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const csvPath = path.resolve(path.dirname(configPath), cfg.file);
  if (!fs.existsSync(csvPath)) {
    console.warn(`[skip] arquivo nao encontrado: ${csvPath}`);
    console.warn(`       baixe a base oficial e salve nesse caminho (veja o README do tools/).`);
    return [];
  }
  const text = fs.readFileSync(csvPath, "utf8");
  const firstLine = text.slice(0, text.indexOf("\n"));
  const delimiter = cfg.delimiter || detectDelimiter(firstLine);
  const rows = parseCSV(text, delimiter);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim());
  const col = (name) => (name == null ? -1 : header.indexOf(name));
  const m = cfg.columns;

  const idxFreq = col(m.freq);
  const idxLat = col(m.lat);
  const idxLng = col(m.lng);
  const idxCall = col(m.callsign);
  const idxService = col(m.service);

  if (idxFreq < 0 || idxLat < 0 || idxLng < 0) {
    console.error(`[erro] colunas obrigatorias ausentes em ${cfg.name}. ` +
      `Cabecalho: ${header.join(" | ")}`);
    return [];
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const serviceRaw = idxService >= 0 ? (row[idxService] || "").toUpperCase() : "";
    const service = cfg.defaultService
      ? cfg.defaultService
      : (/FM|F\.M|FREQ/.test(serviceRaw) ? "FM" : /AM|OM|MEDIA|MW/.test(serviceRaw) ? "AM" : "");
    if (!service) continue;

    const fr = normalizeFreq(row[idxFreq], service);
    if (!fr) continue;

    const lat = toDecimal(row[idxLat], cfg.latHemisphere);
    const lng = toDecimal(row[idxLng], cfg.lngHemisphere);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    out.push({
      f: fr.f, u: fr.u,
      lat: Math.round(lat * 1e4) / 1e4,
      lng: Math.round(lng * 1e4) / 1e4,
      c: idxCall >= 0 ? (row[idxCall] || "").trim() : "",
      s: service,
      cc: (cfg.countryCode || "").toUpperCase(),
    });
  }
  console.log(`[ok] ${cfg.name}: ${out.length} transmissores`);
  return out;
}

/* ----------------------- Main ------------------------------------------ */
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Uso: node tools/build-regulatory.mjs <config1.json> [config2.json ...]");
    console.log("Exemplos de config em tools/sources/");
    process.exit(1);
  }

  let all = [];
  for (const cfgPath of args) {
    try {
      all = all.concat(processSource(path.resolve(cfgPath)));
    } catch (err) {
      console.error(`[erro] ${cfgPath}: ${err.message}`);
    }
  }

  if (all.length === 0) {
    console.warn("Nenhum transmissor gerado. Verifique os arquivos de origem e os configs.");
  }

  const outPath = path.join(ROOT, "data", "regulatory.json");
  fs.writeFileSync(outPath, JSON.stringify(all));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nGerado: data/regulatory.json (${all.length} registros, ${kb} KB)`);

  // --- Particionamento por pais (carga sob demanda no cliente) ---
  writePartitions(all);
}

/** Gera data/regulatory/<CC>.json + data/regulatory/index.json. */
function writePartitions(all) {
  const dir = path.join(ROOT, "data", "regulatory");
  fs.mkdirSync(dir, { recursive: true });

  // limpa particoes antigas (evita lixo de execucoes anteriores)
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) fs.rmSync(path.join(dir, f));
  }

  const byCC = new Map();
  for (const rec of all) {
    const cc = (rec.cc || "ZZ").toUpperCase();
    if (!byCC.has(cc)) byCC.set(cc, []);
    byCC.get(cc).push(rec);
  }

  const index = {};
  for (const [cc, recs] of byCC) {
    fs.writeFileSync(path.join(dir, `${cc}.json`), JSON.stringify(recs));
    index[cc] = recs.length;
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));

  const countries = Object.keys(index).sort();
  console.log(`Particoes: ${countries.length} paises -> data/regulatory/{${countries.join(",")}}.json`);
}

main();
