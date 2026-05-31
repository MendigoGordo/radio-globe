/* =========================================================================
 * geolayers.js — Divisas e nomes de paises/estados no globo.
 *
 * Estrategia de dados (performance + cobertura):
 *   - Paises: assets/geo/countries.geojson (110m, ~800 KB) — sempre carregado.
 *   - Estados: particionados por pais em assets/geo/states/<CC>.geojson
 *     (gerados de Natural Earth 10m por tools/build-states.mjs). Carregados
 *     SOB DEMANDA para o pais em foco quando a camera se aproxima.
 *   - Fallback: se nao houver particoes, usa assets/geo/states.geojson (50m).
 *
 * LOD:
 *   - longe  -> so contornos+nomes de paises.
 *   - perto  -> + estados do pais em foco (detalhe 10m, baixado sob demanda).
 *
 * Tudo opcional: se os arquivos faltarem, vira no-op e o globo segue funcional.
 * ========================================================================= */

(function (global) {
  "use strict";

  const STATE = {
    globe: null,
    countries: null,            // GeoJSON paises
    countryLabels: [],
    statesIndex: null,          // { CC: count } das particoes 10m
    loadedStates: new Map(),    // CC -> GeoJSON (cache em memoria)
    pendingCC: new Set(),       // particoes em carregamento
    activeCC: null,             // pais atualmente em detalhe
    fallbackStates: null,       // 50m global (se nao houver particoes)
    showStates: false,
    visible: true,
    labelMaxRank: 2,            // densidade inicial de rotulos (so os maiores)
  };

  const STATE_LOD_ALTITUDE = 1.1;   // abaixo disso, liga estados do pais em foco

  const STYLE = {
    countryStroke: "#5b6b8c",
    transparent: "rgba(0,0,0,0)",
    stateStroke: "rgba(120,150,200,0.4)",
    countryLabelColor: "rgba(220,232,255,0.92)",
    stateLabelColor: "rgba(150,180,230,0.8)",
  };

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return res.json();
  }

  // A fonte 3D do globe.gl (TextGeometry) nao possui glifos acentuados — sem
  // tratamento, "Rússia" vira "R?ssia". Removemos os diacriticos APENAS para a
  // renderizacao do rotulo (o dado original permanece intacto). Resultado:
  // "Russia", "Suica", "Romenia" — legivel, em vez de quebrado.
  function asciiLabel(str) {
    if (!str) return str;
    return String(str)
      .normalize("NFD")                       // separa letra + acento
      .replace(/[\u0300-\u036f]/g, "")        // remove os acentos
      .replace(/[ı]/g, "i").replace(/[ł]/g, "l").replace(/[đ]/g, "d")
      .replace(/[Ø]/g, "O").replace(/[ø]/g, "o").replace(/[ß]/g, "ss")
      .replace(/[Þþ]/g, "th").replace(/[Ðð]/g, "d").replace(/[æ]/g, "ae").replace(/[Æ]/g, "AE");
  }

  function buildCountryLabels(gj) {
    const out = [];
    for (const f of gj.features) {
      const p = f.properties;
      const lat = p.LABEL_Y, lng = p.LABEL_X;
      const name = p.NAME_PT || p.NAME_LONG || p.NAME;
      if (Number.isFinite(lat) && Number.isFinite(lng) && name) {
        // labelrank: 1 = mais importante (paises grandes), 6+ = menores.
        const rank = Number.isFinite(p.LABELRANK) ? p.LABELRANK : 5;
        out.push({ lat, lng, text: asciiLabel(name), kind: "country", rank });
      }
    }
    // ordena por importancia (ajuda o filtro por zoom a ser estavel)
    out.sort((a, b) => a.rank - b.rank);
    return out;
  }

  function buildStateLabels(gj) {
    const out = [];
    for (const f of gj.features) {
      const p = f.properties;
      const lat = p.latitude, lng = p.longitude;
      const name = p.name;
      if (Number.isFinite(lat) && Number.isFinite(lng) && name) {
        out.push({ lat, lng, text: asciiLabel(name), kind: "state", cc: p.iso_a2 || "" });
      }
    }
    return out;
  }

  /* ---- bounding-box util p/ achar o pais sob o ponto central da camera ---- */
  function featureContainsPoint(feature, lat, lng) {
    const g = feature.geometry;
    if (!g) return false;
    const polys = g.type === "Polygon" ? [g.coordinates]
      : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      if (ringContains(poly[0], lng, lat)) {
        // checa buracos
        let inHole = false;
        for (let i = 1; i < poly.length; i++) {
          if (ringContains(poly[i], lng, lat)) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  // ray-casting (x=lng, y=lat)
  function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function countryAt(lat, lng) {
    if (!STATE.countries) return null;
    for (const f of STATE.countries.features) {
      if (featureContainsPoint(f, lat, lng)) {
        return (f.properties.ISO_A2 || f.properties.ISO_A2_EH || "").toUpperCase() || null;
      }
    }
    return null;
  }

  /* ----------------------------- init ----------------------------------- */
  async function init(globe, opts = {}) {
    STATE.globe = globe;
    const countriesUrl = opts.countriesUrl || "assets/geo/countries.geojson";

    try {
      STATE.countries = await fetchJSON(countriesUrl);
      STATE.countryLabels = buildCountryLabels(STATE.countries);
    } catch (err) {
      console.warn("[geolayers] paises indisponiveis:", err.message);
      return false;
    }

    // Indice de particoes de estados (10m por pais). Opcional.
    try {
      STATE.statesIndex = await fetchJSON("assets/geo/states/index.json");
    } catch (_) {
      STATE.statesIndex = null;
    }
    // Fallback global 50m, so se nao houver particoes.
    if (!STATE.statesIndex) {
      try {
        STATE.fallbackStates = await fetchJSON("assets/geo/states.geojson");
      } catch (_) { STATE.fallbackStates = { features: [] }; }
    }

    configureLayers();
    renderAll();
    applyLOD(globe.pointOfView());
    return true;
  }

  function configureLayers() {
    const g = STATE.globe;
    g
      .polygonGeoJsonGeometry((d) => d.geometry)
      .polygonCapColor(() => STYLE.transparent)
      .polygonSideColor(() => STYLE.transparent)
      .polygonStrokeColor((d) => d.__kind === "state" ? STYLE.stateStroke : STYLE.countryStroke)
      .polygonAltitude(0.006)
      .polygonsTransitionDuration(0)
      .polygonLabel(() => "")
      .labelLat("lat").labelLng("lng").labelText("text")
      .labelColor((d) => d.kind === "state" ? STYLE.stateLabelColor : STYLE.countryLabelColor)
      .labelSize((d) => d.kind === "state" ? 0.34 : 0.62)
      .labelDotRadius(0.1)
      .labelResolution(2)
      .labelAltitude(0.012)
      .labelsTransitionDuration(180);
  }

  function activeStateFeatures() {
    if (!STATE.showStates) return [];
    if (STATE.statesIndex) {
      if (STATE.activeCC && STATE.loadedStates.has(STATE.activeCC)) {
        return STATE.loadedStates.get(STATE.activeCC).features;
      }
      return [];
    }
    return STATE.fallbackStates ? STATE.fallbackStates.features : [];
  }

  function renderAll() {
    renderPolygons();
    renderLabels();
  }

  function renderPolygons() {
    const g = STATE.globe;
    if (!STATE.visible) { g.polygonsData([]); return; }
    const feats = [];
    for (const f of STATE.countries.features) { f.__kind = "country"; feats.push(f); }
    for (const f of activeStateFeatures()) { f.__kind = "state"; feats.push(f); }
    g.polygonsData(feats);
  }

  function renderLabels() {
    const g = STATE.globe;
    if (!STATE.visible) { g.labelsData([]); return; }
    // Filtra rotulos de pais por importancia conforme o zoom: longe mostra so
    // os principais (evita a sopa de nomes sobrepostos da imagem), perto revela
    // os menores. STATE_LABEL_MAXRANK e ajustado em applyLOD().
    let data = STATE.countryLabels.filter((d) => d.rank <= STATE.labelMaxRank);
    if (STATE.showStates) {
      data = data.concat(buildStateLabels({ features: activeStateFeatures() }));
    }
    g.labelsData(data);
  }

  /** Limite de rank de rotulo (paises) por altitude da camera. */
  function labelMaxRankForAltitude(alt) {
    if (alt > 1.8) return 2;   // bem longe: so os maiores (Russia, Brasil, EUA...)
    if (alt > 1.2) return 3;
    if (alt > 0.8) return 4;
    if (alt > 0.45) return 6;
    return 99;                 // bem perto: todos
  }

  /** Carrega sob demanda a particao 10m de um pais. */
  async function ensureCountryStates(cc) {
    if (!cc || !STATE.statesIndex) return;
    if (!(cc in STATE.statesIndex)) return;        // pais sem estados na base
    if (STATE.loadedStates.has(cc) || STATE.pendingCC.has(cc)) return;
    STATE.pendingCC.add(cc);
    try {
      const gj = await fetchJSON(`assets/geo/states/${cc}.geojson`);
      STATE.loadedStates.set(cc, gj);
      if (STATE.showStates && STATE.activeCC === cc) renderAll();
    } catch (err) {
      console.warn(`[geolayers] estados de ${cc} indisponiveis:`, err.message);
    } finally {
      STATE.pendingCC.delete(cc);
    }
  }

  /** Chamado a cada zoom/rotacao: liga estados e troca o pais em foco. */
  function applyLOD(pov) {
    if (!STATE.visible) return;
    const want = pov.altitude <= STATE_LOD_ALTITUDE;

    let polysChanged = false;
    let labelsChanged = false;
    if (want !== STATE.showStates) { STATE.showStates = want; polysChanged = true; labelsChanged = true; }

    // Densidade de rotulos de pais conforme o zoom (declutter progressivo).
    // So afeta os LABELS — nao precisa reconstruir os poligonos.
    const maxRank = labelMaxRankForAltitude(pov.altitude);
    if (maxRank !== STATE.labelMaxRank) { STATE.labelMaxRank = maxRank; labelsChanged = true; }

    if (want && STATE.statesIndex) {
      // descobre o pais sob o centro da camera e carrega seus estados
      const cc = countryAt(pov.lat, pov.lng);
      if (cc && cc !== STATE.activeCC) {
        STATE.activeCC = cc;
        polysChanged = true; labelsChanged = true;
        ensureCountryStates(cc);   // assincrono; re-renderiza ao chegar
      }
    }
    if (polysChanged) renderPolygons();
    if (labelsChanged) renderLabels();
  }

  function setVisible(visible) {
    STATE.visible = visible;
    renderAll();
  }

  global.RadioGeoLayers = { init, applyLOD, setVisible, ensureCountryStates };
})(typeof self !== "undefined" ? self : this);
