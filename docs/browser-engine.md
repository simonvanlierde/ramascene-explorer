# Compute a scenario in the browser

Switch to What if…, then open Custom scenario.
Choose a product, its origin, a consuming industry and region, and a percentage
change. Run scenario computes the result on your device. Choose **Final demand**
to change spending. An industry selection changes inputs per unit of monetary
output.
The catalogue records this final-demand category as `Y: Final Consumption`.
If `?api=` is also present, the job API takes precedence.

The result lights the map, sentence, world-region totals and Details. Its label says
"computed in this browser". The shared link keeps the last
precomputed scenario, so reopening it does not reconstruct the custom calculation.

The calculation runs in a worker. When the form opens, it downloads the
manifest: the catalogue, the baseline flows and the store's layout. A scenario
then downloads only the rows it needs: the changed rows of A, the part of L that
links the changed rows to their consumers, one row of flow totals for each
changed row, and the matching rows of baseline output X and final demand Y.

While the form is open, those downloads start half a second after the selection
last changed, so Run waits only for what is still loading. A new percentage reads the
same rows, so it starts nothing new. One selection downloads at a time; while it does,
only the newest waits, so quick changes waste at most one download.

While a scenario runs, the form shows the seconds elapsed and a Cancel button, which
stops the worker and starts a fresh one. A worker that runs out of memory, or passes
the two-minute limit, is replaced the same way, and its error stays on screen.

The 155 published scenarios match RaMa-Scene's shipped results at relative 1e-6
in CI. That checks the implementation, not a custom scenario's assumptions.

The model has the same scope as the [published scenarios](scenarios.md): changes
to the 2011 economy, without forecasts, substitution or rebound. It accepts up
to ten interventions. Broad changes and singular systems are refused with an
error instead of returning a result.

The work grows with the changed product–country pairs (R: one product from one
producing country, a row of A) and the consuming columns they feed (K: one industry in one consuming
country). Before reading matrices, the form and the worker estimate three costs
from the catalogue and the manifest alone, and refuse a scenario that would:

- download more than 160 MiB,
- hold more than 256 MiB of float64 working arrays, or
- need more than 10 billion multiply-adds, counted as if every coefficient were nonzero.

