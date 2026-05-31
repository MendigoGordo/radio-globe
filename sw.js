/* =========================================================================
 * sw.js — Service Worker (PWA): cache offline dos assets estaticos.
 *
 * Estrategia:
 *   - App shell (HTML/CSS/JS/vendor/texturas/geojson de paises): cache-first
 *     com atualizacao em background (stale-while-revalidate).
 *   - Particoes sob demanda (data/regulatory/<CC>.json e
 *     assets/geo/states/<CC>.geojson): cacheadas AUTOMATICAMENTE no primeiro
 *     acesso pelo handler same-origin (stale-while-revalidate).
 *   - API do Radio Browser e streams de audio: NUNCA cacheados aqui.
 *
 * Versionamento por hash: CACHE_VERSION e substituido por tools/stamp-sw.mjs
 * (hash do conteudo do shell), invalidando o cache antigo de forma limpa.
 * ========================================================================= */

// __CACHE_VERSION__ e substituido por tools/stamp-sw.mjs no deploy.
const CACHE_VERSION = "982180e2e974";
const CACHE_NAME = `radio-globe-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "data/cache.js",
  "data/idbcache.js",
  "data/bandplan.js",
  "data/regulatory.js",
  "data/geolayers.js",
  "data/fpsmeter.js",
  "data/normalize.worker.js",
  "vendor/globe.gl.min.js",
  "vendor/hls.min.js",
  "assets/earth-blue-marble.jpg",
  "assets/earth-topology.png",
  "assets/night-sky.png",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/geo/countries.geojson",
  "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll falha tudo se um item falhar; usamos add individual tolerante.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isApiOrStream(url) {
  return /radio-browser\.info/.test(url.hostname)   // API
    || url.pathname.endsWith(".m3u8")               // HLS
    || /audio|stream|icecast|shoutcast/i.test(url.hostname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Nao intercepta API nem streams: deixa a rede + cache de app cuidarem.
  if (isApiOrStream(url)) return;

  // So lida com same-origin (nosso app shell).
  if (url.origin !== self.location.origin) return;

  // stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
