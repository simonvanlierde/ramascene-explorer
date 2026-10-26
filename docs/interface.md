# Interface

## URL parameters

The page keeps its state in the query string, so a view can be shared as a
link. A missing or out-of-range value falls back to its default, and defaults
are left out of the link. `data` and `api` survive when the page rewrites it.
Code: `parseView` and `viewSearch` in `flows.js`, `data` in `explorer.js`, `api`
in `live.js`.

| parameter | values | default |
| --- | --- | --- |
| `mode` | `flows`, `whatif` | `flows`; `whatif` when `mode` is absent and `scenario` names a run |
| `scenario` | a precomputed run id, see [scenarios.md](scenarios.md) | the first run |
| `indicator` | an indicator id from the data | the first indicator |
| `region` | a country code from the data | `DE` |
| `dir` | `in` (consumed by), `out` (released by) | `in` |
| `sections` | comma-separated section numbers | all sections |
| `map` | `globe` | the flat map |
| `zoom` | `k` on the globe, `k,lon,lat` on the flat map; `k` above 1 and up to 8 | none |
| `panel` | `sankey`, `table`, `method` | none |
| `data` | a relative path to a `.json` file ([security.md](security.md#what-data-accepts)) | `data/results.json` |
| `api` | a job API origin ([security.md](security.md#what-api-accepts)) | none |

The Parquet file for `data` has the same name ending in `-embodied.parquet`
(`embodied.parquet` for `results.json`). `?data=tests/fixture.json` opens the
synthetic fixture.

## Job API

`?api=` points the page at a RaMa-Scene job API such as `ramascene-jobs`. Its
[README](https://github.com/simonvanlierde/ramascene/blob/main/jobs/README.md)
is the contract: status codes, the `techChange` range, job retention and
timeouts. `ramascene-jobs` only answers pages served from `127.0.0.1` or
`localhost`, so run the page locally to use it
([page.md](page.md#live-scenarios-optional)). Any other job API must send its
own CORS headers. The page makes these calls (`src/LivePanel.svelte`, `live.js`):

| call | what it does |
| --- | --- |
| `GET /catalog` | lists `products`, `regions` and `consumers` (each with `id` and `name`) for the form, and `tech_change_percent` (`{min, max}`) to bound the change field (−100 to 1000 if missing). |
| `POST /jobs` | starts a job. Body: `{"label": string, "model_details": [{"product": [id], "originReg": [id], "consumedBy": [id], "consumedReg": [id], "techChange": [percent]}]}`. Answers with an object that has an `id`. |
| `GET /jobs/{id}` | polled every 2 seconds, for up to 30 minutes, until `status` is `succeeded` or `failed`. |

If nothing answers, or the browser blocks the answer for lack of CORS headers,
the status line says the job API is "not reachable (offline)". An HTTP error
shows its status and the API's `detail`, and a failed job shows its `error`.

A succeeded job returns `result` with `provenance`, `regions`, `indicators`,
`results.baseline` and `results.scenario`. It may add `result.flows`: a `shape`
(indicator, producer, section, consumer) and `baseline` and `scenario` arrays
in that order. The page draws these flows only when the shape matches the
precomputed file; otherwise the result stays in the panel. `liveFlows` in
`live.js` does the check. How a live run is shown is in
[page.md](page.md#live-scenarios-optional).