The form says so before Run, with the pair count. Manufacturing used by
electricity in every country (4,165 pairs into 1,078 columns) and one country's
whole final demand (9,800 pairs) both fit. Every product from every country, or
Europe's manufacturing feeding every European industry, does not: choose a narrower
product, fewer producing countries, or fewer industries or regions that use it. The [job API](interface.md#job-api) remains available for
work outside the browser budget. The memory estimate includes the matrix copies
used for the coefficient update, transpose, solve and final-demand changes, the
WebAssembly kernel's own copies of ΔA, L[K, R] and X₀[K, :], plus overlapping flow batches. It excludes the baseline, metadata, row caches and
decoder buffers; it is not a total browser memory limit.

A broad scenario can take several seconds on a desktop, and longer on a phone:
see [the measurements](#measure-a-change). The worker keeps at most 16 MiB of
decoded rows per array, least recently used first out, so a repeated selection
may read some rows again.

## Data and method

The input is EXIOBASE v3.3.sm (2011) by Franco Donati and Arjan de Koning,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196), under
CC BY 4.0. The exported matrices and baseline flows have the same licence.

For `A′ = A + ΔA`, with R the changed rows and K their consuming columns, the
worker computes

```text
X₀ = X + L[:, F] ΔY[F, :]            (F: rows whose final demand changes)
W  = (I − ΔA L[K, R])⁻¹ ΔA X₀[K, :]   or, the same, ΔA (I − L[K, R] ΔA)⁻¹ X₀[K, :]
X′ = X₀ + L[:, R] W
```

It solves whichever system is smaller, R × R or K × K, in float64, in a Rust
kernel (`engine/`) compiled to WebAssembly, which also adds `H[J]ᵀ Z`. The page
draws flows `G X′`, where G sums each indicator over the products of a section
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

Values are float32 with gzip. Storing float32 moves the 153 published
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
with the whole file, and the Worker refuses them.

## Build or download the data

From the explorer, with the RaMa-Scene arrays and its label database available:

```sh
OPENBLAS_NUM_THREADS=8 uv run python export_browser.py --data /path/to/datasets --db /path/to/db.sqlite3 --out data/browser-engine
```

Use a new output directory. The export refuses an existing manifest. It checks
the input hashes against the published dataset, checks the baseline residual of
`(I − A) X = Y` at relative 1e-9, and checks that H reproduces the baseline flows,
before writing. The store directory is named `store-<hash>`, where the hash
covers every file's path and SHA-256, and `manifest-v3.json` names it. Changed
data therefore gets different URLs. The reader refuses the earlier row layouts,
and version 3 uses a new manifest name, so a cached older manifest cannot reach
the new reader. The worker revalidates the manifest, and a tab that still holds
an older one gets a 404 for the removed store and asks for a reload. The export
takes about 10 s with 8 threads.

The store is a separate `data-2011` release asset, 803 MB. The earlier
`ramascene-browser-engine*.tar` assets remain for the older layouts. Move any
existing `data/browser-engine` directory aside before extraction, so the build
contains only the selected export.

```sh
gh release download data-2011 --repo simonvanlierde/ramascene-explorer --pattern ramascene-browser-engine-zarr.tar --dir data
sha256sum --check data/browser-engine-zarr.sha256
tar -xf data/ramascene-browser-engine-zarr.tar -C data
```

The build includes the data when present. CI and publishing download and verify
the archive. The Pages build refuses a site of 1 GB or more. The browser fetches
only the data a calculation needs. The desktop and phone smoke test bounds that
transfer at 50 MB for the default steel scenario.

## Check the calculations

```sh
BROWSER_ENGINE_DATA=data/browser-engine pnpm test
node brightway-check/browser_check.js data/browser-engine
CI=1 pnpm exec playwright test tests/e2e/browser-engine.spec.js
```

The first command checks all 155 scenarios against `data/results.json` at relative
1e-6. The second checks the agreement table's Dutch cement footprint, from H, at
relative 1e-6. The browser test checks the worker, map, source label, retry and
absence of external requests.

## What to precompute

The page uses a hybrid approach. The published scenarios and their map flows
are computed ahead of time. Browsing them never runs the browser solver. The
custom route also reuses the precomputed inverse L, its flow totals H, baseline X
and baseline flows. It solves only the small system for the selected changes.

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
explains. The WebAssembly kernel does the small system's dense products with faer's
matrix routines, without wasm SIMD, which measured no faster. It also decodes the
stored chunks, with flate2's zlib-rs backend: about 306 MB/s of output, against about
150 MB/s for gunzip in JavaScript, which took manufacturing used by electricity from
3.52 s to 2.60 s. WebAssembly memory grows to the largest scenario run in a
tab and is not returned until the worker restarts. Persistent browser storage and GPU
kernels have no measured bottleneck to justify them.

## Measure a change

With the prepared export present:

```sh
taskset -c 30,31 node measure-browser-engine.js docs/measurements/browser-engine-zarr.json
```

Choose CPUs available on the measurement machine. On macOS, omit `taskset`.
The script runs five fresh Node processes per case, each with a first and a
repeated calculation including flow aggregation, and records read bytes and
requests, peak RSS and host load. One case adds 150 ms of synthetic latency per
read. Files come from the warm OS cache, so it measures the numerical and data
path, not browser painting or a CDN.

The [recorded diagnostics](measurements/browser-engine-wasm.json) used Node
26.9.0 on an i9-14900KF, pinned to CPUs 30–31 on a shared machine, on
2026-11-01. Medians of the first calculation, against the
[JavaScript kernel's](measurements/browser-engine-zarr.json) from the same day:

| Case | Rows × columns | Read | JavaScript | WebAssembly |
| --- | ---: | ---: | ---: | ---: |
| one product in one country | 1 × 1 | 0.09 MB | 12 ms | 11 ms |
| default steel scenario | 49 × 32 | 4.33 MB | 116 ms | 70 ms |
| default, 150 ms per read | 49 × 32 | 4.33 MB | 847 ms | 362 ms |
| steel used by every European industry | 49 × 6,400 | 5.02 MB | 207 ms | 125 ms |
| electricity used by manufacturing, everywhere | 1,078 × 4,165 | 43.2 MB | 2.31 s | 1.07 s |
| manufacturing used by electricity, everywhere | 4,165 × 1,078 | 135 MB | 9.97 s | 2.60 s |
| China's whole final demand | 9,800 final-demand rows | 65.0 MB | 1.99 s | 813 ms |

The WebAssembly column also gains from 64 parallel ranges per array and the
faster chunk check, which the JavaScript record predates. Peak memory of the
largest case rose from 484 MB to 497 MB, because the kernel holds its own copies
of ΔA and L[K, R].

The [earlier row layout's diagnostics](measurements/browser-engine-rows.json)
used a paired method, so compare them with care. Use these numbers to locate
costs, not to promise phone or network performance.
