/* =========================================================================
 * i18n.js — Internacionalizacao (PT-BR / EN / ES).
 *
 * O Global Radio 3D e uma experiencia de curiosidade ("trivia"): explorar as
 * radios AM/FM do planeta. Para alcance global, toda a interface e traduzivel.
 *
 * Como funciona:
 *   - Deteccao de idioma: ?lang= na URL  ->  localStorage  ->  navigator.language
 *     ->  fallback "pt-BR".
 *   - Strings estaticas no HTML usam atributos:
 *       data-i18n="chave"                  -> define textContent
 *       data-i18n-html="chave"             -> define innerHTML (conteudo proprio/confiavel)
 *       data-i18n-attr="placeholder:chave;title:chave2;aria-label:chave3"
 *   - Strings dinamicas (app.js) usam RadioI18n.t("chave", { params }).
 *   - Interpolacao: "{n} estacoes" + t(key, { n: 5 }).
 *
 * Degrada com graca: se o dicionario nao tiver a chave, devolve a propria chave
 * (ou o fallback PT-BR), nunca quebra.
 * ========================================================================= */

(function (global) {
  "use strict";

  const STORAGE_KEY = "rg:lang";
  const DEFAULT_LANG = "en";

  // Idiomas suportados (rotulos exibidos no seletor).
  const LANGS = [
    { code: "pt-BR", label: "Português" },
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
  ];

  const DICT = {
    "pt-BR": {
      "html.lang": "pt-BR",
      "recent": "Recentes",
      "random": "Surpreenda-me",
      "install": "Instalar app",
      "fav.filter": "Favoritas",
      "fav.add": "Favoritar",
      "share": "Compartilhar",
      "brand.tagline": "Rádios AM / FM ao redor do planeta",
      "band.all": "Todas",
      "band.fm": "FM",
      "band.am": "AM",
      "band.net.full": "Internet / outras",
      "band.net.short": "Internet",
      "country.top": "🌍 Top mundial",
      "search.placeholder": "Buscar estação ou tag...",
      "search.aria": "Buscar estação",
      "sort.aria": "Ordenar estações",
      "sort.relevance": "Mais ouvidas",
      "sort.votes": "Mais votadas",
      "sort.name": "Nome (A–Z)",
      "sort.band": "Banda (FM/AM)",
      "lang.aria": "Idioma",
      "toggle.geo": "Divisas e nomes",
      "toggle.rotate.pause": "Pausar rotação",
      "toggle.rotate.play": "Retomar rotação",
      "toggle.list.open": "Mostrar lista de estações",
      "toggle.list.close": "Ocultar lista de estações",
      "stats.stations": "estações",
      "mode.grouped": "Agrupado",
      "mode.stations": "Estações",
      "mode.grouped.title": "Mostrando agrupamento por região (aproxime para ver estações)",
      "mode.stations.title": "Mostrando estações individuais (aproxime para detalhes)",
      "loading.stations": "Carregando estações...",
      "loading.country": "Carregando estações do país...",
      "loading.none": "Nenhuma estação geolocalizada encontrada.",
      "loading.error": "Erro ao carregar estações. Verifique a conexão e recarregue.",
      "loading.libfail": "Falha ao carregar a biblioteca do globo. Verifique os arquivos em vendor/.",
      "list.title": "Estações",
      "list.empty": "Nenhuma estação para os filtros atuais.",
      "list.more": "+ {n} mais — refine a busca ou os filtros",
      "list.hint": "Use ↑ ↓ para navegar e Enter para explorar",
      "panel.band": "Banda",
      "panel.freq": "Frequência",
      "panel.codec": "Codec",
      "panel.bitrate": "Bitrate",
      "panel.language": "Idioma",
      "panel.votes": "Votos",
      "panel.close": "Fechar",
      "panel.homepage": "Site oficial ↗",
      "location.unknown": "Localização não informada",
      "location.approx": "Local aproximado (país)",
      "freq.notinformed": "não informada",
      "verified.callsign": "Confirmado pela base regulatória ({callsign}, ~{km} km)",
      "verified.generic": "Confirmado pela base regulatória",
      "verified.badge": "✓ verificada",
      "player.play": "Tocar",
      "player.pause": "Pausar",
      "player.ready": "Pronto para tocar",
      "player.connecting": "Conectando...",
      "player.buffering": "Carregando buffer...",
      "player.live": "Tocando ao vivo",
      "player.nowplaying": "♪ {title}",
      "player.error": "Falha ao reproduzir (stream offline ou bloqueado)",
      "player.unavailable": "Stream indisponível",
      "player.reconnecting": "Reconectando... ({n})",
      "player.gaveup": "Sem sinal — stream indisponível no momento",
      "volume.aria": "Volume",
      "legend.fm": "FM",
      "legend.am": "AM",
      "legend.net": "Internet / outras",
      "credits.data": "Dados:",
      "credits.globe": "Globo:",
      "hex.region": "{n} estações nesta região",
      "hex.zoom": "clique para aproximar",
      "filebanner.html":
        "<strong>Aviso:</strong> a página foi aberta via <code>file://</code>. O WebGL não consegue " +
        "carregar as texturas do globo nesse modo (bloqueio de segurança do navegador), então um globo " +
        "simplificado será exibido. Para a experiência completa, sirva por HTTP — execute " +
        "<code>servir.bat</code> (ou <code>python -m http.server 8777</code>) nesta pasta e acesse " +
        "<code>http://localhost:8777</code>.",
      "filebanner.close": "Fechar aviso",
    },

    "en": {
      "html.lang": "en",
      "recent": "Recently played",
      "random": "Surprise me",
      "install": "Install app",
      "fav.filter": "Favorites",
      "fav.add": "Add to favorites",
      "share": "Share",
      "brand.tagline": "AM / FM radios around the planet",
      "band.all": "All",
      "band.fm": "FM",
      "band.am": "AM",
      "band.net.full": "Internet / other",
      "band.net.short": "Internet",
      "country.top": "🌍 Top worldwide",
      "search.placeholder": "Search station or tag...",
      "search.aria": "Search station",
      "sort.aria": "Sort stations",
      "sort.relevance": "Most listened",
      "sort.votes": "Most voted",
      "sort.name": "Name (A–Z)",
      "sort.band": "Band (FM/AM)",
      "lang.aria": "Language",
      "toggle.geo": "Borders and names",
      "toggle.rotate.pause": "Pause rotation",
      "toggle.rotate.play": "Resume rotation",
      "toggle.list.open": "Show station list",
      "toggle.list.close": "Hide station list",
      "stats.stations": "stations",
      "mode.grouped": "Grouped",
      "mode.stations": "Stations",
      "mode.grouped.title": "Showing regional grouping (zoom in to see stations)",
      "mode.stations.title": "Showing individual stations (zoom in for details)",
      "loading.stations": "Loading stations...",
      "loading.country": "Loading stations for the country...",
      "loading.none": "No geolocated stations found.",
      "loading.error": "Failed to load stations. Check your connection and reload.",
      "loading.libfail": "Failed to load the globe library. Check the files in vendor/.",
      "list.title": "Stations",
      "list.empty": "No stations for the current filters.",
      "list.more": "+ {n} more — refine your search or filters",
      "list.hint": "Use ↑ ↓ to navigate and Enter to explore",
      "panel.band": "Band",
      "panel.freq": "Frequency",
      "panel.codec": "Codec",
      "panel.bitrate": "Bitrate",
      "panel.language": "Language",
      "panel.votes": "Votes",
      "panel.close": "Close",
      "panel.homepage": "Official site ↗",
      "location.unknown": "Location not provided",
      "location.approx": "Approximate location (country)",
      "freq.notinformed": "not provided",
      "verified.callsign": "Confirmed by the regulatory database ({callsign}, ~{km} km)",
      "verified.generic": "Confirmed by the regulatory database",
      "verified.badge": "✓ verified",
      "player.play": "Play",
      "player.pause": "Pause",
      "player.ready": "Ready to play",
      "player.connecting": "Connecting...",
      "player.buffering": "Buffering...",
      "player.live": "Playing live",
      "player.nowplaying": "♪ {title}",
      "player.error": "Playback failed (stream offline or blocked)",
      "player.unavailable": "Stream unavailable",
      "player.reconnecting": "Reconnecting... ({n})",
      "player.gaveup": "No signal — stream unavailable right now",
      "volume.aria": "Volume",
      "legend.fm": "FM",
      "legend.am": "AM",
      "legend.net": "Internet / other",
      "credits.data": "Data:",
      "credits.globe": "Globe:",
      "hex.region": "{n} stations in this region",
      "hex.zoom": "click to zoom in",
      "filebanner.html":
        "<strong>Notice:</strong> the page was opened via <code>file://</code>. WebGL cannot " +
        "load the globe textures in this mode (browser security restriction), so a simplified globe " +
        "will be shown. For the full experience, serve over HTTP — run " +
        "<code>servir.bat</code> (or <code>python -m http.server 8777</code>) in this folder and open " +
        "<code>http://localhost:8777</code>.",
      "filebanner.close": "Close notice",
    },

    "es": {
      "html.lang": "es",
      "recent": "Recientes",
      "random": "Sorpréndeme",
      "install": "Instalar app",
      "fav.filter": "Favoritas",
      "fav.add": "Favorita",
      "share": "Compartir",
      "brand.tagline": "Radios AM / FM alrededor del planeta",
      "band.all": "Todas",
      "band.fm": "FM",
      "band.am": "AM",
      "band.net.full": "Internet / otras",
      "band.net.short": "Internet",
      "country.top": "🌍 Top mundial",
      "search.placeholder": "Buscar estación o etiqueta...",
      "search.aria": "Buscar estación",
      "sort.aria": "Ordenar estaciones",
      "sort.relevance": "Más escuchadas",
      "sort.votes": "Más votadas",
      "sort.name": "Nombre (A–Z)",
      "sort.band": "Banda (FM/AM)",
      "lang.aria": "Idioma",
      "toggle.geo": "Fronteras y nombres",
      "toggle.rotate.pause": "Pausar rotación",
      "toggle.rotate.play": "Reanudar rotación",
      "toggle.list.open": "Mostrar lista de estaciones",
      "toggle.list.close": "Ocultar lista de estaciones",
      "stats.stations": "estaciones",
      "mode.grouped": "Agrupado",
      "mode.stations": "Estaciones",
      "mode.grouped.title": "Mostrando agrupación por región (acércate para ver estaciones)",
      "mode.stations.title": "Mostrando estaciones individuales (acércate para más detalles)",
      "loading.stations": "Cargando estaciones...",
      "loading.country": "Cargando estaciones del país...",
      "loading.none": "No se encontraron estaciones geolocalizadas.",
      "loading.error": "Error al cargar estaciones. Verifica la conexión y recarga.",
      "loading.libfail": "No se pudo cargar la biblioteca del globo. Revisa los archivos en vendor/.",
      "list.title": "Estaciones",
      "list.empty": "No hay estaciones para los filtros actuales.",
      "list.more": "+ {n} más — refina la búsqueda o los filtros",
      "list.hint": "Usa ↑ ↓ para navegar y Enter para explorar",
      "panel.band": "Banda",
      "panel.freq": "Frecuencia",
      "panel.codec": "Códec",
      "panel.bitrate": "Bitrate",
      "panel.language": "Idioma",
      "panel.votes": "Votos",
      "panel.close": "Cerrar",
      "panel.homepage": "Sitio oficial ↗",
      "location.unknown": "Ubicación no informada",
      "location.approx": "Ubicación aproximada (país)",
      "freq.notinformed": "no informada",
      "verified.callsign": "Confirmado por la base regulatoria ({callsign}, ~{km} km)",
      "verified.generic": "Confirmado por la base regulatoria",
      "verified.badge": "✓ verificada",
      "player.play": "Reproducir",
      "player.pause": "Pausar",
      "player.ready": "Listo para reproducir",
      "player.connecting": "Conectando...",
      "player.buffering": "Almacenando en búfer...",
      "player.live": "Reproduciendo en vivo",
      "player.nowplaying": "♪ {title}",
      "player.error": "Error al reproducir (stream offline o bloqueado)",
      "player.unavailable": "Stream no disponible",
      "player.reconnecting": "Reconectando... ({n})",
      "player.gaveup": "Sin señal — stream no disponible por ahora",
      "volume.aria": "Volumen",
      "legend.fm": "FM",
      "legend.am": "AM",
      "legend.net": "Internet / otras",
      "credits.data": "Datos:",
      "credits.globe": "Globo:",
      "hex.region": "{n} estaciones en esta región",
      "hex.zoom": "haz clic para acercar",
      "filebanner.html":
        "<strong>Aviso:</strong> la página se abrió vía <code>file://</code>. WebGL no puede " +
        "cargar las texturas del globo en este modo (restricción de seguridad del navegador), por lo que " +
        "se mostrará un globo simplificado. Para la experiencia completa, sirve por HTTP — ejecuta " +
        "<code>servir.bat</code> (o <code>python -m http.server 8777</code>) en esta carpeta y abre " +
        "<code>http://localhost:8777</code>.",
      "filebanner.close": "Cerrar aviso",
    },
  };

  const listeners = new Set();
  let current = DEFAULT_LANG;

  function normalize(lang) {
    if (!lang) return null;
    if (DICT[lang]) return lang;
    const base = String(lang).toLowerCase();
    if (base.startsWith("pt")) return "pt-BR";
    if (base.startsWith("en")) return "en";
    if (base.startsWith("es")) return "es";
    return null;
  }

  function detect() {
    try {
      const fromUrl = new URLSearchParams(location.search).get("lang");
      const u = normalize(fromUrl);
      if (u) return u;
    } catch (_) {}
    try {
      const stored = normalize(localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch (_) {}
    try {
      const navs = navigator.languages || [navigator.language];
      for (const n of navs) { const c = normalize(n); if (c) return c; }
    } catch (_) {}
    return DEFAULT_LANG;
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) =>
      (params[k] != null ? String(params[k]) : m));
  }

  /** Traduz uma chave. Cai para PT-BR e depois para a propria chave. */
  function t(key, params) {
    const table = DICT[current] || DICT[DEFAULT_LANG];
    let str = table[key];
    if (str == null) str = DICT[DEFAULT_LANG][key];
    if (str == null) return key;
    return interpolate(str, params);
  }

  function getLang() { return current; }
  function langs() { return LANGS.slice(); }

  /** Aplica traducoes aos elementos marcados em uma subarvore. */
  function applyDOM(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach((node) => {
      node.innerHTML = t(node.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach((node) => {
      const spec = node.getAttribute("data-i18n-attr");
      spec.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s && s.trim());
        if (attr && key) node.setAttribute(attr, t(key));
      });
    });
    document.documentElement.setAttribute("lang", t("html.lang"));
  }

  function setLang(lang) {
    const c = normalize(lang) || DEFAULT_LANG;
    if (c === current) return;
    current = c;
    try { localStorage.setItem(STORAGE_KEY, c); } catch (_) {}
    applyDOM(document);
    listeners.forEach((fn) => { try { fn(c); } catch (_) {} });
  }

  /** Registra um callback para re-renderizar strings dinamicas ao trocar idioma. */
  function onChange(fn) { if (typeof fn === "function") listeners.add(fn); }

  current = detect();
  try { localStorage.setItem(STORAGE_KEY, current); } catch (_) {}

  global.RadioI18n = { t, setLang, getLang, langs, applyDOM, onChange, DEFAULT_LANG };
})(typeof self !== "undefined" ? self : this);
