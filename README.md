# RaMa-Scene scenario explorer

A static page over **precomputed** RaMa-Scene engine output: a baseline, three
interventions and a 75-cell material-efficiency grid on the EXIOBASE 2011 base
year, three indicators, broken down by the region where the impact occurs. Nothing here is a live calculation, and
nothing is a forecast: the engine changes final demand or technical
coefficients in the 2011 economy and has no projection step.

`data/results.json`, `data/regions.json` and `data/flows.json` are the output
of one precompute run (engine `perf/lu-reuse-solve-order @ f876faa`, 2026-09-27;
see `data/run-log.md`; `data/precompute-time.txt` is the `/usr/bin/time -v`
output of that run: 3 min 12 s wall, 941,524 KiB (0.96 GB, 0.90 GiB) maximum RSS). Each file's `provenance` block records the engine
commit, the dataset checksums, the command and the run time, and the three
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
| `steel-in-vehicles-europe` | Coefficient of basic iron and steel (all origins) into motor-vehicle manufacturing in European regions, −20% | `Modelling.model_intermediates` (A), then `inv(I − A)` |
| `cement-in-construction` | Coefficient of cement, lime and plaster (all origins) into construction work in all regions, −20% | `Modelling.model_intermediates` (A), then `inv(I − A)` |

"European regions" is the `Europe` aggregate of the engine database: EU28 plus
Russia, Switzerland, Norway and Rest of Europe.

### Material-efficiency grid

Seventy-five more scenarios of one shape, defined as data in `precompute.py`
(`GRID_PRODUCTS`, `GRID_REGIONS`, `GRID_CUTS`, `grid_scenarios()`): the
technical coefficient of one product, from all regions, into **every industry
of one continental region** is scaled by the cut. Every industry in that region
then uses that much less of the product per unit of output; nothing else
changes. It is `cement-in-construction` with the consuming side widened from
one industry to the engine database's 15 industry sections (`consumedBy`
1–15, whose leaves are all 200 industries).

| axis | values (engine database ids) |
| --- | --- |
| product | Basic iron and steel and of ferro-alloys and first products thereof (180) · Aluminium and aluminium products (184) · Cement, lime and plaster (177) · Plastics, basic (162) · Electrical machinery and apparatus n.e.c. (196) |
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

The engine branch and commit are recorded in the output
(`provenance.engine.label`, for example `perf/lu-reuse-solve-order @ f876faa`),
with the solver in `provenance.engine.solver`.
`--engine` must be the top of a git checkout with a commit: the script
refuses to start otherwise (a copy without `.git`, or a directory inside some
other repository), so no output can claim `exiobase-v3` without naming its
engine. If the checkout's commit or dirty state changes during the run, it
writes nothing, as the workers would have run code the provenance cannot name.
The shipped files were produced with the fork branch
`perf/lu-reuse-solve-order` (checkout `../ramascene-c-lu-grid`, clean tree),
on top of `perf/lu-reuse` and `perf/solve-not-invert`. With an engine that
has `LeontiefLU`, `precompute.py` passes it to `Modelling`: each modified `A`
is factorized once, and the three routes and the per-region checks of that
scenario solve from the same factors instead of factorizing again on every
`L.dot` (`LeontiefSolve`). No two scenarios share an `A`, so the reuse is
within a scenario. `LeontiefLU` on that branch factorizes `(I − A)` itself, as
`np.linalg.solve` does, so the output is the same, bit for bit, as with
`perf/solve-not-invert` (below). With any other engine, `Modelling` keeps its
default. None of these branches is published; which engine version to cite is
the author's decision and is not made here.

Same grid (78 scenarios), same machine, one run at a time, each under
`flock /tmp/interview-heavy.lock /usr/bin/time -v`:

| engine | wall | max RSS | CPU |
| --- | --- | --- | --- |
| `perf/solve-not-invert @ a258e63` | 15 min 43 s | 1,621,328 KiB (1.55 GiB) | 2620% |
| `perf/lu-reuse-solve-order @ f876faa` | 3 min 12 s | 941,524 KiB (0.90 GiB) | 2159% |

`uv run python compare_data.py OLD_DATA_DIR NEW_DATA_DIR` compares two runs
value by value (every number in the three files, except provenance, run
timings and check residuals; relative 1e-12 by default). Between the two runs
above the largest difference is 0.

```sh
uv run python precompute.py --run --engine ../ramascene-c-lu-grid --data "$DATASETS_DIR" \
    --out data/results.json --out-regions data/regions.json --out-flows data/flows.json
# subsets: --scenarios original|grid, --limit N
```

`--run` is required because each technical-coefficient scenario works on a
dense 9800 × 9800 matrix: about 0.96 GB (0.90 GiB) peak per worker in the
shipped run, with the LU engine (1.66 GB, 1.55 GiB, with `perf/solve-not-invert`,
whose `np.linalg.solve` copies the matrix). The inverting engine peaked at 3.97 GB
per job, as measured in the solve-not-invert pull request description. Each
scenario runs in a fresh worker process (`precompute.py --worker`, one at a
time), so its wall time and peak RSS (`ru_maxrss`) are that process's, the
way the engine's own numbers were measured. The script first checks that the engine reproduces the four Octave
reference files shipped with RaMa-Scene (routes two and four; value added and
GHG) and stops, before any solve, if it does not. It then runs the baseline,
each scenario, and a 0% control through the modified-A path. Run-level
failures write nothing: a failed Octave check, a baseline that does not match
the independent calculation, a leaky control, or no scenario left. Every
scenario is held to:

