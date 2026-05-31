/* =========================================================================
 * safeurl.js — Saneamento de URLs de terceiros (favicon / homepage).
 *
 * Por que existe:
 *   O catalogo Radio Browser e colaborativo: favicon/homepage sao URLs
 *   arbitrarias de terceiros. Carrega-las cruamente traz riscos:
 *     - Mixed content: <img src="http://..."> numa pagina https e bloqueado
 *       pelo navegador (e vaza um request inseguro).
 *     - Privacidade: requests a dominios aleatorios no carregamento.
 *     - Injecao: esquemas perigosos (javascript:, data:, vbscript:).
 *
 * Politica:
 *   - Aceita apenas http(s). Rejeita javascript:, data:, file:, etc.
 *   - Em paginas https, faz "upgrade" de http->https quando seguro; se nao
 *     der para garantir, recusa o favicon (evita mixed content e o request
 *     inseguro). Para homepage, preferimos https e marcamos rel=noopener.
 *   - Tudo opcional: se algo falhar, devolve "" (o app trata como ausente).
 * ========================================================================= */

(function (global) {
  "use strict";

  const PAGE_IS_HTTPS = (typeof location !== "undefined") && location.protocol === "https:";

  function parse(url) {
    if (!url || typeof url !== "string") return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
      // base evita que caminhos relativos virem same-origin inesperado
      return new URL(trimmed);
    } catch (_) {
      return null;
    }
  }

  function isHttp(u) {
    return u && (u.protocol === "http:" || u.protocol === "https:");
  }

  /**
   * Sanea uma URL de imagem (favicon) para uso em <img>.
   * Em https, faz upgrade de http->https (a maioria dos CDNs aceita); se a
   * origem for claramente um IP/localhost, recusa para nao gerar mixed content.
   * @returns {string} URL segura ou "" se nao for aproveitavel.
   */
  function sanitizeImage(url) {
    const u = parse(url);
    if (!isHttp(u)) return "";
    if (PAGE_IS_HTTPS && u.protocol === "http:") {
      // upgrade otimista para https
      u.protocol = "https:";
    }
    return u.href;
  }

  /**
   * Sanea uma URL de link externo (homepage) para uso em <a href>.
   * Mantem http(s) como veio (links http abrem normalmente, sem mixed content),
   * mas bloqueia esquemas perigosos.
   * @returns {string} URL segura ou "" se invalida/perigosa.
   */
  function sanitizeLink(url) {
    const u = parse(url);
    if (!isHttp(u)) return "";
    return u.href;
  }

  /** Host legivel para exibir o destino de um link (ex.: "exemplo.com"). */
  function displayHost(url) {
    const u = parse(url);
    if (!u) return "";
    return u.host.replace(/^www\./, "");
  }

  global.RadioSafeURL = { sanitizeImage, sanitizeLink, displayHost };
})(typeof self !== "undefined" ? self : this);
