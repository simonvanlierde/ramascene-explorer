# Compute a scenario in the browser

Open the page with `?compute=1`, switch to What if…, then open Custom scenario.
Choose a product, its origin, a consuming industry and region, and a percentage
change. Run scenario computes the result on your device. Choose
`Y: Final Consumption` to change final demand instead of a technical coefficient.
If `?api=` is also present, the job API takes precedence.

The result lights the map, sentence, continent totals and Details. Its label says
"computed in this browser, not precomputed". The shared link keeps the last
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
It also stores `M = B L`, Y, X and the three selected B rows. Final-demand
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

The prepared export is a `data-2011` release asset, about 920 MB:

```sh
gh release download data-2011 --repo simonvanlierde/ramascene-explorer --pattern ramascene-browser-engine.tar --dir data
sha256sum --check data/browser-engine.sha256
tar -xf data/ramascene-browser-engine.tar -C data
```

The build includes the data when present. CI and publishing download and verify
the archive. The full site is about 973 MB; the Pages build refuses 1 GB or more.
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
