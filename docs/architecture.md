# Architecture

The explorer has two halves. A Python script computes results once. A static
page then reads those results in the browser. The published site needs no calculation server.
Open it with `?api=` to connect an optional job API.

A worker computes custom scenarios from exported float32 matrices, in float64 arithmetic. It starts
when a reader opens the custom-scenario form. [browser-engine.md](browser-engine.md) describes its data and checks.

```text
RaMa-Scene engine + EXIOBASE matrices
        |  pipeline/precompute.py (run by hand, needs the engine)
        v
data/results.json        data/embodied.parquet  (release asset)
        |                        |
        +--- Cloudflare ---------+
                   |  fetch + HTTP range requests
                   v
              the page (Svelte, in the browser)
                   |  only with ?api=<origin>
                   v
              job API (ramascene-jobs), optional
```

Each part has its own page; [the docs index](README.md) links them all.

`index.html` loads `src/main.js`, which mounts `src/App.svelte`. The Svelte
files in `src/` draw the view. The logic that needs no browser lives in plain
modules in `src/lib/`, so `node --test` can test it:

| module | what it holds |
| --- | --- |
| `src/lib/explorer.js` | where the data file is (`?data=`), the synthetic-data banner, run matching |
| `src/lib/embodied.js` | reading the Parquet file by range request |
| `src/lib/flows.js` | sums, scales, units, the table and CSV, the URL parameters |
| `src/lib/map.js` | which map country belongs to which region |
| `src/lib/live.js` | the optional job API: origin check, request body, result reshaping |
| `src/lib/browser-engine/browser-engine.js` | the scenario planner and budgets, float64 Woodbury updates (a low-rank correction of the baseline inverse) |
| `engine/` | the Rust kernel, built to WebAssembly: the small linear solve and the flow sums |
| `src/lib/browser-engine/browser-data.js` | reading the Zarr store: shard indexes, coalesced range requests, row cache |
| `src/lib/browser-engine/browser-results.js` | browser source labels, provenance and result shape |

`browser-client.js` sends requests to `browser-worker.js` (both in `src/lib/browser-engine/`), which loads the data
and computes off the main thread. The existing custom-scenario form uses either
that worker or the job API. Both hand the same flow layout to the map.

## Load published results

The page fetches `data/results.json`, then reads the Parquet footer using HTTP range requests.
It uses the file size in `provenance.embodied.bytes`.
If that record is missing or the footer is not found, it first requests the size with HEAD.
It reads the baseline row group to draw the map, then loads the default scenario when the browser is idle.
Other scenarios load once, on demand.

The stylesheet (`src/app.css`) defines interface colours.
Data colours and the scales that use them are in `src/lib/flows.js`.

## First-load size

A cold first load of the live page, up to the default What if… run, transfers
about 0.98 MB (980,407 bytes, headers included) and unpacks to 1.65 MB. Data is
0.80 MB of that: `results.json` (77 KB gzipped), the map geometry (28 KB) and
three range requests into `embodied.parquet` (the footer, 131 KB; the
baseline, 342 KB; the default run, 222 KB). The rest is fonts (89 KB), the
script (81 KB), CSS (6 KB) and HTML (2 KB). Measured on 2026-10-26, median of
three loads with the cache off:

```sh
pnpm measure-load [url] [runs]
```

## Map geometry

`geo/countries-110m.topo.json` is Natural Earth 1:110m Admin 0 – Countries,
**v5.1.2** (public domain), from
`nvkelso/natural-earth-vector` tag `v5.1.2`, `geojson/ne_110m_admin_0_countries.geojson`
(sha256 `6866c877…c977f`). I kept only the properties `iso` (`ISO_A2_EH`;
Somaliland as `SO`, N. Cyprus `null`) and `name`, dropped Antarctica and the
French Southern Lands, and converted it with `geo2topo -q 1e4`
(topojson-server 3.0.1).
