# RaMa-Scene scenario explorer

A static page over **precomputed** RaMa-Scene engine output: a baseline, three
interventions and a 75-cell material-efficiency grid on the EXIOBASE 2011 base
year, three indicators, broken down by the region where the impact occurs. Nothing here is a live calculation, and
nothing is a forecast: the engine changes final demand or technical
coefficients in the 2011 economy and has no projection step.

`data/results.json` is the output of one precompute run (engine
`perf/solve-not-invert @ a258e63`, 2026-09-27; see `data/run-log.md`). Re-run
the precompute below to regenerate it. `tests/fixture.json` is
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
(`provenance.engine.label`, for example `perf/solve-not-invert @ a258e63`).
The shipped `data/results.json` was produced with the fork branch
`perf/solve-not-invert` (checkout `../ramascene-pr2`), whose `apply_model`
returns a `LeontiefSolve` that solves `(I − A) x = y` instead of forming the
inverse. That branch is not published; which engine version to cite is the
author's decision and is not made here.

```sh
uv run python precompute.py --run --engine ../ramascene-pr2 --data "$DATASETS_DIR" --out data/results.json
# subsets: --scenarios original|grid, --limit N
```

`--run` is required because each technical-coefficient scenario works on a
dense 9800 × 9800 matrix: about 1.6 GB (1.53 GiB) peak per worker in the
shipped run, with the solving engine. The inverting engine peaked at 3.97 GB
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
- every intervention changes the result, and no cut raises an indicator
  total. The rise check applies only to indicators whose `B` row and `ΣY` have
  no negative entries; otherwise it is skipped with a warning and recorded.

A scenario that fails is recorded under `failed` with its reason and is not in
`results` or on the page; it is never dropped silently. Output that passes is
marked `data_kind: exiobase-v3`. Beside the JSON the script writes
`data/run-log.md`: engine, date, Octave reference count, per-scenario wall
time, peak RSS and check outcome.

## Test

```sh
uv run pytest                                           # script logic on tiny injected matrices; grid definition; shipped results
uv run pytest --engine=../ramascene-pr2                 # adds the real-engine adapter checks (768 MB)
node --test                                             # URL state, banner, pickers, axis ticks, number format
```

Write `--engine=PATH` with the `=`: pytest otherwise takes the path as its root
directory and loads the engine's own `conftest.py`.

## View

Any static server, for example `python3 -m http.server`, then open
`http://localhost:8000/?scenario=steel-in-vehicles-europe&indicator=5` or
`?scenario=steel-europe-20&indicator=7`.
Add `data=tests/fixture.json` to see the page on the synthetic fixture. The
selection lives in the query string, so a view is shareable.
