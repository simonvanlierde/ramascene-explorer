# Interface

## URL parameters

The URL stores filters and published scenarios. It does not store custom results;
a shared link opens the last published scenario with the current filters.
A missing or out-of-range value falls back to its default. Defaults
are left out of the link. `data` and `api` survive when the page rewrites it.
Code: `parseView` and `viewSearch` in `src/lib/flows.js`, `data` in `src/lib/explorer.js`, `api`
in `src/lib/live.js`.

| parameter | values | default |
| --- | --- | --- |
| `mode` | `flows`, `whatif` | `flows`; `whatif` when `mode` is absent and `scenario` names a run |
| `scenario` | a precomputed run id, see [scenarios.md](scenarios.md) | the first run |
| `indicator` | an indicator id from the data | the first indicator |
| `region` | a country code from the data, or `world` for every region at once | `DE` |
| `dir` | `in` (consumed by), `out` (released by); with `region=world`, which side the map colours | `in` |
| `sections` | comma-separated section numbers | all sections |
| `map` | `flat` (`globe` is accepted from older links) | the globe |
| `zoom` | `k` on the globe, `k,lon,lat` on the flat map; `k` above 1 and up to 8 | none |
| `panel` | `sankey`, `table`, `method` | none |
| `data` | a relative path to a `.json` file ([security.md](security.md#what-data-accepts)) | `data/results.json` |
| `api` | a job API origin ([security.md](security.md#what-api-accepts)) | none |
| `ask` | the base URL of a chat-completions model server, see [Ask](#ask) | none |
| `askmodel` | the model name to send with `ask` | the first model the server lists |

The Parquet file for `data` has the same name ending in `-embodied.parquet`
(`embodied.parquet` for `results.json`). `?data=tests/fixture.json` opens the
synthetic fixture.

## Number display

Amounts use at most three significant figures, without padded zeros, and two below
0.1. Values below 0.0001 use scientific notation to keep labels short. Percentage
changes use at most three significant figures and two decimal places; nonzero
changes below 0.01% read "−<0.01%" or "+<0.01%" rather than rounding to a signed
zero. The strip, the sentence and the map labels use these same rules, and the
heaviest strip cell and map label are the ones with the largest change: the largest
amount in Flows, and in What if… the largest change relative to 2011, the only figure the
map labels carry. When every cell is zero none is heavier.
A change from a zero baseline has no percentage; the display says so.

For display, differences no larger than a trillionth of the baseline are treated
as zero and do not name a largest change. This is a display rule, not an uncertainty
estimate. The calculations and downloadable CSV retain the original values.

## Ask

`?ask=<base URL>` adds an Ask panel under Custom scenario in What if…. The base URL is a
chat-completions server's, with its path (`http://localhost:11434/v1` for Ollama,
`http://127.0.0.1:8000/v1` for vLLM). It is checked like `api`: https, or http on `localhost`
or `127.0.0.1` on any port, with no user name, password, query or fragment; anything else is
ignored and the page is unchanged. `?askmodel=` names the model. With `?api=` also present,
the job API takes precedence and the panel does not appear. Code: `src/lib/ask.js`,
`src/AskPanel.svelte`.

A question goes to `POST {base}/chat/completions` with a JSON schema whose enums are the
catalogue's product, region and industry names, `temperature` 0 and thinking off. A name the
catalogue repeats for a narrower selection (an EXIOBASE product under the section of the same
name) gets ` (detail)` appended, so both stay reachable. The model
answers with an action: `view` (sets the indicator and country), `whatif` (up to ten changes) or
`none` (text only). The page maps the names to ids, plans the scenario and runs it in the
browser engine, in the worker the Custom scenario form uses, so the map shows the run. The
model never produces a number. A name outside the catalogue, or a change outside −100 to
1000 percent, is an error shown in the panel; nothing is clamped. Every answer lists the
changes it ran. The model's text is shown as text. A custom run stays out of the link.
Without `askmodel`, the page asks `GET {base}/models` and uses the first model.

The model server must:

- serve the chat-completions `POST /chat/completions` (and `GET /models` without `askmodel`) and
  honour `response_format` with `type: "json_schema"` (vLLM and Ollama's `/v1` do). The request
  also sends `chat_template_kwargs: {enable_thinking: false}`, which Qwen-style templates read and
  other servers ignore;
- answer within 60 s, in at most 1500 tokens; a longer answer is reported as cut off;
- allow the page's origin by CORS, including the preflight for the `Content-Type` header. vLLM
  answers the preflight with 400 unless started with `--allowed-origins '["<page origin>"]'`;
  Ollama needs `OLLAMA_ORIGINS=<page origin>`. The page sends no API key, so a server that needs
  one cannot be used directly: put a proxy on loopback in front of it that holds the key and
  answers only pages served from the same machine, since any site open in the browser can post
  to a loopback port.

A page on a public https origin calling a model on loopback is a local-network request: Chrome
asks the reader for permission and refuses without it, Firefox stops it (the panel says the
model did not answer within 60 s) and Safari refuses it. So for a demo, open the page from the
same machine as the model: `pnpm preview`, then `http://127.0.0.1:4180/?ask=…`. A model on
another machine is reached through an SSH tunnel to the same loopback port
(`ssh -N -L 8000:127.0.0.1:8000 <host>`). [evals/ask](../evals/ask/README.md) scores models on
this task.

## WebMCP

In a browser with WebMCP (`document.modelContext`: Chrome's origin trial, versions 149 to 156,
or its flag), the page registers three tools for an agent in that browser, with the same contract
as the Ask panel. They need no `?ask=` and no model server; with `?api=` the page registers none.
Code: `src/lib/webmcp.js`.

| Tool | Input | Result |
| --- | --- | --- |
| `find_names` (read-only) | `kind` (`products`, `regions` or `industries`), `query` | `names`: up to 25 names containing every word of the query; `more`: true when there were more |
| `show_view` | `indicator` (`ghg`, `jobs`, `metal_ores`) and/or `region` (a country, or `World`) | the sentence saying what the map now shows |
| `run_whatif` | `levers`: up to ten changes, as in the Ask panel's schema | the changes as run, the run's status line and the map's headline with its numbers |

`run_whatif` runs in the custom form's worker, then switches to What if… to show the result. A
refused run (unknown names, changes outside −100 to 1000 percent, a plan too broad for the
browser) is an error and leaves the view as it was; nothing is clamped. `headline` is null when
the map could not draw the run. An agent that aborts the call cancels the run. As with every
custom run, it stays out of the link. `tests/e2e/webmcp.spec.js` drives the tools through a
stand-in `document.modelContext`, and shows the calls an agent makes.

## Job API

`?api=` points the page at a RaMa-Scene job API such as `ramascene-jobs`. Its
[README](https://github.com/simonvanlierde/ramascene/blob/main/jobs/README.md)
is the contract: status codes, the `techChange` range, job retention and
timeouts. `ramascene-jobs` only answers pages served from `127.0.0.1` or
`localhost`, so run the page locally to use it
([page.md](page.md#live-scenarios-optional)). Any other job API must send its
own CORS headers. The page makes these calls (`src/LivePanel.svelte`, `src/lib/live.js`):

| call | what it does |
| --- | --- |
| `GET /catalog` | lists `products`, `regions` and `consumers` (each with `id` and `name`) for the form, and `tech_change_percent` (`{min, max}`) to bound the change field (−100 to 1000 if missing). |
| `POST /jobs` | starts a job. Body: `{"label": string, "model_details": [{"product": [id], "originReg": [id], "consumedBy": [id], "consumedReg": [id], "techChange": [percent]}]}`, with 1 to 10 entries in `model_details`. Answers with an object that has an `id`. |
| `GET /jobs/{id}` | polled every 2 seconds, for up to 30 minutes, until `status` is `succeeded` or `failed`. |

If nothing answers, or the browser blocks the answer for lack of CORS headers,
the status line says the job API is "not reachable (offline)". An HTTP error
shows its status and the API's `detail`, and a failed job shows its `error`.

A succeeded job returns `result` with `provenance`, `regions`, `indicators`,
`results.baseline` and `results.scenario`. It may add `result.flows`: a `shape`
(indicator, producer, section, consumer) and `baseline` and `scenario` arrays
in that order, in each indicator's unit. Producers and consumers follow the
precomputed file's country order (EXIOBASE's), and every value is a finite
number. The page draws these
flows only when the shape matches the precomputed file; otherwise the result
stays in the panel. `liveFlows` in
`src/lib/live.js` does the check. How a live run is shown is in
[page.md](page.md#live-scenarios-optional).

### Measure a live scenario

Start the job API with the EXIOBASE arrays, then run from the explorer:

```sh
pnpm build
CI=1 LIVE_API=http://127.0.0.1:8020 pnpm exec playwright test tests/e2e/live-timing.spec.js --project=light
```

This runs the default steel intervention five times against the real API.
It measures from the browser's click to the first painted frame with the new
result, including polling, transfer, decoding and rendering. Each sample also
records worker duration and peak memory. The test attaches `live-timing.json`
to its Playwright results. It runs only when `LIVE_API` is set.

On a shared development machine on 31 October 2026, the median was 2.58 s,
with 1.64 GB peak worker RSS, including memory-mapped data pages. The median worker
duration was 1.44 s. These are local measurements, with the dataset already
cached by the API, rather than a performance budget. The page polls every
2 seconds; the result becoming ready between polls still waits for the next
one. Map movement has a separate profiling workload.
