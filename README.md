# RaMa-Scene scenario explorer

A static page over **precomputed** RaMa-Scene engine output: a baseline and three
interventions on the EXIOBASE 2011 base year, three indicators, broken down by
the region where the impact occurs. Nothing here is a live calculation, and
nothing is a forecast: the engine changes final demand or technical
coefficients in the 2011 economy and has no projection step.

`data/results.json` is the output of one run of the precompute below against
the real dataset; its `provenance` block records the engine commit, the dataset
checksums and the command. Nothing else in the repository is a result. `tests/fixture.json` is
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

## Generate the data

Needs a RaMa-Scene checkout and the matrices of **EXIOBASE v3.3.sm** (Franco
Donati and Arjan de Koning, Zenodo version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)): the
monetary product-by-product EXIOBASE v3.3 with materials produced by
secondary technologies (recycling industries) represented explicitly. The
engine reads them as `$DATASETS_DIR/2011/{A,L,Y,B}_v4.npy`; the Zenodo record ships only `_v4`
files, and `v4` is the file suffix, not the dataset version. The matrices are
float64.

The engine commit and branch are recorded in the output. The branch of
`../ramascene-review` is not published; which engine version to cite (that
branch or the published RaMa-Scene repository) is the author's decision and
is not made here.

```sh
uv run python precompute.py --run --engine ../ramascene-review --data "$DATASETS_DIR" --out data/results.json
```

`--run` is required because the technical-coefficient scenarios each invert a
dense 9800 × 9800 matrix: about 4.0 GB peak, one scenario at a time. The script
first checks that the engine reproduces the four Octave reference files
shipped with RaMa-Scene (routes two and four; value added and GHG) and stops,
before any inversion, if it does not. It then runs the baseline, each
intervention, and a 0% control through the modified-A path, and writes
nothing unless:

- every value is finite;
- each region's value matches `B_i ∘ (L · ΣY)` recomputed outside the engine
  and summed over that region's countries (relative 1e-9);
- the control reproduces the baseline (relative 1e-6);
- every intervention changes the result, and no −20% cut raises an indicator
  total. The rise check applies only to indicators whose `B` row and `ΣY` have
  no negative entries; otherwise it is skipped with a warning and recorded.

Output that passes is marked `data_kind: exiobase-v3`.

## Test

```sh
uv run pytest                                           # script logic on tiny injected matrices
uv run pytest --engine=../ramascene-review              # adds the real-engine adapter checks (768 MB)
node --test                                             # URL state, banner, axis ticks, number format
```

Write `--engine=PATH` with the `=`: pytest otherwise takes the path as its root
directory and loads the engine's own `conftest.py`.

## View

Any static server, for example `python3 -m http.server`, then open
`http://localhost:8000/?scenario=steel-in-vehicles-europe&indicator=5`.
Add `data=tests/fixture.json` to see the page on the synthetic fixture. The
selection lives in the query string, so a view is shareable.
