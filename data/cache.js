/* =========================================================================
 * cache.js — Cache de respostas da API em localStorage com TTL.
 *
 * Acelera recargas e reduz chamadas aos mirrors do Radio Browser.
 * Robusto a: localStorage indisponivel (modo privado/quota), JSON corrompido,
 * e estouro de quota (faz limpeza das entradas mais antigas).
 * ========================================================================= */

(function (global) {
  "use strict";

  const PREFIX = "rg:";          // namespace das chaves
  const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

  function available() {
    try {
      const k = "__rg_test__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (_) {
      return false;
    }
  }

  const ENABLED = available();

  function makeKey(key) { return PREFIX + key; }

  /** Le do cache. Retorna o valor ou null (expirado/ausente/corrompido). */
  function get(key) {
    if (!ENABLED) return null;
    let raw;
    try {
      raw = localStorage.getItem(makeKey(key));
    } catch (_) { return null; }
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.exp !== "number") return null;
      if (Date.now() > entry.exp) {
        remove(key);
        return null;
      }
      return entry.val;
    } catch (_) {
      remove(key);
      return null;
    }
  }

  /** Grava no cache com TTL. Em caso de quota cheia, limpa antigos e tenta 1x. */
  function set(key, val, ttlMs = DEFAULT_TTL_MS) {
    if (!ENABLED) return false;
    const entry = JSON.stringify({ val, exp: Date.now() + ttlMs, ts: Date.now() });
    try {
      localStorage.setItem(makeKey(key), entry);
      return true;
    } catch (_) {
      evictOldest(8);
      try {
        localStorage.setItem(makeKey(key), entry);
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function remove(key) {
    try { localStorage.removeItem(makeKey(key)); } catch (_) {}
  }

  /** Remove as N entradas mais antigas do namespace (por timestamp). */
  function evictOldest(n) {
    if (!ENABLED) return;
    const entries = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) {
          let ts = 0;
          try { ts = JSON.parse(localStorage.getItem(k)).ts || 0; } catch (_) {}
          entries.push({ k, ts });
        }
      }
    } catch (_) { return; }
    entries.sort((a, b) => a.ts - b.ts);
    entries.slice(0, n).forEach((e) => {
      try { localStorage.removeItem(e.k); } catch (_) {}
    });
  }

  /** Limpa todo o cache do app. */
  function clear() {
    if (!ENABLED) return;
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  }

  global.RadioCache = { get, set, remove, clear, enabled: ENABLED, DEFAULT_TTL_MS };
})(window);
