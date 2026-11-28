# What each scenario changes

Each scenario asks how one change would have affected the 2011 economy.

## The 2011 baseline

The baseline is the unchanged EXIOBASE v3.3.sm economy for 2011, as RaMa-Scene's engine computes
it from the original inputs. No input requirement, final demand or indicator intensity is changed.

- Every published scenario is compared with the published baseline run.
- A custom scenario computed in the browser is compared with the browser store's copy of the
  published baseline, held within relative 1e-6 of it.
- A custom scenario computed by a job API is compared with the baseline from its own job.

## Two kinds of change

- **An industry's input requirement:** how much of one product an industry buys per unit of its
  monetary output, its technical coefficient. A 20% cut means 20% less of that input per unit of
  output. The resulting change in total use is a model result, not a preset cut.
- **Final demand:** what households, governments and investors spend on a product. A 20% cut
  means 20% less spending on it, in money, not in units bought.

Prices and all other coefficients stay fixed, and no substitution, price or rebound effect is modelled.

Each scenario is one RaMa-Scene `model_details` intervention, stored exactly in the output.
`ramascene/modelling.py` scales the selected cells by `1 + techChange/100`.

The engine path in the tables below is one of two:

- `Modelling.model_intermediates` changes `A`, the input coefficients. A Woodbury update then
  recomputes `L` from the stored `L` for that small change to `A`. It does not solve the whole
  system again ([the terms](precompute.md) are defined there). Every shipped scenario of this
  kind took the Woodbury update. Above 2,000 changed rows, or when the result fails the
  engine's residual check, the engine uses `LeontiefSolve` instead ([Solver](precompute.md#solver)).
- `Modelling.model_final_demand` changes `Y`, final demand, and uses the stored `L` as it is.

## Featured scenarios

What if… lists these three first, in this order.

| id | What it changes | Engine path |
| --- | --- | --- |
| `coal-power-china` | Coefficient of electricity by coal produced in China into every industry in China, −20% | `Modelling.model_intermediates` (A) |
| `steel-asia-pacific-20` | Coefficient of basic iron and steel (all origins) into every industry in Asia-Pacific, −20%; a cell of the [grid](#material-efficiency-grid) | `Modelling.model_intermediates` (A) |
| `construction-demand-europe` | Final demand in European regions for construction work produced in all regions, −20% | `Modelling.model_final_demand` (Y) |

"Every industry" is the engine database's 15 industry sections (`consumedBy` 1–15),
which together hold all 200 industries.

## The original interventions

What if… used to list these three. They still open from a link, such as
`?scenario=cement-in-construction`, but What if… no longer lists them.

| id | What it changes | Engine path |
| --- | --- | --- |
| `vehicle-demand-europe` | Final demand in European regions for motor vehicles produced in European regions, −20% | `Modelling.model_final_demand` (Y) |
| `steel-in-vehicles-europe` | Coefficient of basic iron and steel (all origins) into motor-vehicle manufacturing in European regions, −20% | `Modelling.model_intermediates` (A) |
| `cement-in-construction` | Coefficient of cement, lime and plaster (all origins) into construction work in all regions, −20% | `Modelling.model_intermediates` (A) |

The two final-demand scenarios change monetary final demand, not the number of
vehicles bought or buildings built.

"European regions" is the `Europe` aggregate of the engine database: EU28 plus
Russia, Switzerland, Norway and Rest of Europe.

[Read the map](page.md#example-less-steel-in-european-cars) shows how to rebuild
`steel-in-vehicles-europe` in the custom scenario form.

## Material-efficiency grid

150 scenarios of one shape, `steel-asia-pacific-20` above included, defined as data in `pipeline/precompute.py`
(`GRID_PRODUCTS`, `GRID_REGIONS`, `GRID_CUTS`, `grid_scenarios()`). Each one
scales the technical coefficient of one product, from all regions, into
**every industry of one world region** by the cut. Nothing else changes.
It is `cement-in-construction` with the consuming side widened from one
industry to the engine database's 15 industry sections.

Products, with their engine database ids:

- Basic iron and steel and of ferro-alloys and first products thereof (180)
- Aluminium and aluminium products (184)
- Cement, lime and plaster (177)
- Plastics, basic (162)
- Electrical machinery and apparatus n.e.c. (196)
- Copper products (188)
- Glass and glass products (173)
- N-fertiliser (164)
- Chemicals nec (166)
- Rubber and plastic products (172)

Regions, the five world-region aggregates: Europe (2) · Middle-East (3) · America (4) ·
Asia-Pacific (5) · Africa (6).

Cuts: −10 %, −20 %, −50 %.

Scenario ids are `<product>-<region>-<cut>`, for example `steel-europe-20`.
