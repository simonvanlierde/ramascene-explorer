# Compute a scenario in the browser

The page can compute a custom scenario on your device, with no server. Recorded timings are in
[browser-performance.md](browser-performance.md).

## Run a custom scenario

[Custom scenarios](page.md#custom-scenarios) shows how to fill in the form.
The catalogue records its **Final demand** category as `Y: Final Consumption`.
If `?api=` is also present, the job API takes precedence.

The result lights the map, headline, world-region totals and Details. Its label says
"computed in this browser". The shared link keeps the last
published scenario, so reopening it does not reconstruct the custom calculation.

The model has the same scope as the [published scenarios](scenarios.md): changes
to the 2011 economy, without forecasts, substitution or rebound. It accepts up
to ten interventions. The engine refuses broad changes and singular systems with an
error instead of returning a result.

The 155 published scenarios match RaMa-Scene's shipped results at relative 1e-6
per world-region total in CI. That checks the implementation, not a custom scenario's assumptions.

### Downloads, waits and errors

The calculation runs in a worker. When the form opens, it downloads the
manifest: the catalogue, the baseline flows and the store's layout. A scenario
then downloads only the rows it needs: the changed rows of A, the part of L that
links the changed rows to their consumers, one row of flow totals for each
changed row, and the matching rows of baseline output X and final demand Y.

While the form is open, those downloads start half a second after the selection
last changed, so Run waits only for what is still loading. A new percentage reads the
same rows, so it starts nothing new. One selection downloads at a time; while it does,
only the newest waits, so quick changes waste at most one download. Run on a
selection other than the one downloading stops that download first, so the two
never share the memory budget. Above 5 MB, the form says how much the selection downloads.
A selection changed while Run computes waits for Run to finish before it downloads.

While a scenario runs, the form shows the seconds elapsed and a Cancel button, which
stops the worker and starts a fresh one. A worker that runs out of memory is replaced
the same way, and its error stays on screen.

A range read fails the run once the data host has sent nothing for a minute, to that read
or to any other read in the worker. Headers or a chunk arriving for any read start the
minute again, so a slow link that keeps sending finishes. A read that
stalls, or that the network drops without the page stopping it, is first tried once more on
a fresh request: Firefox sometimes aborts a body read by itself. The error names the file
and range. A 5xx answer from the data host fails at once with "try again".

The first load of the manifest fails after two minutes. The kernel loads beside it:
a failed kernel download leaves the form usable, and Run loads it again. A Run that waits
over two minutes for the kernel fails the same way.

### Limits

The work grows with the changed product–country pairs (one product from one producing
country, a row of A) and the consuming columns they feed (one industry in one consuming
country). Before reading matrices, the form and the worker estimate three costs
from the catalogue and the manifest alone, and refuse a scenario that would:

- download more than 160 MiB,
- hold more than 256 MiB of float64 working arrays, or
- need more than 10 billion multiply-adds, counted as if every coefficient were nonzero.

The form says so before Run, with the pair count. Manufacturing used by
electricity in every country (4,165 pairs into 1,078 columns) and one country's
whole final demand (9,800 pairs) both fit. Every product from every country, or
Europe's manufacturing feeding every European industry, does not: choose a narrower
product, fewer producing countries, or fewer industries or regions that use it. The
[job API](interface.md#job-api) remains available for work outside the browser budget.

In the terms of [Data and method](#data-and-method), the memory estimate includes:

- the matrix copies used for the coefficient update, transpose, solve and final-demand changes;
- the WebAssembly kernel's own copies of ΔA, L[K, R] and X₀[K, :];
- two batches of H rows, one of them read early beside the other matrices.

It excludes the baseline, metadata, row caches and
decoder buffers; it is not a total browser memory limit.

A broad scenario can take several seconds on a desktop, and longer on a phone:
see [the measurements](browser-performance.md). The worker keeps at most 16 MiB of
decoded rows per array, least recently used first out, so a repeated selection
may read some rows again.

## Build or download the data

The store is a separate `data-2011` release asset, 803 MB. Move any
existing `data/browser-engine` directory aside before extraction, so the build
contains only the selected export. Then download it:

```sh
scripts/fetch-data.sh store   # downloads, checks data/browser-engine-zarr.sha256, unpacks into data/
```

The earlier `ramascene-browser-engine*.tar` assets remain for the older layouts.

To build the store yourself, run this from the explorer, with the RaMa-Scene arrays and its
label database available. Use a new output directory: the export refuses an existing manifest.

```sh
OPENBLAS_NUM_THREADS=8 uv run python pipeline/export_browser.py --data /path/to/datasets --db /path/to/db.sqlite3 --out data/browser-engine
```

The export takes about 10 s with 8 threads. Before writing, it checks the input hashes
against the published dataset, checks the baseline residual of `(I − A) X = Y` at relative
1e-9, and checks that H reproduces the baseline flows. The store directory is named
`store-<hash>`, where the hash covers every file's path and SHA-256, and `manifest-v3.json`
names it. Changed data therefore gets different URLs. The reader refuses the earlier row
layouts, and version 3 uses a new manifest name, so a cached older manifest cannot reach
the new reader. The worker revalidates the manifest, and a tab that still holds
an older one gets a 404 for the removed store and asks for a reload. A tab
whose worker script does not load, such as one opened before a deploy, also asks
for a reload.

The exporter writes each gzip chunk with a zero timestamp, so the same inputs give the same
store, byte for byte. To publish a new export, pack it with fixed names, times and modes, so the
same files give the same tar:

```sh
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=u=rwX,go=rX --format=gnu \
  -cf data/ramascene-browser-engine-zarr.tar -C data browser-engine
sha256sum data/ramascene-browser-engine-zarr.tar > data/browser-engine-zarr.sha256
```

Then upload the tar to the data release and commit the new `data/browser-engine-zarr.sha256`.
That file and the release asset's digest are the only reference for the archive. Do not
gzip it: gzip stores the write time, so a re-export of the same data would change the bytes.

The build includes the data when present. CI and publishing download and verify
the archive. Cloudflare refuses any single asset over 25 MiB
([publishing.md](publishing.md#cloudflare)). The browser fetches
only the data a calculation needs. The desktop and phone smoke test bounds that
transfer at 50 MB for the default steel scenario.

## Use the engine from Python

`pipeline/numpy_engine.py` runs the same calculation on the local store with numpy and scipy, so
there is no Rust or WebAssembly to build. It reads the store in `data/browser-engine` (`just data store`
fetches it, an 803 MB download). It does not read the store from its published URL: zarr needs fsspec
and aiohttp, or obstore, for HTTP, and the project does not depend on them.

`pipeline/ask.py` takes catalogue names, with the same contract as the page's
[WebMCP tools](interface.md#webmcp): `find_names(store, kind, query)` and `run_whatif(store, levers)`, with
the same lever fields, checks and error messages, raised as `ValueError`. `find_names` returns every match,
not the tool's first 25. `run_whatif` returns the page's result for a browser run:

- `changes`: each lever in words;
- `model_details`: the steps it ran;
- `regions`: the 49 countries;
- `indicators`;
- `results`: the baseline and scenario totals by indicator id and producing country, as
  Details → Method lists them;
- `flows`: the baseline and scenario flows, as indicator × producer × section × consumer arrays.

Run it from the repository root:

```sh
uv run python - <<'EOF'
import sys
sys.path.insert(0, "pipeline")
import ask, numpy_engine as ne

store = ne.open_store("data/browser-engine")
print(ask.find_names(store, "products", "motor vehicles"))
run = ask.run_whatif(store, [{"product": "Motor vehicles, trailers and semi-trailers", "origin_region": "Europe",
                              "consumed_by": ["Y: Final Consumption"], "consumed_region": "Europe",
                              "change_percent": -20}])
print(run["results"]["scenario"][5]["Germany"])  # GHG emissions produced in Germany
EOF
```

`numpy_engine.scenario_flows(store, steps)` is the step below: it takes the steps with the catalogue's ids,
as the page sends them, and `techChange` in percent. `tests/ask-cases.json` holds the name-lookup cases that
both `tests/ask.test.js` and `tests/test_ask.py` run, so the JavaScript and Python lookups cannot drift.

`tests/test_numpy_engine.py` runs the 155 scenarios and the baseline against `data/results.json` when
`BROWSER_ENGINE_DATA` is set. It holds the worst relative difference to 1e-8; 5.5e-9 is measured, the
same float32 storage floor as the page's test. The page's budgets on download, memory and work are not applied.

## Check the calculations

```sh
BROWSER_ENGINE_DATA=data/browser-engine pnpm test
node brightway-check/browser_check.js data/browser-engine
CI=1 pnpm exec playwright test tests/e2e/browser-engine.spec.js
```

The first command checks the 155 scenarios and the baseline against `data/results.json`
at relative 1e-6 per world-region total, with the worst held to 1e-8. The second checks the agreement table's Dutch cement footprint, from H, at
relative 1e-6. The browser test checks the worker, map, source label, retry and
absence of external requests.

## Data and method

The input is EXIOBASE v3.3.sm (2011) by Franco Donati and Arjan de Koning,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196), under
CC BY 4.0. The exported matrices and baseline flows have the same licence.

The symbols, with 9,800 rows (49 countries × 200 products):

- A: the technical coefficients. L = (I − A)⁻¹, the Leontief inverse.
- Y: final demand, one column per consumer country. X = L Y: baseline output, also one
  column per consumer country.
- B: the indicator intensities, each indicator per unit of output.
- R: the changed rows of A (product–country pairs). K: the columns they feed. F: the rows
  whose final demand changes.

For `A′ = A + ΔA`, the worker computes

```text
X₀ = X + L[:, F] ΔY[F, :]            (F: rows whose final demand changes)
W  = (I − ΔA L[K, R])⁻¹ ΔA X₀[K, :]   or, the same, ΔA (I − L[K, R] ΔA)⁻¹ X₀[K, :]
X′ = X₀ + L[:, R] W
```

It solves whichever system is smaller, R × R or K × K, in float64, in a Rust
kernel (`engine/`) compiled to WebAssembly, which also adds `H[J]ᵀ Z`.

The page draws flows `G X′`. G holds the intensities B, one row per indicator, producing
country and section: each row has B's value for that indicator at the section's products in
that country, and zero elsewhere. So `G X′` is each indicator summed over a section's products
in each producing country. With `H = (G L)ᵀ`, precomputed, the new flows are
the baseline flows plus `H[J]ᵀ Z`, where J is R and F together and Z holds W and
ΔY. So the worker never needs whole columns of L, only H's rows, of 2,205 values
each (3 indicators × 49 producers × 15 sections). Overlapping interventions
multiply the selected coefficients in order.

The store is [Zarr v3](https://zarr-specs.readthedocs.io/en/latest/v3/core/index.html),
written by zarr-python, so any Zarr v3 reader can open it:

| Array | Shape | Size | Read as |
| --- | --- | ---: | --- |
| `A` | 9,800 × 9,800 | 155 MB | the changed rows, at the consuming columns |
| `L` | 9,800 × 9,800 | 282 MB | rows K, at columns J |
| `LC` (L's columns) | 9,800 × 9,800 | 297 MB | columns J, at rows K |
| `H` | 9,800 × 2,205 | 64 MB | rows J |
| `X`, `Y` | 9,800 × 49 | 2.6 MB | rows K and F |

Values are float32 with gzip. Storing float32 moves the 155 published
scenarios by at most 5.5e-9 relative (the parity test prints its worst case); the arithmetic is float64 throughout.
L is stored twice so the reader can take `L[K, J]` from K rows or J columns,
whichever is less to download: the Europe steel scenarios change 49 rows that
feed 6,400 columns. A system whose pivot falls below float32 precision,
relative to its scale, is refused as singular.

Each array except X and Y is sharded by producing country: one file per 200
rows, one gzip chunk per row, and an index of offsets and sizes at the end of
the file (the Zarr sharding codec). X and Y are one file each, with one chunk
per country. The reader fetches a shard's index once, then asks for the chunks
it needs as single byte ranges, merging chunks less than 64 KiB apart. Each
request is one range, since many static hosts answer a request for several ranges
with the whole file.

Two readers depend on this layout: the page's `src/lib/browser-engine/browser-data.js`, and
zarr-python in `pipeline/numpy_engine.py` and `tests/test_browser_export.py`. A change to the
layout in `pipeline/export_browser.py` needs both.

## What to precompute

The published scenarios and their map flows are computed ahead of time, so browsing them
never runs the browser solver. The custom route also reuses the precomputed inverse L, its
flow totals H, baseline X and baseline flows. It solves only the small system for the
selected changes.

Final-demand changes are linear when A is fixed: a weighted combination of
precomputed response columns gives the exact answer. Coefficient changes alter
the inverse, so interpolation between two scenarios is not generally exact.
Precomputing every product, region, consumer and percentage combination would
grow with all those choices. Keep common published results ahead of time and
compute bounded custom combinations from the reusable matrices.

Decode chunks directly into typed arrays. Avoid creating an object or array
for every scalar. Keep calculation in a worker so the page can respond while it runs, as explained
in [web.dev's worker guide](https://web.dev/articles/off-main-thread).

The matrix URLs include content hashes. Requests use normal HTTP caching
instead of forcing revalidation. A new dataset gets new matrix URLs; see
[MDN's cache-busting guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching).
Do not download the entire export to warm a cache. Large, rarely used
assets should load when needed, as the
[Chrome runtime-caching guide](https://developer.chrome.com/docs/workbox/caching-resources-during-runtime/)
explains.

The WebAssembly kernel does the small system's dense products with its own
[wasm SIMD](https://github.com/WebAssembly/simd) kernel, and the solve with faer. It also
decodes the stored chunks, with flate2's zlib-rs backend. A browser without wasm SIMD
(before Chrome 91, Firefox 89 or Safari 16.4) cannot load the kernel, so custom
scenarios fail there and the published ones still work. WebAssembly memory grows to the
largest scenario run in a tab and is not returned until the worker restarts. The page uses
no persistent browser storage and no GPU kernel
([measurements](browser-performance.md#float32-maths-sparse-rows-and-a-gpu-kernel)).

## Browser threads

On a cross-origin-isolated host, broad dense technical changes can use a shared-memory
WebAssembly build with Rayon. The worker divides matrix products into disjoint output rows;
inputs stay shared and all arithmetic stays float64. The LU solve and decoding remain serial.
Small products also remain serial to avoid scheduling overhead.

The worker selects the pool only when there are more changed rows than input columns,
and the main product needs at least a billion multiply-adds. The opposite direction
uses the sparse build and did not benefit in paired measurements. It also reserves
16 MiB within the working-memory budget for stacks and runtime space.

The pool has at most four threads and leaves one reported CPU core available.
Hosts without isolation, and devices reporting two cores or fewer, use the existing
single-thread build. A failed pool startup or its 15-second deadline terminates the
worker and retries pending requests once in a fresh single-thread worker. So does a
trap during a threaded calculation, and a threaded kernel call still running after 120
seconds: a trap in a pool thread leaves the calling thread waiting rather than throwing.
The worker tells the page when each threaded call starts and ends, so the 120 seconds
never count downloads, and a run on one thread has no time limit. A second failure on
one thread stops the worker; the page shows the error and starts a fresh worker for the
next Run.

The build uses the nightly pinned in `engine/threads/rust-toolchain.toml` because
WebAssembly atomics require rebuilding Rust's standard library. `pnpm engine` builds
both variants. Vite bundles the nested module workers; they inherit the host's isolation
headers. A host without them keeps the single-thread path.

The threshold of a billion multiply-adds and the four-thread cap come from the
[thread measurements](browser-performance.md#browser-threads).

## Measure a change

With the prepared export present:

```sh
taskset -c 30,31 node scripts/measure-browser-engine.js docs/measurements/browser-engine-zarr.json
```

Choose CPUs available on the measurement machine. On macOS, omit `taskset`.
The script runs five fresh Node processes per case, each with a first and a
repeated calculation including flow aggregation, and records read bytes and
requests, peak RSS and host load. One case adds 150 ms of synthetic latency per
read. Files come from the warm OS cache, so it measures the numerical and data
path, not browser painting or a CDN. With `--network`, every read instead waits
30 ms and then shares a simulated 100 Mbit/s link with the other open reads, so the
download's share of a run shows.

The recorded results, and the thread benchmarks with their own harness, are in
[browser-performance.md](browser-performance.md).
