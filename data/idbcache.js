/* =========================================================================
 * idbcache.js — Cache de grande volume em IndexedDB (com TTL).
 *
 * Por que IndexedDB e nao localStorage:
 *   localStorage tem ~5 MB e e sincrono (trava a UI). Para cachear o catalogo
 *   paginado (dezenas de milhares de estacoes, varios MB), usamos IndexedDB,
 *   que e assincrono e suporta centenas de MB.
 *
 * API (Promise-based):
 *   RadioIDB.get(key)            -> valor | null (expirado/ausente)
 *   RadioIDB.set(key, val, ttl)  -> boolean
 *   RadioIDB.remove(key), clear()
 *
 * Degrada com graca: se IndexedDB nao existir (ou modo privado), as funcoes
 * resolvem para null/false sem quebrar o app.
 * ========================================================================= */

(function (global) {
  "use strict";

  const DB_NAME = "global-radio-3d";
  const STORE = "kv";
  const DB_VERSION = 1;
  const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

  const SUPPORTED = typeof indexedDB !== "undefined";
  let dbPromise = null;

  function openDB() {
    if (!SUPPORTED) return Promise.reject(new Error("IndexedDB indisponivel"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB bloqueado"));
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("tx abortada"));
    }));
  }

  function get(key) {
    if (!SUPPORTED) return Promise.resolve(null);
    return openDB().then((db) => new Promise((resolve) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || typeof entry.exp !== "number") { resolve(null); return; }
        if (Date.now() > entry.exp) { remove(key); resolve(null); return; }
        resolve(entry.val);
      };
      req.onerror = () => resolve(null);
    })).catch(() => null);
  }

  function set(key, val, ttlMs = DEFAULT_TTL_MS) {
    if (!SUPPORTED) return Promise.resolve(false);
    const entry = { val, exp: Date.now() + ttlMs, ts: Date.now() };
    return tx("readwrite", (store) => store.put(entry, key))
      .then(() => true)
      .catch(() => false);
  }

  function remove(key) {
    if (!SUPPORTED) return Promise.resolve(false);
    return tx("readwrite", (store) => store.delete(key))
      .then(() => true).catch(() => false);
  }

  function clear() {
    if (!SUPPORTED) return Promise.resolve(false);
    return tx("readwrite", (store) => store.clear())
      .then(() => true).catch(() => false);
  }

  global.RadioIDB = { get, set, remove, clear, supported: SUPPORTED, DEFAULT_TTL_MS };
})(window);
