/* =========================================================================
 * Radio Globe — globo 3D com radios AM/FM do mundo (estilo Google Earth)
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
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
    "https://fi1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
  ];
  const MAX_STATIONS = 8000;        // teto maior: o hexbin aguenta com LOD
  const REQUEST_TIMEOUT_MS = 12000;
  const CACHE_TTL = (window.RadioCache && window.RadioCache.DEFAULT_TTL_MS) || 6 * 36e5;

  // Acima de quantas estacoes vale a pena usar Web Worker para normalizar.
  const WORKER_THRESHOLD = 1500;

  // file:// quebra o WebGL (texturas tainted) e Web Workers. Detectamos para
  // cair em modos de fallback funcionais.
  const IS_FILE_PROTOCOL = location.protocol === "file:";

  // Altitude da camera abaixo da qual mostramos pontos individuais.
  // Acima dela, mostramos agregacao por hexbin (clustering).
  const LOD_ALTITUDE_THRESHOLD = 0.9;

  const BAND = { ALL: "all", FM: "fm", AM: "am" };
  const COLORS = { fm: "#36d399", am: "#ffb547", net: "#8b93a7" };

  /* ----------------------------- Estado ----------------------------------- */
  const state = {
    band: BAND.ALL,
    country: "",
    search: "",
    allStations: [],
    visible: [],
    selected: null,
    rotating: true,
    mode: "hex",        // "hex" (agregado) | "points" (individual)
    geoVisible: true,   // divisas e nomes de paises/estados
  };

  /* ----------------------------- DOM -------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const el = {
    globe: $("#globeViz"),
    fileBanner: $("#fileBanner"),
    fileBannerClose: $("#fileBannerClose"),
    bandBtns: Array.from(document.querySelectorAll(".band-btn")),
    country: $("#countrySelect"),
    search: $("#searchInput"),
    toggleRotate: $("#toggleRotate"),
    toggleGeo: $("#toggleGeo"),
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
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...opts,
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      });
    } finally {
      clearTimeout(id);
    }
  }

  /** GET com failover entre mirrors + cache (localStorage ou IndexedDB). */
  async function apiGet(path, { cacheKey, ttl = CACHE_TTL, idb = false } = {}) {
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
    let lastErr;
    for (const base of API_MIRRORS) {
      try {
        const res = await fetchWithTimeout(`${base}${path}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cacheKey) {
          if (idb && window.RadioIDB && window.RadioIDB.supported) {
            window.RadioIDB.set(cacheKey, json, ttl); // assincrono, nao aguarda
          } else if (!idb && window.RadioCache) {
            window.RadioCache.set(cacheKey, json, ttl);
          }
        }
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
        console.warn("[RadioGlobe] Worker falhou, usando main thread:", err);
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
    renderLayers();
    el.statCount.textContent = state.visible.length.toLocaleString("pt-BR");
    // expoe contagem para o medidor de FPS
    window.RadioGlobeStats = window.RadioGlobeStats || {};
    window.RadioGlobeStats.visibleCount = state.visible.length;
    syncURL();
  }

  /* ===================== Persistencia de filtros na URL ================== */
  let _suppressURL = false;

  function syncURL() {
    if (_suppressURL) return;
    const params = new URLSearchParams();
    if (state.band !== BAND.ALL) params.set("band", state.band);
    if (state.country) params.set("country", state.country);
    if (state.search.trim()) params.set("q", state.search.trim());
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
  }

  /** Reflete o estado atual nos controles da UI. */
  function syncControlsFromState() {
    el.bandBtns.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.band === state.band));
    if (state.search) el.search.value = state.search;
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
      .pointRadius(0.18)
      .pointColor((d) => COLORS[d.band] || COLORS.net)
      .pointLabel(pointLabelHTML)
      .onPointClick(onStationClick)
      .pointsMerge(false)
      .pointsTransitionDuration(0)
      // ---- camada hexbin (LOD longe / clustering) ----
      .hexBinPointsData([])
      .hexBinPointLat("lat").hexBinPointLng("lng")
      .hexBinPointWeight(1)
      .hexBinResolution(3)
      .hexMargin(0.18)
      .hexAltitude((d) => Math.min(0.6, 0.02 + d.sumWeight * 0.012))
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
    controls.minDistance = 120;

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
    const wantPoints = pov.altitude <= LOD_ALTITUDE_THRESHOLD;
    const newMode = wantPoints ? "points" : "hex";
    if (newMode !== state.mode) {
      state.mode = newMode;
      renderLayers();
      updateModeBadge();
    }
    // LOD das divisas/nomes (paises -> +estados do pais em foco, sob demanda)
    if (state.geoVisible && window.RadioGeoLayers) {
      window.RadioGeoLayers.applyLOD(pov);
    }
  }

  function renderLayers() {
    if (!globe) return;
    if (state.mode === "points") {
      globe.pointsData(state.visible);
      globe.hexBinPointsData([]);
    } else {
      globe.hexBinPointsData(state.visible);
      globe.pointsData([]);
    }
  }

  function updateModeBadge() {
    if (!el.modeBadge) return;
    el.modeBadge.textContent = state.mode === "points" ? "Estacoes" : "Agrupado";
    el.modeBadge.title = state.mode === "points"
      ? "Mostrando estacoes individuais (aproxime para detalhes)"
      : "Mostrando agrupamento por regiao (aproxime para ver estacoes)";
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
        <div style="font-size:13px">${pts.length} estacoes nesta regiao</div>
        <div style="font-weight:400;color:#93a0bd;margin-top:3px">
          <span style="color:${COLORS.fm}">● FM ${fm}</span> &nbsp;
          <span style="color:${COLORS.am}">● AM ${am}</span> &nbsp;
          <span style="color:${COLORS.net}">● outras ${net}</span>
        </div>
        <div style="font-weight:400;color:#6b7896;margin-top:3px;font-size:11px">clique para aproximar</div>
      </div>`;
  }

  function pointLabelHTML(d) {
    const bandTxt = d.band === "net" ? "Internet" : d.band.toUpperCase();
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
    state.selected = station;
    globe.pointOfView({ lat: station.lat, lng: station.lng, altitude: 0.55 }, 900);
    showPanel(station);
  }

  /* ===================== Painel de detalhes ============================== */
  function showPanel(s) {
    el.panel.classList.remove("hidden");
    el.pName.textContent = s.name;
    el.pLocation.textContent = [s.state, s.country].filter(Boolean).join(", ") || "Localizacao nao informada";

    if (s.favicon) {
      el.pFavicon.src = s.favicon;
      el.pFavicon.style.visibility = "visible";
      el.pFavicon.onerror = () => { el.pFavicon.style.visibility = "hidden"; };
    } else {
      el.pFavicon.removeAttribute("src");
      el.pFavicon.style.visibility = "hidden";
    }

    const bandLabel = s.band === "net" ? "Internet / outras" : s.band.toUpperCase();
    el.pBand.textContent = bandLabel;
    el.pBand.style.color = COLORS[s.band] || COLORS.net;
    // selo de verificacao regulatoria
    if (s.bandConfidence === "verified") {
      const tick = document.createElement("span");
      tick.className = "verified-badge";
      tick.title = s.callsign
        ? `Confirmado pela base regulatoria (${s.callsign}, ~${s.regDistanceKm} km)`
        : "Confirmado pela base regulatoria";
      tick.textContent = s.callsign ? `✓ ${s.callsign}` : "✓ verificada";
      el.pBand.appendChild(document.createTextNode(" "));
      el.pBand.appendChild(tick);
    }

    if (s.freq != null) {
      el.pFreq.textContent = `${s.freq} ${s.freqUnit}`;
    } else {
      el.pFreq.textContent = s.bandConfidence === "low" ? "nao informada" : "—";
    }

    el.pCodec.textContent = s.codec || "—";
    el.pBitrate.textContent = s.bitrate ? `${s.bitrate} kbps` : "—";
    el.pLanguage.textContent = s.language || "—";
    el.pVotes.textContent = s.votes.toLocaleString("pt-BR");

    el.pTags.innerHTML = "";
    s.tags.slice(0, 8).forEach((t) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = t;
      el.pTags.appendChild(span);
    });

    if (s.homepage) {
      el.pHomepage.href = s.homepage;
      el.pHomepage.style.display = "inline-block";
    } else {
      el.pHomepage.style.display = "none";
    }

    resetPlayerUI();
  }

  function closePanel() {
    el.panel.classList.add("hidden");
    stopAudio();
    state.selected = null;
  }

  /* ===================== Player de audio (HLS + nativo) ================== */
  let hls = null;

  function isHlsUrl(url) {
    return /\.m3u8(\?|$)/i.test(url);
  }

  function destroyHls() {
    if (hls) {
      try { hls.destroy(); } catch (_) {}
      hls = null;
    }
  }

  function resetPlayerUI() {
    el.playBtn.classList.remove("is-playing", "is-loading");
    el.playBtn.textContent = "▶";
    el.pNowPlaying.textContent = "Pronto para tocar";
  }

  function stopAudio() {
    destroyHls();
    el.audio.pause();
    el.audio.removeAttribute("src");
    try { el.audio.load(); } catch (_) {}
    resetPlayerUI();
  }

  async function togglePlay() {
    const s = state.selected;
    if (!s || !s.url) {
      el.pNowPlaying.textContent = "Stream indisponivel";
      return;
    }
    // ja tocando esta estacao -> pausa
    if (!el.audio.paused && el.audio.dataset.id === s.id) {
      stopAudio();
      return;
    }

    stopAudio();
    el.audio.dataset.id = s.id;
    el.audio.volume = Number(el.volume.value);
    el.playBtn.classList.add("is-loading");
    el.pNowPlaying.textContent = "Conectando...";

    try {
      if (isHlsUrl(s.url)) {
        await playHls(s.url);
      } else {
        el.audio.src = s.url;
        await el.audio.play();
      }
      onPlaySuccess();
    } catch (err) {
      onPlayError();
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
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal && !settled) { destroyHls(); reject(new Error("HLS fatal: " + data.type)); }
      });
      hls.loadSource(url);
      hls.attachMedia(el.audio);
    });
  }

  function onPlaySuccess() {
    el.playBtn.classList.remove("is-loading");
    el.playBtn.classList.add("is-playing");
    el.playBtn.textContent = "⏸";
    el.pNowPlaying.textContent = "Tocando ao vivo";
  }

  function onPlayError() {
    el.playBtn.classList.remove("is-loading", "is-playing");
    el.playBtn.textContent = "▶";
    el.pNowPlaying.textContent = "Falha ao reproduzir (stream offline ou bloqueado)";
    destroyHls();
  }

  /* ===================== Carga de dados ================================== */
  async function loadStations() {
    showLoading(state.country ? "Carregando estacoes do pais..." : "Carregando estacoes...");
    try {
      const cacheKey = `stations:${state.country || "world"}:${MAX_STATIONS}`;
      const raw = await apiGet(buildStationQuery({ countrycode: state.country }), { cacheKey, idb: true });
      state.allStations = await normalizeAsync(raw);
      // Cruzamento opcional com base regulatoria (FCC/Anatel), se disponivel.
      if (window.RadioRegulatory && window.RadioRegulatory.ready) {
        // carrega sob demanda a particao do pais filtrado (se particionado)
        if (state.country && window.RadioRegulatory.loadCountry) {
          await window.RadioRegulatory.loadCountry(state.country).catch(() => {});
        }
        const { confirmed } = window.RadioRegulatory.refine(state.allStations);
        if (confirmed) console.info(`[RadioGlobe] ${confirmed} estacoes confirmadas via base regulatoria.`);
      }
      applyFilters();
      updateModeBadge();
      if (state.allStations.length === 0) {
        el.loadingText.textContent = "Nenhuma estacao geolocalizada encontrada.";
        return;
      }
    } catch (err) {
      el.loadingText.textContent = "Erro ao carregar estacoes. Verifique a conexao e recarregue.";
      console.error("[RadioGlobe] Falha no carregamento:", err);
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
      console.warn("[RadioGlobe] Nao foi possivel carregar a lista de paises:", err);
    }
  }

  function makeCountryOption(c) {
    const opt = document.createElement("option");
    opt.value = c.iso_3166_1;
    opt.textContent = `${c.name} (${c.stationcount})`;
    return opt;
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

    el.search.addEventListener("input", debounce((e) => {
      state.search = e.target.value;
      applyFilters();
    }, 220));

    el.toggleRotate.addEventListener("click", () => {
      state.rotating = !state.rotating;
      globe.controls().autoRotate = state.rotating;
      el.toggleRotate.textContent = state.rotating ? "⏸" : "▶";
    });

    if (el.toggleGeo) {
      el.toggleGeo.addEventListener("click", () => {
        state.geoVisible = !state.geoVisible;
        el.toggleGeo.classList.toggle("is-active", state.geoVisible);
        el.toggleGeo.setAttribute("aria-pressed", String(state.geoVisible));
        if (window.RadioGeoLayers) window.RadioGeoLayers.setVisible(state.geoVisible);
      });
    }

    el.panelClose.addEventListener("click", closePanel);
    el.playBtn.addEventListener("click", togglePlay);
    el.volume.addEventListener("input", () => { el.audio.volume = Number(el.volume.value); });

    if (el.fileBannerClose) {
      el.fileBannerClose.addEventListener("click", () => el.fileBanner.classList.add("hidden"));
    }

    el.audio.addEventListener("ended", resetPlayerUI);
    el.audio.addEventListener("error", () => {
      if (el.audio.getAttribute("src")) onPlayError();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
      if (e.key === " " && state.selected && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        togglePlay();
      }
    });

    el.globe.addEventListener("pointerdown", () => {
      if (state.rotating) globe.controls().autoRotate = false;
    });
    el.globe.addEventListener("pointerup", () => {
      if (state.rotating) globe.controls().autoRotate = true;
    });
  }

  /* ===================== Bootstrap ======================================= */
  function init() {
    if (typeof Globe !== "function") {
      showLoading("Falha ao carregar a biblioteca do globo. Verifique os arquivos em vendor/.");
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
        console.warn("[RadioGlobe] camada geografica indisponivel:", e));
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
