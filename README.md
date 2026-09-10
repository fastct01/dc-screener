# DC Site Screener — web MVP (v0.1)

Power-first data-center site screening on a keyless 3D globe. Draw a search box (or drop pins), state the requirement (IT MW, kW/rack, tier), and get a ranked shortlist with a per-candidate scorecard, a deterministic design + TCO estimate, a feasibility memo, and an evidence trail where every number links to its source layer and fetch timestamp. Implements Agent #1 from [plan.md](plan.md).

**Design rule:** every number is computed by tested, pure functions in `src/engine/`. The LLM (optional) only re-narrates a scored JSON object; it never computes.

## Run

```bash
npm install
npm run data      # builds public/data/*.json from the provenance copies under data/
npm run dev       # http://localhost:5180
npm test          # engine + adapter unit tests (node --test)
```

Optional keys go in `.env` (see `.env.example`): `ANTHROPIC_API_KEY` enables **Narrate with Claude**.

Headless end-to-end check (needs a Chrome binary):

```bash
node scripts/e2e.mjs http://localhost:5180/ "/path/to/Google Chrome for Testing"
```

## What it measures (v0.1)

| Criterion | Source | Notes |
|---|---|---|
| Substation proximity + voltage | OSM `power=substation` via Overpass | live, cached 7 days |
| Transmission line proximity + voltage | OSM `power=line` | live |
| Generation proximity | OSM `power=plant` + bundled OSM dams | live + bundled |
| DC ecosystem / fiber proxy | bundled OSM `telecom=data_center` (4,351) | count within 50 km |
| Water proximity | OSM named `natural=water`, `waterway=river` | proximity only; **water stress not assessed** |
| Free-cooling climate | Open-Meteo Historical (ERA5), 8,760 hourly temps | economizer hours, p99, wet-bulb |
| Flood hazard | FEMA NFHL point query | US only; some networks cannot reach FEMA — then unscored |
| Seismic | USGS Design Maps ASCE 7-22 PGA | US only |
| Terrain slope | Re:Earth terrain sampled 3×3 @ 250 m | via Cesium |
| State DC tax incentives | Natural Earth admin-1 + seed table | **seed list, verify against statute** |

Unscored criteria are excluded from the composite and reported as reduced *coverage* rather than silently zeroed.

**Not assessed:** interconnection queue position, utility capacity, parcel/zoning, community sentiment, water stress (WRI Aqueduct), non-US incentives. These are the next data spines to add.

## Layout

```
src/engine/      pure math: geo.js, scoring.js, calculators.js, incentives.js, memo.js
src/data/        adapters: overpass.js, climate.js, hazards.js, localData.js
src/screener.js  pipeline: candidates → measurements → sub-scores → composite → design bundle
src/globe.js     keyless Cesium globe (Esri imagery + Re:Earth terrain), terrain sampling
src/layers.js    Cesium entities/primitives for data layers, box, pins, ranked candidates
src/ui/panel.js  DOM: form, weights, table, detail tabs, exports
vite.config.js   dev/preview proxies: /api/overpass, /api/fema, /api/usgs, /api/memo, /api/status
scripts/         build-datasets.mjs, e2e.mjs
tests/           node --test unit tests
data/            provenance copies of bundled datasets (+ READMEs)
```

## Data licensing

The code is MIT. Data keeps its own terms — see the in-app **Data attribution** link (bottom-left):

- OSM-derived layers (Overpass results, bundled data centers, dams): **ODbL 1.0**, attribution required, share-alike on derived databases.
- Esri World Imagery: attribution required; review ArcGIS terms before scaled deployment.
- Re:Earth terrain: CC BY 4.0. Open-Meteo: CC BY 4.0. FEMA, USGS, Natural Earth: public domain.
- The bundled OSM snapshots and the globe pattern come from [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT code). Its TeleGeography submarine-cable data is **non-commercial** and was deliberately **not** copied here.

## Caveats

Screening-grade decision support, not engineering-of-record. Cost figures are 2026 planning ranges (JLL, Uptime, Epoch AI); OSM coverage is incomplete, so a missing feature is absent evidence, not evidence of absence.
