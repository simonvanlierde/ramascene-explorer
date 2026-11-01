# Compute a scenario in the browser

Open the page with `?compute=1`, switch to What if…, then open Custom scenario.
Choose a product, its origin, a consuming industry and region, and a percentage
change. Run scenario computes the result on your device. Choose **Final demand** to change spending. An industry selection changes inputs per unit of monetary output.
The catalogue records this final-demand category as `Y: Final Consumption`.
If `?api=` is also present, the job API takes precedence.

The result lights the map, sentence, world-region totals and Details. Its label says
"computed in this browser". The shared link keeps the last
precomputed scenario, so reopening it does not reconstruct the custom calculation.

The calculation runs in a worker. It downloads the baseline output, final demand
and three extension rows once, then reads the required matrix rows by HTTP range
request. A server that ignores Range is refused before its full matrix is read.
The 153 published scenarios match RaMa-Scene's shipped results at relative 1e-9
in CI. That checks the implementation, not a custom scenario's assumptions.

The model has the same scope as the [published scenarios](scenarios.md): changes
to the 2011 economy, without forecasts, substitution or rebound. It accepts up
to ten interventions. Each scenario can change up to 2,000 technical-coefficient
rows and 2,000 final-demand rows. Broader changes and singular systems are
refused with an error instead of returning a result.

A smaller selection can also exceed the browser work budget. Before reading
matrices, the worker estimates dense arithmetic and scenario buffers. It refuses
more than 100 million update terms or 64 MiB of estimated scenario buffers.
Choose fewer products or regions when that happens. These limits exclude the
baseline, metadata, decoder temporaries and row caches; they are not a total
browser memory limit. The [job API](interface.md#job-api) remains available
for work outside the browser budget.

The worker keeps at most 16 MiB of completed rows per matrix, or 32 MiB for A
and L together. Least recently used rows are evicted. A repeated selection can
therefore require another read after other selections fill the cache. No more
than 64 selected matrix rows decode at once. Initial X and Y decoding also
uses bounded batches.

## Data and method

The input is EXIOBASE v3.3.sm (2011) by Franco Donati and Arjan de Koning,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196), under
CC BY 4.0. The exported matrices and baseline flows have the same licence.
The export uses float64 throughout; the existing precomputed map file stays float32.

For `A′ = A + U D Vᵀ`, with R and C selecting the changed rows and columns,
the worker computes:

```text
X₀ = L Y′
S = I − D L[C, R]
X′ = X₀ + L[:, R] solve(S, D X₀[C, :])
```

The exporter stores A rows and L columns as separate Parquet row groups.
It groups 128 logical rows of X and Y per Parquet row group, since both matrices
load in full. A, L, M and B keep separate row groups for their logical rows.
It also stores `M = B L` and the three selected B rows. Final-demand
changes update X₀ from the affected L columns. Overlapping interventions
multiply the selected coefficients in order. The page groups `B × X′` into
the same producer × industry section × consumer layout as the precomputed flows.

## Build or download the data

From the explorer, with the RaMa-Scene arrays and its label database available:

```sh
OPENBLAS_NUM_THREADS=1 uv run python export_browser.py --data /path/to/datasets --db /path/to/db.sqlite3 --out data/browser-engine
```

Use a new output directory. The export refuses an existing manifest. It checks
the input hashes against the published dataset, then checks
the baseline residual of `(I − A) X = Y` at relative 1e-9 before writing.
The manifest records each file's dimensions, size and SHA-256. Matrix filenames
include their hashes, so an old manifest cannot silently read a new matrix.

The grouped export is a separate `data-2011` release asset, about 916 MB.
The earlier `ramascene-browser-engine.tar` remains available for reproducing
measurements of the original layout.
Move any existing `data/browser-engine` directory aside before extraction, so
the build contains only the selected export.

```sh
gh release download data-2011 --repo simonvanlierde/ramascene-explorer --pattern ramascene-browser-engine-grouped.tar --dir data
sha256sum --check data/browser-engine.sha256
tar -xf data/ramascene-browser-engine-grouped.tar -C data
```

