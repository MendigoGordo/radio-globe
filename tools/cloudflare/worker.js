/* =========================================================================
 * Radio Globe — Cloudflare Worker (proxy + cache na borda do Radio Browser)
 *
 * Por que existe:
 *   A API publica do Radio Browser e lenta para devolver o catalogo completo
 *   (~14 MB, 28-40 s). Este Worker fica na frente dela: baixa UMA vez, guarda
 *   no cache da borda do Cloudflare e, a partir dai, serve a resposta a todos
 *   os usuarios de um data center proximo — em milissegundos. Tambem resolve
 *   CORS e faz failover entre os mirrors.
 *
 * O que ele faz:
 *   - Encaminha qualquer caminho /json/... para um mirror do Radio Browser.
 *   - Cacheia respostas GET no Cache API do edge (TTL configuravel por rota).
 *   - Adiciona cabecalhos CORS (libera o uso pelo site).
 *   - Faz failover: se um mirror falha/expira, tenta o proximo.
 *
 * Deploy: veja tools/cloudflare/README.md (resumo: `npx wrangler deploy`).
 * ========================================================================= */

const MIRRORS = [
  "https://all.api.radio-browser.info",
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
];

// TTL de cache por rota (segundos). O catalogo muda devagar; 1 h e seguro.
const TTL = {
  stations: 60 * 60,     // /json/stations/...
  countries: 24 * 60 * 60,
  stats: 60 * 60,
  default: 30 * 60,
};

// Timeout por tentativa de mirror (ms).
const UPSTREAM_TIMEOUT_MS = 45000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function ttlFor(pathname) {
  if (pathname.includes("/stations")) return TTL.stations;
  if (pathname.includes("/countries")) return TTL.countries;
  if (pathname.includes("/stats")) return TTL.stats;
  return TTL.default;
}

async function fetchMirror(base, path, search) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}${search}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "radio-globe-worker/1.0" },
      cf: { cacheEverything: false },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(id);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight CORS.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    // Healthcheck simples.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "radio-globe-worker" }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // So encaminhamos as rotas JSON da API.
    if (!url.pathname.startsWith("/json/")) {
      return new Response("Not Found", { status: 404, headers: CORS });
    }

    // 1) tenta o cache da borda
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const r = new Response(cached.body, cached);
      r.headers.set("X-RG-Cache", "HIT");
      return r;
    }

    // 2) busca no upstream com failover entre mirrors
    let lastErr;
    for (const base of MIRRORS) {
      try {
        const upstream = await fetchMirror(base, url.pathname, url.search);
        const body = await upstream.arrayBuffer();
        const ttl = ttlFor(url.pathname);
        const res = new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, max-age=${ttl}`,
            "X-RG-Cache": "MISS",
            "X-RG-Upstream": base,
            ...CORS,
          },
        });
        // grava no cache da borda em background (nao bloqueia a resposta)
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (err) {
        lastErr = err;
      }
    }

    return new Response(
      JSON.stringify({ error: "Todos os mirrors falharam", detail: String(lastErr && lastErr.message || lastErr) }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
    );
  },
};
