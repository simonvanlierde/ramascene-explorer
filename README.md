# RaMa-Scene scenario explorer

A static, map-first page over **precomputed** RaMa-Scene engine output on the
EXIOBASE 2011 base year: where a country's consumption causes greenhouse-gas
emissions, jobs and metal-ore extraction, split by 15 industry sections, and
what one intervention (three named ones and a 150-cell material-efficiency
grid) would have changed. Nothing here is a live calculation, and nothing is a
forecast: the engine changes final demand or technical coefficients in the
2011 economy and has no projection step.

`data/results.json`, `data/regions.json`, `data/flows.json` and
`data/embodied.parquet` are the output of one precompute run (engine
`split/3-performance @ d9113ca`, the head of
[CMLPlatform/ramascene#74](https://github.com/CMLPlatform/ramascene/pull/74), 2026-10-14;
see `data/run-log.md`; `data/precompute-time.txt` is the `/usr/bin/time -v`
output of that run: 153 scenarios, 1 min 32 s wall, 1,602,340 KiB (1.64 GB, 1.53 GiB) maximum RSS,
under `nice -n 10` with BLAS capped at 8 threads on a 32-core machine). Each file's `provenance` block records the engine
commit, the dataset checksums, the command and the run time, and the four
blocks are identical. Re-run the precompute below to regenerate them. Nothing
else in the repository is a result. `tests/fixture.json` is
hand-shaped synthetic data for testing the page, and the page shows a red
"SYNTHETIC TEST DATA — NOT A RESULT" banner for anything whose `data_kind` is
not `exiobase-v3`.

## Scenarios

Each scenario is one RaMa-Scene `model_details` intervention, stored verbatim in
the output. `ramascene/modelling.py` scales the selected cells by
`1 + techChange/100`. No substitution, price or rebound effect is modelled.

| id | What it changes | Engine path |
| --- | --- | --- |
| `vehicle-demand-europe` | Final demand in European regions for motor vehicles produced in European regions, −20% | `Modelling.model_final_demand` (Y), stored L |
| `steel-in-vehicles-europe` | Coefficient of basic iron and steel (all origins) into motor-vehicle manufacturing in European regions, −20% | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |
| `cement-in-construction` | Coefficient of cement, lime and plaster (all origins) into construction work in all regions, −20% | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |

"European regions" is the `Europe` aggregate of the engine database: EU28 plus
Russia, Switzerland, Norway and Rest of Europe.

### Material-efficiency grid

150 more scenarios of one shape, defined as data in `precompute.py`
(`GRID_PRODUCTS`, `GRID_REGIONS`, `GRID_CUTS`, `grid_scenarios()`): the
technical coefficient of one product, from all regions, into **every industry
of one continental region** is scaled by the cut. Every industry in that region
then uses that much less of the product per unit of output; nothing else
changes. It is `cement-in-construction` with the consuming side widened from
one industry to the engine database's 15 industry sections (`consumedBy`
1–15, whose leaves are all 200 industries).

| axis | values (engine database ids) |
| --- | --- |
| product | Basic iron and steel and of ferro-alloys and first products thereof (180) · Aluminium and aluminium products (184) · Cement, lime and plaster (177) · Plastics, basic (162) · Electrical machinery and apparatus n.e.c. (196) · Copper products (188) · Glass and glass products (173) · N-fertiliser (164) · Chemicals nec (166) · Rubber and plastic products (172) |
| region | Europe (2) · Middle-East (3) · America (4) · Asia-Pacific (5) · Africa (6), the five continental aggregates |
| cut | −10 %, −20 %, −50 % |

Scenario ids are `<product>-<region>-<cut>`, for example `steel-europe-20`.
The page picks a grid cell by product, region and cut; the three original
interventions stay in the same menu.

## Generate the data

Needs a RaMa-Scene checkout and the matrices of **EXIOBASE v3.3.sm** (Franco
Donati and Arjan de Koning, Zenodo version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)): the
monetary product-by-product EXIOBASE v3.3 with materials produced by
secondary technologies (recycling industries) represented explicitly. The
engine reads them as `$DATASETS_DIR/2011/{A,L,Y,B}_v4.npy`; the Zenodo record ships only `_v4`
files, and `v4` is the file suffix, not the dataset version. The matrices are
float64.

