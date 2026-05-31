# Pipeline regulatório (cruzamento AM/FM por transmissor)

Gera `data/regulatory.json` — uma base enxuta de transmissores licenciados
(frequência + coordenada + indicativo) — a partir de dados públicos oficiais.
O app usa esse arquivo (quando presente) para confirmar a banda/frequência de
cada estação do Radio Browser pelo transmissor licenciado mais próximo na mesma
frequência. Sem o arquivo, o app continua funcionando com a classificação por
plano de frequência (`data/bandplan.js`).

## Por que não baixa sozinho

As bases oficiais (Anatel, FCC) mudam de URL e de layout com frequência. Para
não embutir uma URL que pode quebrar nem inventar nomes de colunas, o pipeline
lê um **CSV local que você baixa** + um **config de mapeamento de colunas**.
Assim o resultado é sempre fiel ao arquivo real.

## Passo a passo

1. Baixe a base oficial e salve em `tools/sources/` (ao lado do `.config.json`):
   - **Brasil (Anatel):** estações de radiodifusão FM/AM com latitude, longitude,
     frequência e indicativo. Disponível no portal de dados abertos / sistema
     Mosaico da Anatel. Salve como `tools/sources/anatel-fm.csv`.
   - **EUA (FCC):** export da consulta FM/AM (FM Query / AM Query), normalmente
     pipe-delimited (`|`). Salve como `tools/sources/fcc-fm.csv`.

   O caminho em `"file"` no config é resolvido **relativo à pasta do config**.

2. Abra o `.config.json` correspondente em `tools/sources/` e ajuste o bloco
   `columns` para bater **exatamente** com o cabeçalho do CSV baixado. Se errar
   um nome, o script imprime o cabeçalho real para você corrigir.

3. Gere o JSON:

   ```bash
   node tools/build-regulatory.mjs tools/sources/anatel.config.json
   # ou várias fontes de uma vez:
   node tools/build-regulatory.mjs tools/sources/anatel.config.json tools/sources/fcc-fm.config.json
   ```

4. Recarregue o site. Ao abrir o painel de uma estação, a frequência/banda
   passa a vir marcada como **confirmada** quando há um transmissor licenciado
   compatível por perto.

## Formato de `data/regulatory.json`

Array de objetos compactos:

```json
[{ "f": 101.7, "u": "MHz", "lat": -23.55, "lng": -46.63, "c": "ZYC690", "s": "FM", "cc": "BR" }]
```

| campo | significado                         |
|-------|-------------------------------------|
| `f`   | frequência                          |
| `u`   | unidade (`MHz` ou `kHz`)            |
| `lat` | latitude decimal                    |
| `lng` | longitude decimal                   |
| `c`   | indicativo/callsign                 |
| `s`   | serviço (`FM` / `AM`)              |
| `cc`  | país (ISO-3166-1 alpha-2)          |

## Coordenadas

O conversor aceita decimal (`-23.55`) e DMS (`23S33'12"`). Para arquivos que
separam o hemisfério em outra coluna, use `latHemisphere`/`lngHemisphere` no
config (`"S"`, `"W"`, etc.).