The build includes the data when present. CI and publishing download and verify
the archive. The full site is about 969 MB; the Pages build refuses 1 GB or more.
The browser fetches only the data needed for a calculation, rather than this
whole export. The desktop and phone smoke test bounds that transfer at 50 MB
for the default steel scenario.

## Check the calculations

```sh
BROWSER_ENGINE_DATA=data/browser-engine pnpm test
node brightway-check/browser_check.js data/browser-engine
CI=1 pnpm exec playwright test tests/e2e/browser-engine.spec.js
```

The first command checks all 153 scenarios against `data/results.json` at relative
1e-9. The second checks the agreement table's Dutch cement footprint. The browser
test checks the worker, map, source label, retry and absence of external requests.

## What to precompute

The page uses a hybrid approach. The 153 published scenarios and their map flows
are computed ahead of time. Browsing them never runs the browser solver. The
custom route also reuses the precomputed inverse L, baseline X, extension B and
baseline flows. It solves only the small system for the selected changes.

Final-demand changes are linear when A is fixed: a weighted combination of
precomputed response columns gives the exact answer. Coefficient changes alter
the inverse, so interpolation between two scenarios is not generally exact.
Precomputing every product, region, consumer and percentage combination would
grow with all those choices. Keep common published results ahead of time and
compute bounded custom combinations from the reusable matrices.

Decode numeric columns directly into typed arrays. Avoid creating an object or
array for every scalar. This follows the columnar approach described in
[Apache Arrow's Parquet performance guide](https://arrow.apache.org/blog/2022/12/26/querying-parquet-with-millisecond-latency/).
Keep calculation in a worker so the page can respond while it runs, as explained
in [web.dev's worker guide](https://web.dev/articles/off-main-thread).

The matrix URLs include content hashes. Range requests use normal HTTP caching
instead of forcing revalidation. A new dataset gets new matrix URLs; see
[MDN's cache-busting guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching).
Do not download the entire 916 MB export to warm a cache. Large, rarely used
assets should load when needed, as the
[Chrome runtime-caching guide](https://developer.chrome.com/docs/workbox/caching-resources-during-runtime/)
explains. Persistent browser storage, WebAssembly and GPU kernels need a measured
bottleneck before they justify another runtime or storage lifecycle here.

## Measure a change

With the prepared export present, compare against a committed implementation:

```sh
taskset -c 30,31 node measure-browser-engine.js bd8b71e docs/measurements/browser-engine.json /path/to/original/browser-engine /path/to/grouped/browser-engine
```

Choose CPUs available on the measurement machine. On macOS, omit `taskset`.
The last two arguments select the original and grouped exports. Without them,
both implementations use `data/browser-engine`, which compares code on one layout.
The script runs seven interleaved pairs in fresh Node processes for a one-product
case, the default 49-row scenario, and an 85-row manufacturing scenario. A fourth
case adds 150 ms of synthetic latency per read to the default scenario. It
records initialization, first and repeated calculation plus flow aggregation,
read bytes, peak RSS, source and manifest hashes, and host load. Files use the warm OS cache.
It measures the numerical/data path, not browser painting or network latency.
The [recorded diagnostics](measurements/browser-engine.json) came from a shared
machine; use them to locate costs, not to promise phone or network performance.

On 2026-11-01, Node 26.9.0 on an i9-14900KF, pinned to CPUs 30–31 on a shared host,
gave these default-case medians. The comparison includes the code changes since
`bd8b71e` and the grouped X/Y export:

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Data initialization | 1.21 s | 162 ms | −87% |
| First calculation and flow aggregation | 509 ms | 380 ms | −25% |
| Repeated calculation and flow aggregation | 69.0 ms | 48.7 ms | −29% |
| Peak process RSS | 373 MB | 236 MB | −37% |
| First calculation, 150 ms synthetic read delay | 1.40 s | 1.27 s | −10% |

The one-product first calculation increased from 167 ms to 188 ms. Its combined
initialization and first calculation decreased from 1.39 s to 349 ms. The 85-row
case improved from 813 ms to 551 ms. Results matched between implementations;
the separate parity test checks all 153 published scenarios. The raw record
includes every sample, ranges can be derived from it, and each implementation's
source hashes identify the measured code.
