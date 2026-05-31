#!/usr/bin/env node
/* Servidor HTTP estatico minimo (sem dependencias) para servir o app.
 * Uso: node tools/serve.mjs [porta]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8777;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
    let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.join(ROOT, rel);

    // impede path traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end("Not found"); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Service-Worker-Allowed": "/",
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`Radio Globe em http://localhost:${PORT}  (Ctrl+C para parar)`);
});
