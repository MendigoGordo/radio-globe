/* =========================================================================
 * Global Radio 3D — globo 3D com radios AM/FM do mundo (estilo Google Earth)
 *
 * Fonte de dados: Radio Browser API (https://www.radio-browser.info)
 * Renderizacao : globe.gl (Three.js / WebGL) — servido localmente em vendor/
 * Player HLS   : hls.js (vendor/) com fallback para <audio> nativo
 * Classificacao: data/bandplan.js (planos de frequencia reais FCC/Anatel/ITU)
 * Cache        : data/cache.js (localStorage com TTL)
 *
 * Nota honesta: o Radio Browser e um diretorio colaborativo de streams, nao um
 * registro regulatorio. A classificacao AM/FM usa os LIMITES REAIS das bandas
 * para validar a frequencia extraida do nome — bem mais precisa que so casar
 * as letras "AM"/"FM", mas ainda limitada aos metadados informados pela base.
 * ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------- Config ---------------------------------- */
  const API_MIRRORS = [
    // 'all' usa DNS round-robin para um mirror vivo (recomendado pela API).
    "https://all.api.radio-browser.info",
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
  ];
  // Proxy/cache opcional na borda (Cloudflare Worker). Quando definido, e usado
  // ANTES dos mirrors: ele cacheia a resposta pesada no edge e serve rapido a
  // todos os usuarios (alem de resolver CORS). Veja tools/cloudflare/.
  // Fontes (precedencia): ?apiProxy= na URL  ->  window.GLOBAL_RADIO_3D_API_PROXY.
  // Ex.: "https://global-radio-3d-api.SEU-SUBDOMINIO.workers.dev"
  function resolveApiProxy() {
    try {
      const p = new URLSearchParams(location.search).get("apiProxy");
      if (p && /^https:\/\//i.test(p)) return p;
    } catch (_) {}
    return window.GLOBAL_RADIO_3D_API_PROXY || "";
  }
  const API_PROXY = resolveApiProxy().replace(/\/+$/, "");

  const MAX_STATIONS = 12000;       // teto: cobre todas as ~11.8k estacoes com geo
  const REQUEST_TIMEOUT_MS = 12000; // chamadas leves (paises, stats)
  const STATION_TIMEOUT_MS = 45000; // catalogo completo (~14 MB) pode ser lento
  const CACHE_TTL = (window.RadioCache && window.RadioCache.DEFAULT_TTL_MS) || 6 * 36e5;

  // Acima de quantas estacoes vale a pena usar Web Worker para normalizar.
  const WORKER_THRESHOLD = 1500;

  // file:// quebra o WebGL (texturas tainted) e Web Workers. Detectamos para
  // cair em modos de fallback funcionais.
  const IS_FILE_PROTOCOL = location.protocol === "file:";

  // Altitude da camera abaixo da qual mostramos pontos individuais.
  // Acima dela, agregacao por hexbin (clustering).
  const LOD_ALTITUDE_THRESHOLD = 0.6;

  // Resolucao FIXA do hexbin (H3). Resolucao fixa evita recalcular o binning
  // de milhares de pontos durante a animacao de zoom (causa de travadas).
  const HEX_RESOLUTION = 3;

  // Performance de render: no modo de pontos NUNCA desenhamos as ~12 mil
  // estacoes de uma vez (cada ponto e um objeto 3D). Renderizamos apenas as
  // que estao na regiao visivel da camera, ate um teto. As demais seguem
  // carregadas (lista, filtros, contagem) — so nao sao desenhadas.
  const MAX_RENDERED_POINTS = 1200;

  // Tamanho do ponto conforme a aproximacao: quanto mais perto (altitude
  // menor), menores os pontos — assim radios proximas se separam visualmente
  // em vez de virar um borrao. Interpola entre os limites por altitude.
  function pointRadiusForAltitude(alt) {
    // alt ~0.6 (entrada no modo pontos) -> raio maior; alt ~0.05 (bem perto) -> menor
    const hi = 0.22, lo = 0.06;          // raios nos extremos
    const aHi = 0.6, aLo = 0.08;         // altitudes correspondentes
    if (alt >= aHi) return hi;
    if (alt <= aLo) return lo;
    const tt = (alt - aLo) / (aHi - aLo);
    return lo + (hi - lo) * tt;
  }

  const BAND = { ALL: "all", FM: "fm", AM: "am" };
  const COLORS = { fm: "#36d399", am: "#ffb547", net: "#8b93a7" };

  // Ordenacoes disponiveis na UI (#6). "relevance" = clickcount (como vem da API).
  const SORTS = ["relevance", "votes", "name", "band"];
  // Teto de itens renderizados na lista lateral (a navegacao por teclado fica
  // fluida e o DOM enxuto; o restante e acessivel refinando filtros/busca).
  const LIST_LIMIT = 300;

  // Player: reconexao automatica com backoff (stream cai o tempo todo).
  const RECONNECT_MAX = 3;
  const RECONNECT_BASE_MS = 1500;

  // i18n helper (degrada para a propria chave se o modulo faltar).
  const I18N = window.RadioI18n || { t: (k) => k, setLang() {}, getLang: () => "pt-BR", langs: () => [], applyDOM() {}, onChange() {} };
  const t = (k, p) => I18N.t(k, p);
  const SAFE = window.RadioSafeURL || { sanitizeImage: (u) => u || "", sanitizeLink: (u) => u || "", displayHost: () => "" };

  /* ----------------------------- Estado ----------------------------------- */
  const state = {
    band: BAND.ALL,
    country: "",
    search: "",
    sort: "relevance",
    allStations: [],
    visible: [],
    selected: null,
    rotating: true,
    mode: "hex",        // "hex" (agregado) | "points" (individual)
    geoVisible: true,   // divisas e nomes de paises/estados
    listOpen: false,    // painel-lista lateral
    listCursor: -1,     // indice ativo na navegacao por teclado
    pov: { lat: 15, lng: -40, altitude: 2.4 },  // ultima posicao da camera
    pointRadius: 0.22,  // raio atual dos pontos (escala com o zoom)
  };

  /* ----------------------------- DOM -------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const el = {
    globe: $("#globeViz"),
    fileBanner: $("#fileBanner"),
    fileBannerClose: $("#fileBannerClose"),
    bandBtns: Array.from(document.querySelectorAll(".band-btn")),
    country: $("#countrySelect"),
    sort: $("#sortSelect"),
    lang: $("#langSelect"),
    search: $("#searchInput"),
    toggleRotate: $("#toggleRotate"),
    toggleGeo: $("#toggleGeo"),
    toggleList: $("#toggleList"),
    listPanel: $("#listPanel"),
    listItems: $("#listItems"),
    listClose: $("#listClose"),
    statCount: $("#statCount"),
    modeBadge: $("#modeBadge"),
    loading: $("#loading"),
    loadingText: $("#loadingText"),
    panel: $("#panel"),
    panelClose: $("#panelClose"),
    pFavicon: $("#pFavicon"),
    pName: $("#pName"),
    pLocation: $("#pLocation"),
    pBand: $("#pBand"),
    pFreq: $("#pFreq"),
    pCodec: $("#pCodec"),
    pBitrate: $("#pBitrate"),
    pLanguage: $("#pLanguage"),
    pVotes: $("#pVotes"),
    pTags: $("#pTags"),
    pHomepage: $("#pHomepage"),
    pNowPlaying: $("#pNowPlaying"),
    playBtn: $("#playBtn"),
    volume: $("#volume"),
    audio: $("#audio"),
  };

  /* ===================== Camada de dados (API + cache) =================== */

  async function fetchWithTimeout(url, opts = {}) {
    const { timeout = REQUEST_TIMEOUT_MS, ...fetchOpts } = opts;
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    try {
      // Sem 'Content-Type' em GET: ele forca um preflight CORS desnecessario
      // (e mais lento). A API responde JSON de qualquer forma.
      return await fetch(url, { ...fetchOpts, signal: ctrl.signal });
    } finally {
      clearTimeout(id);
    }
  }

  /** Lista de bases a tentar, em ordem: proxy (se houver) e depois mirrors. */
  function apiBases() {
    return API_PROXY ? [API_PROXY, ...API_MIRRORS] : API_MIRRORS.slice();
  }

  /**
   * Faz uma "corrida" entre os mirrors: dispara em paralelo e usa a PRIMEIRA
   * resposta valida, em vez de esperar um mirror lento antes de tentar o
   * proximo. Reduz muito a latencia quando um mirror esta congestionado.
   */
  async function raceGet(path, timeout) {
    const bases = apiBases();
    const controllers = bases.map(() => new AbortController());
    let settled = false;

    const attempts = bases.map((base, i) => {
      const id = setTimeout(() => controllers[i].abort(), timeout);
      return fetch(`${base}${path}`, { signal: controllers[i].signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          clearTimeout(id);
          return { json, i };
        })
        .catch((err) => { clearTimeout(id); throw err; });
    });

    try {
      // Promise.any: resolve no primeiro sucesso; rejeita so se todos falharem.
      const { json } = await Promise.any(attempts);
      settled = true;
      // aborta os demais downloads em andamento (economiza banda)
      controllers.forEach((c, i) => { try { c.abort(); } catch (_) {} });
      return json;
    } catch (aggregate) {
      throw (aggregate && aggregate.errors && aggregate.errors[0]) || new Error("Todos os mirrors falharam");
    } finally {
      if (!settled) controllers.forEach((c) => { try { c.abort(); } catch (_) {} });
    }
  }

  /** GET com cache (localStorage/IndexedDB) + failover/corrida entre mirrors. */
  async function apiGet(path, { cacheKey, ttl = CACHE_TTL, idb = false, race = false, timeout = REQUEST_TIMEOUT_MS } = {}) {
    // Leitura do cache: IndexedDB para payloads grandes, localStorage p/ o resto.
    if (cacheKey) {
      if (idb && window.RadioIDB && window.RadioIDB.supported) {
        const hit = await window.RadioIDB.get(cacheKey);
        if (hit) return hit;
      } else if (!idb && window.RadioCache) {
        const hit = window.RadioCache.get(cacheKey);
        if (hit) return hit;
      }
    }

    const store = (json) => {
      if (!cacheKey) return;
      if (idb && window.RadioIDB && window.RadioIDB.supported) {
        window.RadioIDB.set(cacheKey, json, ttl); // assincrono, nao aguarda
      } else if (!idb && window.RadioCache) {
        window.RadioCache.set(cacheKey, json, ttl);
      }
    };

    // Estrategia "corrida" para o catalogo pesado: pega o mirror mais rapido.
    if (race) {
      const json = await raceGet(path, timeout);
      store(json);
      return json;
    }

    // Estrategia sequencial (failover) para chamadas leves.
    let lastErr;
    for (const base of apiBases()) {
      try {
        const res = await fetchWithTimeout(`${base}${path}`, { timeout });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        store(json);
        return json;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Todos os mirrors falharam");
  }

  function buildStationQuery({ countrycode = "", limit = MAX_STATIONS } = {}) {
    const params = new URLSearchParams({
      has_geo_info: "true",
      hidebroken: "true",
      order: "clickcount",
      reverse: "true",
      limit: String(limit),
    });
    if (countrycode) params.set("countrycode", countrycode);
    return `/json/stations/search?${params.toString()}`;
  }

  /** Normaliza via Web Worker (volumes grandes) ou na main thread (fallback). */
  function normalizeAsync(raw) {
    const useWorker = !IS_FILE_PROTOCOL
      && typeof Worker !== "undefined"
      && raw.length >= WORKER_THRESHOLD;
    if (useWorker) {
      return normalizeViaWorker(raw).catch((err) => {
        console.warn("[GlobalRadio3D] Worker falhou, usando main thread:", err);
        return normalizeSync(raw);
      });
    }
    return Promise.resolve(normalizeSync(raw));
  }

  let _worker = null;
  let _workerSeq = 0;
  function getWorker() {
    if (_worker) return _worker;
    try {
      _worker = new Worker("data/normalize.worker.js");
    } catch (_) {
      _worker = null;
    }
    return _worker;
  }

  function normalizeViaWorker(raw) {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      if (!w) return reject(new Error("Worker indisponivel"));
      const id = ++_workerSeq;
      const timer = setTimeout(() => {
        w.removeEventListener("message", onMsg);
        reject(new Error("Worker timeout"));
      }, REQUEST_TIMEOUT_MS);
      function onMsg(e) {
        if (!e.data || e.data.id !== id) return;
        clearTimeout(timer);
        w.removeEventListener("message", onMsg);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.stations);
      }
      w.addEventListener("message", onMsg);
      w.postMessage({ id, raw });
    });
  }

  /** Normaliza, deduplica e classifica (frequencia real) na main thread. */
  function normalizeSync(raw) {
    const seen = new Set();
    const out = [];
    const classify = (window.RadioBandPlan && window.RadioBandPlan.classify) || fallbackClassify;
    for (const s of raw) {
      const lat = Number(s.geo_lat);
      const lng = Number(s.geo_long);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      if (lat === 0 && lng === 0) continue;
      const id = s.stationuuid;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const cls = classify({ name: s.name, tags: s.tags });
      out.push({
        id,
        name: (s.name || "").trim() || "Sem nome",
        lat, lng,
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

  // Fallback se bandplan.js nao carregar (mantem o app funcional).
  function fallbackClassify(s) {
    const hay = `${s.name || ""} ${s.tags || ""}`.toLowerCase();
    if (/\bfm\b/.test(hay)) return { band: "fm", freq: null, unit: "", confidence: "low" };
    if (/\bam\b/.test(hay)) return { band: "am", freq: null, unit: "", confidence: "low" };
    return { band: "net", freq: null, unit: "", confidence: "none" };
  }

  /* ===================== Filtros ========================================== */
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    state.visible = state.allStations.filter((s) => {
      if (state.band !== BAND.ALL && s.band !== state.band) return false;
      if (q) {
        const inName = s.name.toLowerCase().includes(q);
        const inTags = s.tags.some((t) => t.toLowerCase().includes(q));
        const inCity = s.state.toLowerCase().includes(q);
        const inFreq = s.freq != null && String(s.freq).includes(q);
        if (!inName && !inTags && !inCity && !inFreq) return false;
      }
      return true;
    });
    sortVisible();
    renderLayers();
    renderList();
    el.statCount.textContent = state.visible.length.toLocaleString(I18N.getLang());
    // expoe contagem para o medidor de FPS
    window.GlobalRadio3DStats = window.GlobalRadio3DStats || {};
    window.GlobalRadio3DStats.visibleCount = state.visible.length;
    syncURL();
  }

  /** Ordena state.visible conforme state.sort (#6). */
  function sortVisible() {
    const lang = I18N.getLang();
    const bandRank = { fm: 0, am: 1, net: 2 };
    const cmp = {
      relevance: (a, b) => (b.clickcount - a.clickcount) || (b.votes - a.votes),
      votes: (a, b) => (b.votes - a.votes) || (b.clickcount - a.clickcount),
      name: (a, b) => a.name.localeCompare(b.name, lang, { sensitivity: "base" }),
      band: (a, b) => (bandRank[a.band] - bandRank[b.band])
        || ((a.freq ?? Infinity) - (b.freq ?? Infinity))
        || a.name.localeCompare(b.name, lang, { sensitivity: "base" }),
    }[state.sort] || null;
    if (cmp) state.visible.sort(cmp);
  }

  /* ===================== Persistencia de filtros na URL ================== */
  let _suppressURL = false;

  function syncURL() {
    if (_suppressURL) return;
    const params = new URLSearchParams();
    if (state.band !== BAND.ALL) params.set("band", state.band);
    if (state.country) params.set("country", state.country);
    if (state.search.trim()) params.set("q", state.search.trim());
    if (state.sort && state.sort !== "relevance") params.set("sort", state.sort);
    if (I18N.getLang && I18N.getLang() !== I18N.DEFAULT_LANG) params.set("lang", I18N.getLang());
    const qs = params.toString();
    const url = qs ? `${location.pathname}?${qs}` : location.pathname;
    history.replaceState(null, "", url);
  }

  /** Le os filtros da URL para o estado inicial. */
  function readURL() {
    const p = new URLSearchParams(location.search);
    const band = p.get("band");
    if (band && Object.values(BAND).includes(band)) state.band = band;
    const country = p.get("country");
    if (country && /^[A-Za-z]{2}$/.test(country)) state.country = country.toUpperCase();
    const q = p.get("q");
    if (q) state.search = q;
    const sort = p.get("sort");
    if (sort && SORTS.includes(sort)) state.sort = sort;
  }

  /** Reflete o estado atual nos controles da UI. */
  function syncControlsFromState() {
    el.bandBtns.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.band === state.band));
    if (state.search) el.search.value = state.search;
    if (el.sort) el.sort.value = state.sort;
    // o select de pais e populado de forma assincrona; ajustado em loadCountries()
  }
  /* ===================== Globo (globe.gl) + LOD =========================== */
  let globe;

  function initGlobe() {
    globe = Globe()(el.globe);

    if (IS_FILE_PROTOCOL) {
      // file:// "contamina" texturas no WebGL -> sem imagem do globo.
      // Fallback: globo solido colorido + fundo escuro. App segue 100% funcional.
      globe
        .backgroundColor("#05070f")
        .showGlobe(true)
        .showAtmosphere(true)
        .atmosphereColor("#4ea1ff")
        .atmosphereAltitude(0.18);
      try {
        const mat = globe.globeMaterial();
        const T = window.THREE;
        if (mat && T) { mat.color = new T.Color("#16223f"); mat.emissive = new T.Color("#0a1430"); }
      } catch (_) { /* THREE pode nao estar exposto; ignora */ }
    } else {
      globe
        .globeImageUrl("assets/earth-blue-marble.jpg")
        .bumpImageUrl("assets/earth-topology.png")
        .backgroundImageUrl("assets/night-sky.png")
        .atmosphereColor("#4ea1ff")
        .atmosphereAltitude(0.18);
    }

    globe
      // ---- camada de pontos (LOD perto) ----
      .pointsData([])
      .pointLat("lat").pointLng("lng")
      .pointAltitude(0.01)
      .pointRadius(pointRadiusForAltitude(0.6))
      .pointColor((d) => COLORS[d.band] || COLORS.net)
      .pointLabel(pointLabelHTML)
      .onPointClick(onStationClick)
      .pointsMerge(false)
      .pointsTransitionDuration(0)
      // ---- camada hexbin (LOD longe / clustering) ----
      .hexBinPointsData([])
      .hexBinPointLat("lat").hexBinPointLng("lng")
      .hexBinPointWeight(1)
      .hexBinResolution(HEX_RESOLUTION)
      .hexMargin(0.28)
      .hexAltitude((d) => Math.min(0.5, 0.01 + d.sumWeight * 0.01))
      .hexTopColor(hexColor)
      .hexSideColor(hexColor)
      .hexBinMerge(false)
      .hexLabel(hexLabelHTML)
      .onHexClick(onHexClick)
      .hexTransitionDuration(280);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 101;   // permite aproximar mais (separa regioes densas)

    globe.pointOfView({ lat: 15, lng: -40, altitude: 2.4 }, 0);
    globe.onZoom(onZoom);

    window.addEventListener("resize", onResize, { passive: true });
    onResize();
  }

  function onResize() {
    if (!globe) return;
    globe.width(window.innerWidth).height(window.innerHeight);
  }

  /** Alterna entre hexbin (agregado) e pontos (individual) conforme o zoom. */
  function onZoom(pov) {
    state.pov = pov;
    const wantPoints = pov.altitude <= LOD_ALTITUDE_THRESHOLD;
    const newMode = wantPoints ? "points" : "hex";
    if (newMode !== state.mode) {
      state.mode = newMode;
      if (wantPoints) {
        // ajusta o tamanho dos pontos para a altitude atual ao entrar no modo
        state.pointRadius = pointRadiusForAltitude(pov.altitude);
        globe.pointRadius(state.pointRadius);
      }
      renderLayers();
      updateModeBadge();
      // Ao aproximar (modo "Estacoes"), pausa a rotacao automatica: e quando
      // clicar nos pontos importa. Ao afastar de novo, nao reativa sozinho.
      if (wantPoints && state.rotating) setRotating(false);
    } else if (state.mode === "points") {
      // No modo de pontos, re-seleciona o subconjunto visivel conforme a
      // camera se move (culling por viewport). Debounced para nao re-renderizar
      // a cada quadro durante o arrasto/voo.
      scheduleViewportRender();
      // Escala o tamanho dos pontos conforme o zoom para que radios proximas
      // nao se sobreponham (so atualiza quando muda de forma perceptivel).
      const r = pointRadiusForAltitude(pov.altitude);
      if (Math.abs(r - state.pointRadius) > 0.005) {
        state.pointRadius = r;
        globe.pointRadius(r);
      }
    }
    // LOD das divisas/nomes e caro (point-in-polygon em ~170 paises). Durante o
    // voo de aproximacao o onZoom dispara a cada quadro, entao adiamos para
    // quando a camera "assenta" — evita o engasgo ao clicar numa radio.
    scheduleGeoLOD(pov);
  }

  let _viewportTimer = 0;
  function scheduleViewportRender() {
    if (_viewportTimer) return;
    _viewportTimer = setTimeout(() => {
      _viewportTimer = 0;
      if (state.mode === "points") globe.pointsData(visiblePointsForCamera());
    }, 120);
  }

  let _geoLODTimer = 0;
  function scheduleGeoLOD(pov) {
    if (!(state.geoVisible && window.RadioGeoLayers)) return;
    if (_geoLODTimer) clearTimeout(_geoLODTimer);
    _geoLODTimer = setTimeout(() => {
      _geoLODTimer = 0;
      window.RadioGeoLayers.applyLOD(state.pov || pov);
    }, 160);
  }

  /** Liga/desliga a rotacao automatica e sincroniza o botao. */
  function setRotating(on) {
    state.rotating = on;
    if (globe) globe.controls().autoRotate = on;
    if (el.toggleRotate) {
      el.toggleRotate.textContent = on ? "⏸" : "▶";
      const key = on ? "toggle.rotate.pause" : "toggle.rotate.play";
      el.toggleRotate.setAttribute("title", t(key));
      el.toggleRotate.setAttribute("aria-label", t(key));
    }
  }

  function renderLayers() {
    if (!globe) return;
    if (state.mode === "points") {
      globe.pointsData(visiblePointsForCamera());
      globe.hexBinPointsData([]);
    } else {
      globe.hexBinPointsData(state.visible);
      globe.pointsData([]);
    }
  }

  /**
   * Seleciona o subconjunto de estacoes a DESENHAR no modo de pontos: apenas as
   * proximas do centro da camera, ate MAX_RENDERED_POINTS. Isso mantem o globo
   * fluido (cada ponto e um objeto 3D) sem remover nenhuma estacao — as demais
   * seguem em state.visible (lista, busca, contagem).
   */
  function visiblePointsForCamera() {
    const all = state.visible;
    if (all.length <= MAX_RENDERED_POINTS) return all;

    const { lat, lng, altitude } = state.pov || { lat: 0, lng: 0, altitude: 0.6 };
    // Raio angular aproximado do campo de visao: quanto mais perto (altitude
    // menor), menor a area coberta. Limitamos entre ~12 e ~80 graus.
    const radiusDeg = Math.max(12, Math.min(80, altitude * 70));

    // Ordena por proximidade angular do centro e corta no teto.
    const scored = [];
    for (const s of all) {
      const dLat = s.lat - lat;
      let dLng = Math.abs(s.lng - lng);
      if (dLng > 180) dLng = 360 - dLng;  // wrap da longitude
      // distancia angular aproximada (suficiente para ranquear)
      const d2 = dLat * dLat + dLng * dLng;
      if (d2 <= radiusDeg * radiusDeg) scored.push({ s, d2 });
    }
    scored.sort((a, b) => a.d2 - b.d2);
    return scored.slice(0, MAX_RENDERED_POINTS).map((x) => x.s);
  }

  function updateModeBadge() {
    if (!el.modeBadge) return;
    el.modeBadge.textContent = state.mode === "points" ? t("mode.stations") : t("mode.grouped");
    el.modeBadge.title = state.mode === "points" ? t("mode.stations.title") : t("mode.grouped.title");
  }

  // Cor do hexbin: mistura conforme banda dominante das estacoes no bin.
  function hexColor(d) {
    const pts = d.points || [];
    let fm = 0, am = 0, net = 0;
    for (const p of pts) {
      if (p.band === "fm") fm++; else if (p.band === "am") am++; else net++;
    }
    if (fm >= am && fm >= net) return COLORS.fm;
    if (am >= fm && am >= net) return COLORS.am;
    return COLORS.net;
  }

  function hexLabelHTML(d) {
    const pts = d.points || [];
    let fm = 0, am = 0, net = 0;
    for (const p of pts) {
      if (p.band === "fm") fm++; else if (p.band === "am") am++; else net++;
    }
    return `
      <div style="background:rgba(10,14,26,.92);border:1px solid rgba(120,160,255,.25);
                  padding:8px 10px;border-radius:8px;font:600 12px/1.4 'Segoe UI',sans-serif;
                  color:#e8edf7;">
        <div style="font-size:13px">${escapeHTML(t("hex.region", { n: pts.length }))}</div>
        <div style="font-weight:400;color:#93a0bd;margin-top:3px">
          <span style="color:${COLORS.fm}">● FM ${fm}</span> &nbsp;
          <span style="color:${COLORS.am}">● AM ${am}</span> &nbsp;
          <span style="color:${COLORS.net}">● ${escapeHTML(t("band.net.short"))} ${net}</span>
        </div>
        <div style="font-weight:400;color:#6b7896;margin-top:3px;font-size:11px">${escapeHTML(t("hex.zoom"))}</div>
      </div>`;
  }

  function pointLabelHTML(d) {
    const bandTxt = d.band === "net" ? t("band.net.short") : d.band.toUpperCase();
    const freq = d.freq != null ? ` ${d.freq} ${d.freqUnit}` : "";
    const loc = [d.state, d.country].filter(Boolean).join(", ");
    return `
      <div style="background:rgba(10,14,26,.92);border:1px solid rgba(120,160,255,.25);
                  padding:8px 10px;border-radius:8px;font:600 12px/1.3 'Segoe UI',sans-serif;
                  color:#e8edf7;max-width:230px;">
        <div style="color:${COLORS[d.band] || COLORS.net}">● ${escapeHTML(bandTxt + freq)}</div>
        <div style="font-size:13px;margin-top:2px">${escapeHTML(d.name)}</div>
        ${loc ? `<div style="color:#93a0bd;font-weight:400;margin-top:2px">${escapeHTML(loc)}</div>` : ""}
      </div>`;
  }

  /* ===================== Interacao ======================================= */
  function onHexClick(d) {
    // aproxima na regiao do bin -> dispara LOD para pontos
    globe.pointOfView({ lat: d.points[0].lat, lng: d.points[0].lng, altitude: 0.7 }, 900);
  }

  function onStationClick(station) {
    selectStation(station, { fly: true, openPanel: true });
  }

  /** Seleciona uma estacao (origem: globo OU lista) e atualiza tudo. */
  function selectStation(station, { fly = true, openPanel = true } = {}) {
    state.selected = station;
    if (fly && globe) {
      globe.pointOfView({ lat: station.lat, lng: station.lng, altitude: 0.55 }, 900);
    }
    if (openPanel) showPanel(station);
    highlightListItem(station.id);
  }

  /* ===================== Lista de estacoes (acessivel) =================== */
  /*
   * Lista lateral navegavel por teclado (setas/Home/End/Enter) e ideal para
   * toque no mobile, onde clicar num ponto minusculo do globo e dificil (#1/#7).
   * Renderiza ate LIST_LIMIT itens; alem disso, sugere refinar os filtros.
   */
  function renderList() {
    if (!el.listItems) return;
    const ul = el.listItems;
    ul.innerHTML = "";
    state.listCursor = -1;
    ul.setAttribute("aria-activedescendant", "");

    if (!state.visible.length) {
      const li = document.createElement("li");
      li.className = "list-empty";
      li.textContent = t("list.empty");
      ul.appendChild(li);
      return;
    }

    const frag = document.createDocumentFragment();
    const shown = state.visible.slice(0, LIST_LIMIT);
    shown.forEach((s, i) => frag.appendChild(makeListItem(s, i)));
    ul.appendChild(frag);

    const overflow = state.visible.length - shown.length;
    if (overflow > 0) {
      const li = document.createElement("li");
      li.className = "list-more";
      li.textContent = t("list.more", { n: overflow.toLocaleString(I18N.getLang()) });
      ul.appendChild(li);
    }

    // mantem destaque se a selecao atual estiver na lista
    if (state.selected) highlightListItem(state.selected.id);
  }

  function makeListItem(s, index) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.id = `li-${s.id}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.dataset.index = String(index);
    li.dataset.id = s.id;

    const dot = document.createElement("i");
    dot.className = "li-dot";
    dot.style.background = COLORS[s.band] || COLORS.net;
    dot.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "li-body";

    const name = document.createElement("span");
    name.className = "li-name";
    name.textContent = s.name;

    const meta = document.createElement("span");
    meta.className = "li-meta";
    const bandTxt = s.band === "net" ? t("band.net.short") : s.band.toUpperCase();
    const freq = s.freq != null ? ` ${s.freq} ${s.freqUnit}` : "";
    const loc = [s.state, s.country].filter(Boolean).join(", ");
    meta.textContent = [bandTxt + freq, loc].filter(Boolean).join(" · ");

    body.appendChild(name);
    body.appendChild(meta);
    li.appendChild(dot);
    li.appendChild(body);

    li.addEventListener("click", () => {
      setListCursor(index, false);
      selectStation(s, { fly: true, openPanel: true });
    });
    return li;
  }

  function listItemNodes() {
    return el.listItems ? Array.from(el.listItems.querySelectorAll(".list-item")) : [];
  }

  function setListCursor(index, scroll = true) {
    const nodes = listItemNodes();
    if (!nodes.length) return;
    const clamped = Math.max(0, Math.min(index, nodes.length - 1));
    nodes.forEach((n) => { n.classList.remove("is-cursor"); n.setAttribute("aria-selected", "false"); });
    const node = nodes[clamped];
    node.classList.add("is-cursor");
    node.setAttribute("aria-selected", "true");
    el.listItems.setAttribute("aria-activedescendant", node.id);
    state.listCursor = clamped;
    if (scroll) node.scrollIntoView({ block: "nearest" });
  }

  function highlightListItem(id) {
    const nodes = listItemNodes();
    nodes.forEach((n) => n.classList.toggle("is-selected", n.dataset.id === id));
  }

  function activateListCursor() {
    const nodes = listItemNodes();
    if (state.listCursor < 0 || state.listCursor >= nodes.length) return;
    const id = nodes[state.listCursor].dataset.id;
    const s = state.visible.find((x) => x.id === id);
    if (s) selectStation(s, { fly: true, openPanel: true });
  }

  function onListKeydown(e) {
    const nodes = listItemNodes();
    if (!nodes.length) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setListCursor(state.listCursor < 0 ? 0 : state.listCursor + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setListCursor(state.listCursor <= 0 ? 0 : state.listCursor - 1);
        break;
      case "Home":
        e.preventDefault();
        setListCursor(0);
        break;
      case "End":
        e.preventDefault();
        setListCursor(nodes.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        activateListCursor();
        break;
    }
  }

  function setListOpen(open) {
    state.listOpen = open;
    el.listPanel.classList.toggle("hidden", !open);
    el.listPanel.setAttribute("aria-hidden", String(!open));
    if (el.toggleList) {
      el.toggleList.classList.toggle("is-active", open);
      el.toggleList.setAttribute("aria-pressed", String(open));
      const key = open ? "toggle.list.close" : "toggle.list.open";
      el.toggleList.setAttribute("title", t(key));
      el.toggleList.setAttribute("aria-label", t(key));
    }
    if (open) {
      // foca a lista para navegacao imediata por teclado
      requestAnimationFrame(() => { try { el.listItems.focus(); } catch (_) {} });
    }
  }

  /* ===================== Painel de detalhes ============================== */
  function showPanel(s) {
    el.panel.classList.remove("hidden");
    el.pName.textContent = s.name;
    el.pLocation.textContent = [s.state, s.country].filter(Boolean).join(", ") || t("location.unknown");

    // Favicon: URL de terceiro saneada (https-upgrade, esquemas seguros). #3
    const safeFav = SAFE.sanitizeImage(s.favicon);
    if (safeFav) {
      el.pFavicon.src = safeFav;
      el.pFavicon.style.visibility = "visible";
      el.pFavicon.onerror = () => { el.pFavicon.style.visibility = "hidden"; };
    } else {
      el.pFavicon.removeAttribute("src");
      el.pFavicon.style.visibility = "hidden";
    }

    const bandLabel = s.band === "net" ? t("band.net.full") : s.band.toUpperCase();
    el.pBand.textContent = bandLabel;
    el.pBand.style.color = COLORS[s.band] || COLORS.net;
    // selo de verificacao regulatoria
    if (s.bandConfidence === "verified") {
      const tick = document.createElement("span");
      tick.className = "verified-badge";
      tick.title = s.callsign
        ? t("verified.callsign", { callsign: s.callsign, km: s.regDistanceKm })
        : t("verified.generic");
      tick.textContent = s.callsign ? `✓ ${s.callsign}` : t("verified.badge");
      el.pBand.appendChild(document.createTextNode(" "));
      el.pBand.appendChild(tick);
    }

    if (s.freq != null) {
      el.pFreq.textContent = `${s.freq} ${s.freqUnit}`;
    } else {
      el.pFreq.textContent = s.bandConfidence === "low" ? t("freq.notinformed") : "—";
    }

    el.pCodec.textContent = s.codec || "—";
    el.pBitrate.textContent = s.bitrate ? `${s.bitrate} kbps` : "—";
    el.pLanguage.textContent = s.language || "—";
    el.pVotes.textContent = s.votes.toLocaleString(I18N.getLang());

    el.pTags.innerHTML = "";
    s.tags.slice(0, 8).forEach((tag) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      el.pTags.appendChild(span);
    });

    // Homepage: link de terceiro saneado (apenas http/https). #3
    const safeHome = SAFE.sanitizeLink(s.homepage);
    if (safeHome) {
      el.pHomepage.href = safeHome;
      el.pHomepage.style.display = "inline-block";
    } else {
      el.pHomepage.removeAttribute("href");
      el.pHomepage.style.display = "none";
    }

    resetPlayerUI();
  }

  function closePanel() {
    el.panel.classList.add("hidden");
    stopAudio();
    state.selected = null;
    highlightListItem(null);
  }

  /* ===================== Player de audio (HLS + nativo) ================== */
  /*
   * Robustez (#5):
   *   - Estados de buffering reais via eventos do <audio> (waiting/playing/
   *     stalled/canplay) -> feedback honesto, sem inventar.
   *   - Reconexao automatica com backoff exponencial quando o stream cai
   *     (erros de rede / stall prolongado), ate RECONNECT_MAX tentativas.
   *   - "Tocando agora": metadados ID3 temporizados de HLS (hls.js) sao lidos
   *     quando o stream os fornece. ICY/Icecast de streams simples NAO sao
   *     acessiveis no navegador (CORS + o proprio <audio> consome o corpo),
   *     entao nesse caso mostramos apenas "ao vivo" — sem fabricar dados.
   */
  let hls = null;
  let reconnect = { tries: 0, timer: 0, url: "", active: false };
  let stallTimer = 0;

  function isHlsUrl(url) {
    return /\.m3u8(\?|$)/i.test(url);
  }

  function destroyHls() {
    if (hls) {
      try { hls.destroy(); } catch (_) {}
      hls = null;
    }
  }

  function clearReconnect() {
    if (reconnect.timer) { clearTimeout(reconnect.timer); reconnect.timer = 0; }
    reconnect.tries = 0;
    reconnect.url = "";
    reconnect.active = false;
  }

  function clearStallTimer() {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = 0; }
  }

  function resetPlayerUI() {
    el.playBtn.classList.remove("is-playing", "is-loading");
    el.playBtn.textContent = "▶";
    el.playBtn.setAttribute("aria-label", t("player.play"));
    el.pNowPlaying.textContent = t("player.ready");
    el.pNowPlaying.removeAttribute("data-track");
  }

  function stopAudio() {
    clearReconnect();
    clearStallTimer();
    destroyHls();
    el.audio.pause();
    el.audio.removeAttribute("src");
    try { el.audio.load(); } catch (_) {}
    resetPlayerUI();
  }

  function setNowPlaying(text, track) {
    if (track) {
      el.pNowPlaying.textContent = t("player.nowplaying", { title: track });
      el.pNowPlaying.setAttribute("data-track", track);
      el.pNowPlaying.title = track;
    } else {
      el.pNowPlaying.textContent = text;
      el.pNowPlaying.removeAttribute("data-track");
      el.pNowPlaying.removeAttribute("title");
    }
  }

  async function togglePlay() {
    const s = state.selected;
    if (!s || !s.url) {
      setNowPlaying(t("player.unavailable"));
      return;
    }
    // ja tocando esta estacao -> pausa
    if (!el.audio.paused && el.audio.dataset.id === s.id) {
      stopAudio();
      return;
    }
    startPlayback(s, { isReconnect: false });
  }

  async function startPlayback(s, { isReconnect } = {}) {
    if (!isReconnect) {
      stopAudio();
      el.audio.dataset.id = s.id;
    } else {
      // mantem o id; apenas recria o pipeline
      clearStallTimer();
      destroyHls();
    }
    el.audio.volume = Number(el.volume.value);
    el.playBtn.classList.add("is-loading");
    setNowPlaying(isReconnect ? t("player.reconnecting", { n: reconnect.tries }) : t("player.connecting"));

    try {
      if (isHlsUrl(s.url)) {
        await playHls(s.url);
      } else {
        el.audio.src = s.url;
        await el.audio.play();
      }
      onPlaySuccess();
    } catch (err) {
      handlePlaybackDrop();
    }
  }

  /** Toca HLS: nativo se suportado (Safari/iOS), senao hls.js. */
  function playHls(url) {
    return new Promise((resolve, reject) => {
      const canNative = el.audio.canPlayType("application/vnd.apple.mpegurl");
      if (canNative) {
        el.audio.src = url;
        el.audio.play().then(resolve).catch(reject);
        return;
      }
      if (typeof Hls === "undefined" || !Hls.isSupported()) {
        reject(new Error("HLS nao suportado neste navegador"));
        return;
      }
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      let settled = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        el.audio.play().then(() => { settled = true; resolve(); }).catch(reject);
      });
      // Metadados ID3 temporizados (titulo da faixa), quando o stream fornece.
      hls.on(Hls.Events.FRAG_PARSING_METADATA, (_evt, data) => {
        const title = extractId3Title(data);
        if (title) setNowPlaying(null, title);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal && !settled) { destroyHls(); reject(new Error("HLS fatal: " + data.type)); }
        else if (data.fatal) { handlePlaybackDrop(); }
      });
      hls.loadSource(url);
      hls.attachMedia(el.audio);
    });
  }

  /** Extrai um titulo legivel de frames ID3 entregues pelo hls.js. */
  function extractId3Title(data) {
    try {
      const samples = (data && data.samples) || [];
      for (const sample of samples) {
        const frames = (window.Hls && Hls.getId3Frames) ? Hls.getId3Frames(sample.data) : null;
        const list = frames || (sample.frames) || [];
        for (const f of list) {
          // TIT2 = titulo; muitos encoders usam TXXX/"data" com "Artista - Musica"
          if (f && (f.key === "TIT2" || f.key === "TXXX" || f.key === "TIT1") && f.data) {
            const v = typeof f.data === "string" ? f.data : (f.data.info || f.data.text || "");
            if (v && String(v).trim()) return String(v).trim().slice(0, 120);
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function onPlaySuccess() {
    el.playBtn.classList.remove("is-loading");
    el.playBtn.classList.add("is-playing");
    el.playBtn.textContent = "⏸";
    el.playBtn.setAttribute("aria-label", t("player.pause"));
    // se um titulo ja chegou (HLS), preserva; senao "ao vivo"
    if (!el.pNowPlaying.getAttribute("data-track")) setNowPlaying(t("player.live"));
    reconnect.tries = 0;           // sucesso zera o contador de tentativas
    reconnect.active = false;
  }

  /** Stream caiu (erro/stall): tenta reconectar com backoff, ou desiste. */
  function handlePlaybackDrop() {
    const s = state.selected;
    if (!s || el.audio.dataset.id !== (s && s.id)) return;
    clearStallTimer();

    if (reconnect.tries >= RECONNECT_MAX) {
      el.playBtn.classList.remove("is-loading", "is-playing");
      el.playBtn.textContent = "▶";
      el.playBtn.setAttribute("aria-label", t("player.play"));
      setNowPlaying(t("player.gaveup"));
      destroyHls();
      reconnect.active = false;
      return;
    }

    reconnect.tries += 1;
    reconnect.active = true;
    el.playBtn.classList.add("is-loading");
    setNowPlaying(t("player.reconnecting", { n: reconnect.tries }));
    const delay = RECONNECT_BASE_MS * Math.pow(2, reconnect.tries - 1);
    reconnect.timer = setTimeout(() => {
      if (state.selected && state.selected.id === s.id) {
        startPlayback(s, { isReconnect: true });
      }
    }, delay);
  }

  /** Liga os eventos do <audio> a estados honestos de buffering/erro. */
  function bindAudioLifecycle() {
    const a = el.audio;
    // buffering: a midia parou esperando dados
    a.addEventListener("waiting", () => {
      if (!a.paused && !reconnect.active) {
        el.playBtn.classList.add("is-loading");
        if (!el.pNowPlaying.getAttribute("data-track")) setNowPlaying(t("player.buffering"));
      }
    });
    // voltou a tocar
    a.addEventListener("playing", () => {
      clearStallTimer();
      onPlaySuccess();
    });
    a.addEventListener("canplay", () => { el.playBtn.classList.remove("is-loading"); });
    // stall: sem progresso por tempo demais -> trata como queda e reconecta
    a.addEventListener("stalled", () => {
      if (a.paused) return;
      clearStallTimer();
      stallTimer = setTimeout(() => { if (!a.paused) handlePlaybackDrop(); }, 8000);
    });
    a.addEventListener("ended", resetPlayerUI);
    a.addEventListener("error", () => {
      if (a.getAttribute("src") || hls) handlePlaybackDrop();
    });
  }

  /* ===================== Carga de dados ================================== */
  async function loadStations() {
    showLoading(state.country ? t("loading.country") : t("loading.stations"));
    try {
      const cacheKey = `stations:${state.country || "world"}:${MAX_STATIONS}`;
      const raw = await apiGet(buildStationQuery({ countrycode: state.country }),
        { cacheKey, idb: true, race: true, timeout: STATION_TIMEOUT_MS });
      state.allStations = await normalizeAsync(raw);
      // Cruzamento opcional com base regulatoria (FCC/Anatel), se disponivel.
      if (window.RadioRegulatory && window.RadioRegulatory.ready) {
        // carrega sob demanda a particao do pais filtrado (se particionado)
        if (state.country && window.RadioRegulatory.loadCountry) {
          await window.RadioRegulatory.loadCountry(state.country).catch(() => {});
        }
        const { confirmed } = window.RadioRegulatory.refine(state.allStations);
        if (confirmed) console.info(`[GlobalRadio3D] ${confirmed} estacoes confirmadas via base regulatoria.`);
      }
      applyFilters();
      updateModeBadge();
      if (state.allStations.length === 0) {
        el.loadingText.textContent = t("loading.none");
        return;
      }
    } catch (err) {
      el.loadingText.textContent = t("loading.error");
      console.error("[GlobalRadio3D] Falha no carregamento:", err);
      return;
    }
    hideLoading();
  }

  async function loadCountries() {
    try {
      const data = await apiGet(
        "/json/countries?order=stationcount&reverse=true&hidebroken=true",
        { cacheKey: "countries", ttl: 24 * 36e5 }
      );
      const top = data.filter((c) => c.iso_3166_1 && c.stationcount > 0).slice(0, 60);
      top.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      const frag = document.createDocumentFragment();
      const br = top.find((c) => c.iso_3166_1 === "BR");
      if (br) frag.appendChild(makeCountryOption(br));
      top.forEach((c) => {
        if (c.iso_3166_1 === "BR") return;
        frag.appendChild(makeCountryOption(c));
      });
      el.country.appendChild(frag);
      // reflete o pais vindo da URL no select (apos popular as opcoes)
      if (state.country) el.country.value = state.country;
    } catch (err) {
      console.warn("[GlobalRadio3D] Nao foi possivel carregar a lista de paises:", err);
    }
  }

  function makeCountryOption(c) {
    const opt = document.createElement("option");
    opt.value = c.iso_3166_1;
    opt.textContent = `${c.name} (${c.stationcount})`;
    return opt;
  }

  /** Popula o seletor de idiomas a partir do RadioI18n. */
  function loadLanguages() {
    if (!el.lang || !I18N.langs) return;
    el.lang.innerHTML = "";
    I18N.langs().forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.label;
      el.lang.appendChild(opt);
    });
    el.lang.value = I18N.getLang();
  }

  /* ===================== UI helpers ====================================== */
  function showLoading(text) {
    el.loadingText.textContent = text || "Carregando...";
    el.loading.classList.remove("hidden");
  }
  function hideLoading() { el.loading.classList.add("hidden"); }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ===================== Eventos ========================================= */
  function bindEvents() {
    el.bandBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.bandBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.band = btn.dataset.band;
        applyFilters();
      });
    });

    el.country.addEventListener("change", () => {
      state.country = el.country.value;
      loadStations();
    });

    if (el.sort) {
      el.sort.addEventListener("change", () => {
        state.sort = SORTS.includes(el.sort.value) ? el.sort.value : "relevance";
        applyFilters();
      });
    }

    if (el.lang) {
      el.lang.addEventListener("change", () => {
        I18N.setLang(el.lang.value);
        // syncURL roda dentro do onChange via applyFilters? Garantimos aqui:
        syncURL();
      });
    }

    el.search.addEventListener("input", debounce((e) => {
      state.search = e.target.value;
      applyFilters();
    }, 220));

    el.toggleRotate.addEventListener("click", () => {
      setRotating(!state.rotating);
    });

    if (el.toggleGeo) {
      el.toggleGeo.addEventListener("click", () => {
        state.geoVisible = !state.geoVisible;
        el.toggleGeo.classList.toggle("is-active", state.geoVisible);
        el.toggleGeo.setAttribute("aria-pressed", String(state.geoVisible));
        if (window.RadioGeoLayers) window.RadioGeoLayers.setVisible(state.geoVisible);
      });
    }

    if (el.toggleList) {
      el.toggleList.addEventListener("click", () => setListOpen(!state.listOpen));
    }
    if (el.listClose) {
      el.listClose.addEventListener("click", () => setListOpen(false));
    }
    if (el.listItems) {
      el.listItems.addEventListener("keydown", onListKeydown);
    }

    el.panelClose.addEventListener("click", closePanel);
    el.playBtn.addEventListener("click", togglePlay);
    el.volume.addEventListener("input", () => { el.audio.volume = Number(el.volume.value); });

    if (el.fileBannerClose) {
      el.fileBannerClose.addEventListener("click", () => el.fileBanner.classList.add("hidden"));
    }

    bindAudioLifecycle();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.listOpen && document.activeElement && el.listPanel.contains(document.activeElement)) {
          setListOpen(false);
        } else {
          closePanel();
        }
      }
      if (e.key === " " && state.selected && document.activeElement.tagName !== "INPUT"
          && !el.listPanel.contains(document.activeElement)) {
        e.preventDefault();
        togglePlay();
      }
    });

    // Interagir com o globo (arrastar/clicar) PARA a rotacao de vez — sem ela
    // voltar sozinha, o que tornava os pontos quase impossiveis de clicar.
    // Para retomar, o usuario usa o botao/tecla de rotacao.
    el.globe.addEventListener("pointerdown", () => {
      if (state.rotating) setRotating(false);
    });

    // Re-renderiza strings dinamicas ao trocar de idioma.
    I18N.onChange(() => {
      if (el.lang) el.lang.value = I18N.getLang();
      updateModeBadge();
      renderList();
      if (state.selected) showPanel(state.selected);
      el.statCount.textContent = state.visible.length.toLocaleString(I18N.getLang());
      // re-renderiza labels do globo (hex/point) trocando os dados
      renderLayers();
    });
  }

  /* ===================== Bootstrap ======================================= */
  function init() {
    // Aplica traducoes ao HTML estatico assim que o DOM esta pronto.
    I18N.applyDOM(document);
    loadLanguages();

    if (typeof Globe !== "function") {
      showLoading(t("loading.libfail"));
      return;
    }
    if (IS_FILE_PROTOCOL && el.fileBanner) {
      el.fileBanner.classList.remove("hidden");
    }
    readURL();                 // 1) le filtros da URL
    initGlobe();
    bindEvents();
    // medidor de FPS opcional (?fps=1) para calibrar o teto de estacoes
    if (window.RadioFPS && new URLSearchParams(location.search).get("fps") === "1") {
      window.RadioFPS.start();
    }
    syncControlsFromState();   // 2) reflete nos controles
    updateModeBadge();
    // Divisas e nomes de paises/estados (opcional, nao bloqueia o resto).
    if (!IS_FILE_PROTOCOL && window.RadioGeoLayers) {
      window.RadioGeoLayers.init(globe).catch((e) =>
        console.warn("[GlobalRadio3D] camada geografica indisponivel:", e));
    }
    // 3) carrega base regulatoria (opcional) e so entao as estacoes,
    //    para ja aplicar o cruzamento na primeira renderizacao.
    const regReady = window.RadioRegulatory
      ? window.RadioRegulatory.load({ preload: state.country ? [state.country] : ["BR", "US"] }).catch(() => false)
      : Promise.resolve(false);
    loadCountries();
    regReady.then(() => loadStations());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
