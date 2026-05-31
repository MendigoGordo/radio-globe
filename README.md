# Global Radio 3D

Globo 3D interativo (estilo Google Earth) que mostra rádios AM/FM do mundo todo,
com player ao vivo, divisas e nomes de países/estados, e classificação de banda
por plano de frequência. Site: **globalradio3d.com**.

- **Dados:** [Radio Browser](https://www.radio-browser.info) (estações) e
  [Natural Earth](https://www.naturalearthdata.com) (fronteiras, domínio público).
- **Render:** [globe.gl](https://globe.gl) (Three.js / WebGL).

## Rodar localmente

O WebGL **não** carrega texturas via `file://` — é preciso servir por HTTP.

```bash
# Windows: duplo-clique em servir.bat, ou:
npm run serve        # http://localhost:8777
# alternativa sem Node: python -m http.server 8777
```

Abra `http://localhost:8777`. Parâmetros úteis: `?fps=1` mostra o medidor de FPS,
`?band=fm&country=BR&q=jazz&sort=votes&lang=en` restaura filtros, ordenação e idioma.

## Continuar em outra máquina

```bash
git clone https://github.com/MendigoGordo/radio-globe.git
cd radio-globe
node tools/setup.mjs     # instala deps, browser de teste e baixa insumos de build
```

O `node_modules/` e o GeoJSON bruto de 40 MB **não** estão no repositório (são
regeneráveis). O `setup.mjs` cuida de tudo. Para rodar só o site, nem é preciso:
as partições de fronteiras já estão versionadas em `assets/geo/`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run serve` | Sobe o servidor estático local (porta 8777). |
| `npm test` | Testes headless (Playwright + Chromium). |
| `npm run test:install` | Baixa o Chromium do Playwright. |
| `npm run build:states` | Reparticiona estados por país (precisa do `tools/_states10m.geojson`). |
| `npm run build:regulatory` | Gera a base regulatória AM/FM a partir de CSV oficial. |
| `npm run build:icons` | Gera os ícones PNG do PWA a partir do SVG. |
| `npm run stamp:sw` | Carimba o Service Worker com hash de versão (antes de publicar). |

## Estrutura

```
index.html, style.css, app.js     # app
data/                             # módulos: i18n, safeurl, cache, idbcache,
                                  #   bandplan, regulatory, geolayers, fpsmeter, worker
assets/                           # texturas, ícones, geo/ (fronteiras)
tools/                            # pipelines de build + servidor estático
tests/                            # specs Playwright
sw.js, manifest.webmanifest       # PWA
```

## Funcionalidades

- Globo WebGL com texturas locais e fallback colorido em `file://`.
- Estações do Radio Browser com failover de mirrors e cache (localStorage + IndexedDB).
- Classificação AM/FM por plano de frequência (FCC/Anatel/ITU) + cruzamento
  regulatório opcional por proximidade.
- Clustering hexbin com nível de detalhe (LOD) e player HLS (hls.js).
- Fronteiras e nomes de países (110m) + estados 10m particionados por país, sob demanda.
- **Lista de estações acessível**: painel lateral navegável por teclado
  (↑ ↓ Home End Enter) e otimizado para toque no mobile — alternativa ao clique
  no globo. Botão ☰ na barra superior.
- **Ordenação**: mais ouvidas, mais votadas, nome (A–Z) ou banda (FM/AM).
- **Internacionalização (i18n)**: Português, English e Español. Detecta o idioma
  por `?lang=`, `localStorage` ou navegador; persiste na URL.
- **Player robusto**: estados reais de buffering, reconexão automática com backoff
  ao cair o stream, e "tocando agora" via metadados ID3 (HLS), quando disponíveis.
- **URLs de terceiros saneadas**: favicon e site oficial passam por validação de
  esquema e upgrade http→https (evita mixed-content e esquemas perigosos).
- PWA instalável (Service Worker com versionamento por hash).
- Filtros por banda/país/busca/ordenação/idioma persistidos na URL.

## Licença / créditos

Código sob licença MIT (ver `LICENSE`). Dados de fronteiras: Natural Earth
(domínio público). Catálogo de estações: Radio Browser (licença livre).
