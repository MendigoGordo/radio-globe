# Cloudflare Worker — proxy + cache da API do Radio Browser

Acelera **muito** o carregamento das estações. A API pública do Radio Browser
demora 28–40 s para devolver o catálogo completo (~14 MB). Este Worker baixa
uma vez, guarda no **cache da borda** do Cloudflare e passa a servir a todos os
usuários em milissegundos, de um data center próximo. Também resolve CORS e faz
failover entre os mirrors.

> **Custo:** o plano gratuito do Cloudflare Workers (100 mil requisições/dia)
> cobre folgado este caso de uso.

## Deploy (uma vez)

Pré-requisito: uma conta gratuita no Cloudflare.

```bash
cd tools/cloudflare
npx wrangler login        # abre o navegador para autorizar
npx wrangler deploy       # publica o Worker
```

Ao final, o Wrangler mostra a URL pública, algo como:

```
https://global-radio-3d-api.SEU-SUBDOMINIO.workers.dev
```

## Ativar no site

Cole a URL acima em `data/config.js`:

```js
window.GLOBAL_RADIO_3D_API_PROXY = "https://global-radio-3d-api.SEU-SUBDOMINIO.workers.dev";
```

Pronto. O app passa a usar o Worker antes dos mirrors públicos. Para voltar ao
comportamento padrão (sem proxy), deixe a string vazia.

## Como testar o Worker

```bash
# healthcheck
curl https://global-radio-3d-api.SEU-SUBDOMINIO.workers.dev/health

# catálogo (primeira vez MISS, depois HIT e bem mais rápido)
curl -s -D - -o /dev/null \
  "https://global-radio-3d-api.SEU-SUBDOMINIO.workers.dev/json/stations/search?has_geo_info=true&hidebroken=true&limit=12000"
# veja o cabeçalho X-RG-Cache: MISS (1ª vez) / HIT (próximas)
```

## O que ele faz / não faz

- **Faz:** proxy das rotas `/json/...`, cache no edge (TTL: estações 1 h,
  países 24 h), CORS liberado, failover entre os mirrors.
- **Não faz:** não cacheia streams de áudio nem expõe segredos (não há nenhum).
  Só repassa uma API pública.

## Atualizar o Worker

Depois de mexer em `worker.js`, basta `npx wrangler deploy` de novo. Para forçar
a expiração do cache antes do TTL, troque o caminho/query (o cache é por URL) ou
use o painel do Cloudflare (Caching → Purge).
