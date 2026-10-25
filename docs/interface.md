# Interface

## URL parameters

The page reads its state from the query string, so a view can be shared as a
link. `parseView` in `flows.js` reads the view parameters and `viewSearch`
writes them; `data` is read in `explorer.js` and `api` in `live.js`. A value
that is missing or out of range falls back to its default, and the default is
left out of the link. `data` and `api` are kept when the page rewrites the
link.

| parameter | values | default |
| --- | --- | --- |
| `mode` | `flows`, `whatif` | `flows`; `whatif` when `mode` is absent and `scenario` names a run |
| `scenario` | a precomputed run id, see [scenarios.md](scenarios.md) | the first run |
| `indicator` | an indicator id from the data | the first indicator in the data (5 in the shipped file) |
| `region` | a country code from the data | `DE` |
| `dir` | `in` (consumed by), `out` (released by) | `in` |
| `sections` | comma-separated section numbers | all 15 |
| `map` | `globe` | the flat map |
| `zoom` | `k` on the globe, `k,lon,lat` on the flat map; `k` from above 1 to 8, `lon` within ±180, `lat` within ±90 | none |
| `panel` | `sankey`, `table`, `method` | none |
| `data` | a relative path to a `.json` file ([security.md](security.md#what-data-accepts)) | `data/results.json` |
| `api` | a job API origin ([security.md](security.md#what-api-accepts)) | none |

The Parquet file for `data` is the same name with `-embodied.parquet` (or
`embodied.parquet` for `results.json`). `?data=tests/fixture.json` opens the
synthetic fixture.

## Job API

`?api=` points the page at a RaMa-Scene job API such as `ramascene-jobs`. The
job API is a separate project, and its
[README](https://github.com/simonvanlierde/ramascene/blob/main/jobs/README.md)
is the contract: status codes, the `techChange` range, how long jobs are kept
and when they time out. `ramascene-jobs` answers browsers only from loopback
`http` origins (`127.0.0.1` or `localhost`), so run the page locally to use it
([page.md](page.md#live-scenarios-optional)). Another job API must send its own
CORS headers. This is what the page sends and reads (`src/LivePanel.svelte`,
`live.js`):

| call | what it does |
| --- | --- |
| `GET /catalog` | lists `products`, `regions` and `consumers` (each with `id` and `name`) for the form, and `tech_change_percent` (`{min, max}`), which bounds the change field (−100 to 1000 if missing). |
| `POST /jobs` | starts a job. Body: `{"label": string, "model_details": [{"product": [id], "originReg": [id], "consumedBy": [id], "consumedReg": [id], "techChange": [percent]}]}`. Answers with an object that has an `id`. |
| `GET /jobs/{id}` | polled every 2 seconds, for up to 30 minutes, until `status` is `succeeded` or `failed`. |

When nothing answers, or the browser blocks the answer for lack of CORS
headers, the status line says the job API is "not reachable (offline)". An
HTTP error shows its status and the API's `detail` text, and a failed job
shows its `error`.

A job that succeeded must carry `result` with `provenance`, `regions`,
`indicators` and `results.baseline` and `results.scenario`. It may carry
`result.flows`: `shape` (indicator, producer, section, consumer), and
`baseline` and `scenario` as flat absolute arrays in that order. The page
draws the flows only if the shape matches the precomputed file (49 countries,
15 sections, the same indicators). Otherwise the result stays in the panel.
The code that checks this is `liveFlows` in `live.js`. How a live run is shown
is in [page.md](page.md#live-scenarios-optional).