The engine repository, branch and commit are recorded in the output
(`provenance.engine`, with `label` such as `split/3-performance @ d9113ca`, and
`pull_request` when `--engine-pr` is given). Each run records the class of the
`L` the engine returned (`runs.<id>.solver`), and `provenance.run.solvers`
counts them.
`--engine` must be the top of a git checkout with a commit: the script
refuses to start otherwise (a copy without `.git`, or a directory inside some
other repository), so no output can claim `exiobase-v3` without naming its
engine. If the checkout's commit or dirty state changes during the run, it
writes nothing, as the workers would have run code the provenance cannot name.

The shipped files were produced with branch `split/3-performance` of the fork
<https://github.com/simonvanlierde/ramascene>, commit
`d9113ca9ad38bc29d2a96392dabf74d70abf830e` (clean tree), the head of pull
request [#74](https://github.com/CMLPlatform/ramascene/pull/74), which is
stacked on #73 (the Django 5.2 upgrade). `precompute.py` calls `Modelling` as
`tasks.execute_calc` does and passes no solver: the engine picks it. When at
most 2,000 rows of `A` change and the result passes the engine's residual check
(`‖x − A x − y‖ ≤ 1e-9 ‖y‖` for `y = 1`), `Modelling` returns a
`LowRankLeontief`, a Woodbury update of the stored `L`: each `L.dot` is one
product with `L` plus a small solve, with no factorization. Otherwise it
returns a `LeontiefSolve`, which factorizes `(I − A)` once and solves from
those factors. In the shipped run all 152 technical-coefficient scenarios and
the control took the Woodbury update, and the final-demand scenario used the
stored `L`; no run factorized `(I − A)`.

The full 153-scenario run, before and after:

| engine | wall | max RSS | CPU |
| --- | --- | --- | --- |
| `perf/lu-reuse-solve-order @ f876faa` (2026-09-27, unpublished, since lost) | 10 min 20 s | 942,020 KiB (0.90 GiB) | 2333%, machine load above 40 |
| `split/3-performance @ d9113ca` (2026-10-13, PR #74) | 1 min 16 s | 1,609,984 KiB (1.54 GiB) | 620%, 8 BLAS threads |
| the same, adding `--out-embodied` (2026-10-14) | 1 min 32 s | 1,602,340 KiB (1.53 GiB) | 769%, 8 BLAS threads |

Adding `--out-embodied` left every value in the three JSON files exactly as it
was (`compare_data.py`, largest relative difference 0).

`uv run python compare_data.py OLD_DATA_DIR NEW_DATA_DIR` compares two runs
value by value (every number in the three files, except provenance, run
timings and check residuals; relative 1e-12 by default). Between the two runs
above the largest relative difference is 3.4e-14 in `results.json` and
4.1e-13 in `regions.json`. In `flows.json` it is 3.1e-10, on the change in a
flow, a difference of two nearly equal values; 120 of its 638 values differ by
more than 1e-12 and none by more than 1e-9.

```sh
# the command data/results.json records, verbatim
uv run python precompute.py --run --engine "$ENGINE_DIR" --engine-pr https://github.com/CMLPlatform/ramascene/pull/74 --data "$DATASETS_DIR" --out data/results.json --out-regions data/regions.json --out-flows data/flows.json --out-embodied data/embodied.parquet
# subsets: --scenarios original|grid, --limit N
```

`--run` is required because each technical-coefficient scenario works on a
dense 9800 × 9800 matrix: about 1.65 GB (1.54 GiB) peak per worker in the
shipped run. The engine memory-maps `L` and maps `A` copy-on-write, so much of
that is file pages the workers share through the page cache, which each
worker's RSS still counts. The original inverting engine peaked at 3.97 GB per job. Each
scenario runs in a fresh worker process (`precompute.py --worker`, one at a
time), so its wall time and peak RSS (`ru_maxrss`) are that process's, the
way the engine's own numbers were measured. The script first checks that the engine reproduces the four Octave
reference files shipped with RaMa-Scene (routes two and four; value added and
GHG) and stops, before any solve, if it does not. It then runs the baseline,
each scenario, and a 0% control through the modified-A path. With the
PR #74 engine the control is a Woodbury update with a zero change, which
returns the stored `L` exactly, so it does not exercise the factorization
path. Run-level
failures write nothing: a failed Octave check, a baseline that does not match
the independent calculation, a leaky control, or no scenario left. Every
scenario is held to:

- every value is finite;
- each region's value matches `B_i ∘ (L · ΣY)` recomputed outside the engine
  and summed over that region's countries (relative 1e-9);
- the control reproduces the baseline (relative 1e-9);
- every intervention moves at least one indicator total by more than
  relative 1e-9, and no cut raises an indicator total. The rise check applies only to indicators whose `B` row and `ΣY` have
  no negative entries; otherwise it is skipped with a warning and recorded.

A scenario that fails is recorded under `failed` with its reason and is not in
`results` or on the page; it is never dropped silently. Output that passes is
marked `data_kind: exiobase-v3`. Beside the JSON the script writes
`data/run-log.md`: engine, date, Octave reference count, per-scenario wall
time, peak RSS and check outcome.

## The page

The page reads `data/results.json` (scenarios, continental totals, checks and
provenance) and the embodied flows below. It shows one question at a time:

- **Flows, 2011.** A sentence names the selected country's footprint (or what
  it releases), with the country and the indicator as controls inside it. The
  map draws the largest flows as tapered bands, thin where a flow leaves and
  wide where it arrives, and fills each region by its flow with the selected
  country. Flat (Equal Earth) or a globe.
- **Industry rail.** One tab per section, its height the section's share of
  the selection. A click isolates one section, further clicks add or remove.
  Every number on the page follows the selection, in both modes.
- **What if… .** The bands keep their 2011 width and take the run's % change
  on a square-root scale fitted to the run (98% of flows inside). A scrubber
  runs from the 2011 baseline to the run and replays on every switch; the
  strip shows the change released in each of the five continents.
- **Details.** A Sankey (released in → industry → consumed in), the same
  flows as a sortable table, and the method with every check.

The selection lives in the query string (`mode`, `scenario`, `indicator`,
`region`, `dir`, `sections`, `map`, `panel`), so every view can be shared;
links from the first version (`?scenario=&indicator=&region=`) still land.
The five "Rest of …" regions merge their Natural Earth countries (see
`REST_OF` in `map.js`); EXIOBASE's own concordance may differ at the edges.

## Detail sidecars

`data/regions.json` (`--out-regions`, the 49-region values of the baseline and
the three original interventions) and `data/flows.json` (`--out-flows`, each
original intervention's change by sector and region, 15 × 49 cells) are still
written and checked by the precompute: the regions match B·L·ΣY (relative
1e-9), the sectors sum to each region and the flows to the total (relative
1e-12). The page no longer reads them: the embodied flows hold the same
breakdowns for every run and are checked against them.

## Embodied flows

At 51.5 MB it stays out of git. It is the `embodied.parquet` asset of the
[`data-2011`](https://github.com/simonvanlierde/ramascene-explorer/releases/tag/data-2011)
release, and the Pages build downloads it from there and checks its SHA-256.
To get it locally:

```sh
gh release download data-2011 --pattern embodied.parquet --dir data
```

`data/embodied.parquet` (`--out-embodied`) holds, for the baseline and every
published scenario, the flows embodied in final demand: what each producer
country releases, per section, for the final demand of each consumer country.
A flow is `B_i ∘ (L · Y)` summed over the products of one section, with one
column of `Y` per consumer country. Sections are the 15 level-2 product
aggregates of the engine database. Each scenario's flows come
from its own `Y` and `L`, in the same worker as its other results.

The file is long format, one row group per run: `run`, `indicator` (global
id), `producer`, `section`, `consumer` (0-based, in engine order) and `value`.
The baseline row group holds absolute values. Every other row group holds the
change, scenario minus baseline. A cell that is exactly 0 is left out, so a
missing row means no flow or no change. The values are float32 with
byte-stream-split encoding and snappy compression, so a browser can read the
footer and one run over HTTP range requests (about 0.33 MB per run, of 51.5
MB). The footer's `ramascene` key holds JSON: country and section names, the
continental aggregates, units, the run ids in row-group order, the checks and
the same provenance as the other files.

Nothing is written unless:

- for every run, the flows summed by producer and continental aggregate match
  that run's values in `results.json`, and the world totals match (relative
  1e-9);
- for the baseline and the three original interventions, the flows summed by
  producer country match the engine's 49-region values (relative 1e-9);
- the float32 values sum to within relative 1e-6 of the float64 ones, per
  producer and in total, relative to the run's total or total change. The
  page shows three significant digits.

Cells that rise in a scenario are counted and recorded, not refused. In the
shipped run none rose, the largest difference in the first two checks was
9.2e-16, and the float32 error was 2.6e-8.

The fonts are Public Sans and Spectral (SIL Open Font License 1.1), latin
subset, from the `@fontsource` packages. Vite bundles them into `dist/`, so
the page loads nothing from a third party.

`geo/countries-110m.topo.json` is Natural Earth 1:110m Admin 0 – Countries,
**v5.1.2** (public domain), from
`nvkelso/natural-earth-vector` tag `v5.1.2`, `geojson/ne_110m_admin_0_countries.geojson`
(sha256 `6866c877…c977f`). Properties reduced to `iso` (`ISO_A2_EH`; Somaliland
as `SO`, N. Cyprus `null`) and `name`; Antarctica and the French Southern
Lands dropped; converted with `geo2topo -q 1e4` (topojson-server 3.0.1).
Malta is below the 1:110m threshold and appears only in the table.

## Test

```sh
uv run pytest                                           # everything below except the engine adapter
uv run pytest --engine="$ENGINE_DIR"                    # adds the real-engine adapter checks (768 MB)
node --test                                             # the page logic
```

| file | covers |
| --- | --- |
| `tests/test_precompute.py` | orchestration on a tiny injected engine: Octave gate, per-region check, 0% control, direction, failed scenarios, worker records, provenance (no engine commit refused, local paths scrubbed), CLI guards |
| `tests/test_grid.py` | the grid definition; the shipped `results.json` (every published scenario passed every check, 78 runs, 122 Octave values) |
| `tests/test_detail.py` | the 49-region and sector × region detail and its checks, the flow reconciliation, grid cells without detail; the shipped `regions.json` and `flows.json` (same run as `results.json`, checks passed, totals reconcile) |
| `tests/test_embodied.py` | the embodied flows: aggregation into sections, the checks that refuse to write, rises recorded, a Parquet round trip; the shipped `embodied.parquet` (same run as `results.json`, one row group per run, every run reconciles with `results.json`) |
| `tests/test_solver.py` | `apply_model` passes no solver argument; each run records the class of its `L`, counted in the provenance and named in the run log with the pull request |
| `tests/test_compare.py` | `compare_data.py`: tolerance, reported worst value, structure and label mismatches, CLI exit code |
| `tests/test_engine_plumbing.py` | the real engine adapter (ids, labels, region leaves, route three against B·L·ΣY), only with `--engine` |
| `tests/embodied.test.js` | reading the Parquet: one row group per run, dense decoding, one run fetches only its own bytes; with `data/embodied.parquet`, producer sums match `regions.json` |
| `tests/flows.test.js` | a selection's sums in both directions and per section, the fitted change scale, bands that taper along the flow, the Sankey carrying the whole selection, run wording, units, the query string (old links included); with the real data, the five continents match `results.json` |
| `tests/explorer.test.js` | `?data=` whitelist, banner, run matching, per-region comparison and number format for the live panel, grid pickers, run summary |
| `tests/map.test.js` | the 49-region table over the five aggregates, country-to-region mapping |
| `tests/e2e/page.spec.js` | the built page in a browser: map, sentence, rail, country box, What if…, Details, URL state, axe WCAG 2.2 AA (light, dark, phone) |
| `tests/live.test.js` | `?api=` origin rules, the job request body, a live result against its own job's baseline, live provenance, polling, the page unchanged without `?api=` |

Write `--engine=PATH` with the `=`: pytest otherwise takes the path as its root
directory and loads the engine's own `conftest.py`.

## View

The page is Svelte 5, built with Vite. Install once with `pnpm install`, then:

```sh
pnpm dev        # dev server with live reload, on http://localhost:5173/
pnpm build      # static site in dist/, with relative paths
pnpm preview    # serves dist/ on http://127.0.0.1:4180/
```

Open `?mode=whatif&scenario=steel-in-vehicles-europe` or
`?region=CN&dir=out&indicator=7&sections=2`.
Add `data=tests/fixture.json` to see the page on the synthetic fixture (its
flows are `tests/fixture-embodied.parquet`, written by
`uv run python -m tests.make_fixture_embodied`). The dev server and the
preview serve both; the build leaves them out.
`dist/` works from any static server and under any subpath. The
selection lives in the query string, so a view is shareable. GHG emissions
and metal-ore extraction are shown in megatonnes (the data holds kg CO2 eq
and kt), employment in persons (the data holds thousands of persons).

## Live scenarios (optional)

With `?api=<origin>` the page adds a "Run a custom scenario" panel that sends one
intervention (product, origin region, consuming sector, consuming region, change
in %) to the RaMa-Scene job API (`ramascene-jobs`) and polls for the result. The
result is compared with the baseline computed in the same job and labelled
"computed live by the job API — not precomputed", with its own provenance: engine
commit, dataset, the job's duration and peak memory.

Without `?api=` nothing changes: the panel is not there, its code is not loaded
and the page fetches only its own files (`data/results.json`,
`data/embodied.parquet`, the map geometry and the fonts), so the static build stays static. The
parameter accepts a bare origin, `http://` only on loopback (a local run or an
SSH tunnel) and `https://` otherwise; anything else is ignored and reported in
the status line.

```sh
# job API on 127.0.0.1:8020 (see ramascene-jobs), this page on 5173
pnpm dev
# then open http://localhost:5173/?api=http://127.0.0.1:8020
```

`live.js` holds the logic (`node --test` covers it); `src/LivePanel.svelte` the
panel, the only code that talks to the API.

## Licence

The code is under the MIT licence (`LICENSE`), © 2026 Simon van Lierde.

The result files in `data/` are computed from **EXIOBASE v3.3.sm** by Franco
Donati and Arjan de Koning (Zenodo, version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)), which
the Zenodo record publishes under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
The results are a changed version of that dataset: each file holds scenario
totals computed from its matrices, not the matrices themselves. They are
shared under CC BY 4.0 too. Reuse them with credit to EXIOBASE v3.3.sm and
its authors, as above, and say that they were changed.

The fonts and the map geometry keep their own terms, given above (SIL Open
Font License 1.1; Natural Earth, public domain).

## CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest`, `node --test`,
`pnpm build` and `pnpm exec playwright test` on every push and pull request. None needs the
dataset: the engine checks skip without `--engine`, the page tests read the
synthetic fixtures, and the browser tests load the built page over the fixtures and
the shipped results (the browser job downloads `embodied.parquet` from the
release and checks its SHA-256), in light, dark and phone layouts, with axe
checking WCAG 2.2 AA. `hygiene.yml` runs the
git hooks in `.pre-commit-config.yaml` and reviews new dependencies on pull
requests.

`pages.yml` publishes to GitHub Pages only when started by hand (Actions →
pages → Run workflow). It runs `pnpm build` and ships `dist/`: the bundled
page and fonts, the map geometry, `results.json` and `embodied.parquet`, and nothing else. It stops if `data/results.json` is
missing or isn't marked `data_kind: exiobase-v3`, so the synthetic fixture can
never go out. Commit the precompute output first, and set the repository's
Pages source to GitHub Actions.
