# RaMa-Scene scenario explorer

A static page over **precomputed** RaMa-Scene engine output: a baseline and three
interventions on the EXIOBASE 2011 base year, three indicators, broken down by
the region where the impact occurs. Nothing here is a live calculation, and
nothing is a forecast: the engine changes final demand or technical
coefficients in the 2011 economy and has no projection step.

The repository ships **no result data**. `data/results.json` exists only after
the precompute below has run against the real dataset. `tests/fixture.json` is
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

Needs a RaMa-Scene checkout and the EXIOBASE matrices from
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196) at
`$DATASETS_DIR/2011/{A,L,Y,B}_v3.npy`.

```sh
uv run python precompute.py --run --engine ../ramascene-review --data "$DATASETS_DIR" --out data/results.json
```

`--run` is required because the technical-coefficient scenarios each invert a
dense 9800 × 9800 matrix: about 3.7 GB peak, one scenario at a time. The script
runs the baseline, each intervention, and a 0% control through the modified-A
path. It writes nothing unless every value is finite, each regional sum matches
`B_i · L · ΣY` recomputed outside the engine, and the control reproduces the
baseline. `data_kind` is `exiobase-v3` only if the engine also reproduces the
four Octave reference files shipped with RaMa-Scene.

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
