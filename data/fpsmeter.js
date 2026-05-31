/* =========================================================================
 * fpsmeter.js — Medidor de FPS do loop de animacao (requestAnimationFrame).
 *
 * Util para validar, no hardware real, ate quantas estacoes/poligonos o globo
 * sustenta com fluidez antes de subir o teto (MAX_STATIONS). Mostra um overlay
 * discreto com FPS instantaneo e media movel, e expoe window.__fps p/ testes.
 *
 * Ativacao:
 *   - parametro de URL ?fps=1, ou
 *   - RadioFPS.start() manualmente.
 * ========================================================================= */

(function (global) {
  "use strict";

  const STATE = { running: false, raf: 0, el: null, last: 0, frames: 0,
                  acc: 0, fps: 0, avg: 0, samples: [] };

  function ensureOverlay() {
    if (STATE.el) return STATE.el;
    const el = document.createElement("div");
    el.id = "fpsMeter";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      "position:fixed", "left:18px", "top:84px", "z-index:40",
      "font:600 12px/1.4 'Segoe UI',monospace", "color:#cfe2ff",
      "background:rgba(15,20,35,.9)", "border:1px solid rgba(120,160,255,.3)",
      "padding:6px 10px", "border-radius:8px", "pointer-events:none",
      "backdrop-filter:blur(8px)", "white-space:pre",
    ].join(";");
    document.body.appendChild(el);
    STATE.el = el;
    return el;
  }

  function tick(now) {
    if (!STATE.running) return;
    if (STATE.last) {
      const dt = now - STATE.last;
      STATE.acc += dt;
      STATE.frames++;
      if (STATE.acc >= 500) {            // atualiza 2x/s
        STATE.fps = Math.round((STATE.frames * 1000) / STATE.acc);
        STATE.samples.push(STATE.fps);
        if (STATE.samples.length > 20) STATE.samples.shift();
        STATE.avg = Math.round(STATE.samples.reduce((a, b) => a + b, 0) / STATE.samples.length);
        STATE.frames = 0; STATE.acc = 0;
        render();
      }
    }
    STATE.last = now;
    STATE.raf = requestAnimationFrame(tick);
  }

  function render() {
    if (!STATE.el) return;
    const color = STATE.fps >= 50 ? "#36d399" : STATE.fps >= 30 ? "#ffb547" : "#ff6b6b";
    const n = (global.RadioGlobeStats && global.RadioGlobeStats.visibleCount) || 0;
    STATE.el.style.color = color;
    STATE.el.textContent = `FPS ${STATE.fps}  (avg ${STATE.avg})\n${n.toLocaleString("pt-BR")} pts`;
  }

  function start() {
    if (STATE.running) return;
    STATE.running = true;
    STATE.last = 0; STATE.frames = 0; STATE.acc = 0; STATE.samples = [];
    ensureOverlay();
    STATE.raf = requestAnimationFrame(tick);
  }

  function stop() {
    STATE.running = false;
    if (STATE.raf) cancelAnimationFrame(STATE.raf);
    if (STATE.el) { STATE.el.remove(); STATE.el = null; }
  }

  global.RadioFPS = {
    start, stop,
    get fps() { return STATE.fps; },
    get avg() { return STATE.avg; },
    get running() { return STATE.running; },
  };
  // expoe leitura simples p/ testes headless
  Object.defineProperty(global, "__fps", { get: () => STATE.fps });
})(window);