- every value is finite;
- each region's value matches `B_i ∘ (L · ΣY)` recomputed outside the engine
  and summed over that region's countries (relative 1e-9);
- the control reproduces the baseline (relative 1e-6);
- every intervention moves at least one indicator total by more than
  relative 1e-9, and no cut raises an indicator total. The rise check applies only to indicators whose `B` row and `ΣY` have
  no negative entries; otherwise it is skipped with a warning and recorded.

A scenario that fails is recorded under `failed` with its reason and is not in
`results` or on the page; it is never dropped silently. Output that passes is
marked `data_kind: exiobase-v3`. Beside the JSON the script writes
`data/run-log.md`: engine, date, Octave reference count, per-scenario wall
time, peak RSS and check outcome.

## World map

Below the bar chart, a choropleth colours each country by the change in its
EXIOBASE region, as a percentage of that region's own baseline (diverging
blue/red around a grey "within ±E/20" class, E a round number at or above the
largest change). `data/regions.json` carries the 49-region breakdown
(`--out-regions`) of the baseline and the three original interventions,
computed inside the same worker as their continental values. A grid cell has
none (it would multiply the sidecars by 25) and falls back
to the five continental aggregates of `results.json`, and the page says so.
The five "Rest of …" regions are hatched: every country in one shares its
value. Which countries each covers follows Natural Earth continents (see
`REST_OF` in `map.js`); EXIOBASE's own concordance may differ at the edges.
`?region=<code>` highlights a region (click the map or use the picker).

## Supply-chain Sankey

`data/flows.json` (`--out-flows`) decomposes each original intervention's change by the
sector whose production carries the impact and the region where it occurs:
route three (Hotspot × Geographic, the same route as the map) run once per
level-2 product aggregate (15 sectors, which partition the 200 products) over
the 49 regions, intervention minus baseline. That gives 15 × 49 = 735 cells.
The 12 cells with the largest |change| are named; every other cell is added
to the flow between its sector (if named) or "Other sectors" and its region
(if named) or "Other regions". Nothing is dropped, so the flows sum to the
total change. precompute.py writes nothing unless the flows sum to the
total (relative 1e-12), the sectors sum to each region's value, and each
region matches B·L·ΣY (relative 1e-9). It is a production-side decomposition
of where the change lands, not a structural path analysis through the tiers
of the supply chain. "Replay from the baseline" animates the map and the
bands from no change to the intervention (instant under
`prefers-reduced-motion`).

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
uv run pytest --engine=../ramascene-c-lu-grid           # adds the real-engine adapter checks (768 MB)
node --test                                             # the page logic
```

| file | covers |
| --- | --- |
| `tests/test_precompute.py` | orchestration on a tiny injected engine: Octave gate, per-region check, 0% control, direction, failed scenarios, worker records, provenance (no engine commit refused, local paths scrubbed), CLI guards |
| `tests/test_grid.py` | the grid definition; the shipped `results.json` (every published scenario passed every check, 78 runs, 122 Octave values) |
| `tests/test_detail.py` | the 49-region and sector × region detail and its checks, the flow reconciliation, grid cells without detail; the shipped `regions.json` and `flows.json` (same run as `results.json`, checks passed, totals reconcile) |
| `tests/test_solver.py` | `apply_model` passes the engine's `LeontiefLU` when it has one and no solver argument otherwise; the solver in the provenance and run log |
| `tests/test_compare.py` | `compare_data.py`: tolerance, reported worst value, structure and label mismatches, CLI exit code |
| `tests/test_engine_plumbing.py` | the real engine adapter (ids, labels, region leaves, route three against B·L·ΣY), only with `--engine` |
| `tests/explorer.test.js` | URL state, `?data=` whitelist, banner, per-region comparison, axis ticks, number format, grid menu and pickers, run summary |
| `tests/map.test.js` | the 49-region table over the five aggregates, country-to-region mapping, Equal Earth projection, aggregate fallback, colour classes, `?region=` round trip |
| `tests/sankey.test.js` | links and nodes reconcile to the total change, node order and height, the replay tween, sector labels |
| `tests/live.test.js` | `?api=` origin rules, the job request body, a live result against its own job's baseline, live provenance, polling, the page unchanged without `?api=` |

Write `--engine=PATH` with the `=`: pytest otherwise takes the path as its root
directory and loads the engine's own `conftest.py`.

## View

Any static server, for example `python3 -m http.server`, then open
`http://localhost:8000/?scenario=steel-in-vehicles-europe&indicator=5` or
`?scenario=steel-europe-20&indicator=7`.
Add `data=tests/fixture.json` to see the page on the synthetic fixture. The
selection lives in the query string, so a view is shareable.

## Live scenarios (optional)

With `?api=<origin>` the page adds a "Run a custom scenario" panel that sends one
intervention (product, origin region, consuming sector, consuming region, change
in %) to the RaMa-Scene job API (`ramascene-jobs`) and polls for the result. The
result is compared with the baseline computed in the same job and labelled
"computed live by the job API — not precomputed", with its own provenance: engine
commit, dataset, the job's duration and peak memory.

Without `?api=` nothing changes: the panel stays hidden, its code is not loaded
and the page fetches only its own files (`data/*.json` and the map
geometry), so the static build stays static. The
parameter accepts a bare origin, `http://` only on loopback (a local run or an
SSH tunnel) and `https://` otherwise; anything else is ignored and reported in
the status line.

```sh
# job API on 127.0.0.1:8020 (see ramascene-jobs), this page on 8000
python3 -m http.server 8000
# then open http://127.0.0.1:8000/?api=http://127.0.0.1:8020
```

`live.js` holds the logic (`node --test` covers it); `live-panel.js` the DOM.
