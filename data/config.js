/* =========================================================================
 * config.js — Configuracao do app definida em tempo de deploy (sem build).
 *
 * API_PROXY: URL de um proxy/cache na borda (Cloudflare Worker) que fica na
 * frente da API do Radio Browser. Quando definido, o app o usa ANTES dos
 * mirrors publicos — o Worker cacheia a resposta pesada (~14 MB) no edge e
 * serve rapido a todos os usuarios, alem de resolver CORS.
 *
 * Como ativar:
 *   1) Faca o deploy do Worker em tools/cloudflare/ (veja o README de la).
 *   2) Cole a URL publica do Worker abaixo, ex.:
 *        window.GLOBAL_RADIO_3D_API_PROXY = "https://global-radio-3d-api.SEU.workers.dev";
 *
 * Deixe string vazia para usar apenas os mirrors publicos (comportamento padrao).
 * ========================================================================= */

// Nao sobrescreve se ja definido (ex.: por um script anterior ou ?apiProxy=).
window.GLOBAL_RADIO_3D_API_PROXY = window.GLOBAL_RADIO_3D_API_PROXY || "";
