# What each scenario changes

Each scenario asks how one change would have affected the 2011 economy.
It changes spending on a product, or the input of a product per unit of output.
Prices and all other coefficients stay fixed, and no substitution, price or rebound effect is modelled.
A 20% cut in an input coefficient means 20% less of that input per unit of monetary output.
The resulting change in total use is a model result, not a preset cut.

Each scenario is one RaMa-Scene `model_details` intervention, stored exactly in the output.
`ramascene/modelling.py` scales the selected cells by `1 + techChange/100`.

## Featured scenarios

What if… lists these three first, in this order.

| id | What it changes | Engine path |
| --- | --- | --- |
| `coal-power-china` | Coefficient of electricity by coal produced in China into every industry in China, −20% | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |
| `steel-asia-pacific-20` | Coefficient of basic iron and steel (all origins) into every industry in Asia-Pacific, −20%; a cell of the [grid](#material-efficiency-grid) | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |
| `construction-demand-europe` | Final demand in European regions for construction work produced in all regions, −20% | `Modelling.model_final_demand` (Y), stored L |

A Woodbury update recomputes `L` for a small change to `A` without solving the
whole system again ([the terms](precompute.md) are defined there).

"Every industry" is the engine database's 15 industry sections (`consumedBy` 1–15),
which together hold all 200 industries.

## The original interventions

The three interventions the first version of the page published. They still open
from a link, such as `?scenario=cement-in-construction`, but What if… no longer lists them.

| id | What it changes | Engine path |
| --- | --- | --- |
| `vehicle-demand-europe` | Final demand in European regions for motor vehicles produced in European regions, −20% | `Modelling.model_final_demand` (Y), stored L |
| `steel-in-vehicles-europe` | Coefficient of basic iron and steel (all origins) into motor-vehicle manufacturing in European regions, −20% | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |
| `cement-in-construction` | Coefficient of cement, lime and plaster (all origins) into construction work in all regions, −20% | `Modelling.model_intermediates` (A), then a Woodbury update of the stored L |

The two final-demand scenarios change monetary final demand, not the number of
vehicles bought or buildings built.

"European regions" is the `Europe` aggregate of the engine database: EU28 plus
Russia, Switzerland, Norway and Rest of Europe.

## Material-efficiency grid

150 scenarios of one shape, `steel-asia-pacific-20` above included, defined as data in `precompute.py`
(`GRID_PRODUCTS`, `GRID_REGIONS`, `GRID_CUTS`, `grid_scenarios()`). Each one
scales the technical coefficient of one product, from all regions, into
**every industry of one world region** by the cut. Nothing else changes.
It is `cement-in-construction` with the consuming side widened from one
industry to the engine database's 15 industry sections.

| axis | values (engine database ids) |
| --- | --- |
| product | Basic iron and steel and of ferro-alloys and first products thereof (180) · Aluminium and aluminium products (184) · Cement, lime and plaster (177) · Plastics, basic (162) · Electrical machinery and apparatus n.e.c. (196) · Copper products (188) · Glass and glass products (173) · N-fertiliser (164) · Chemicals nec (166) · Rubber and plastic products (172) |
| region | Europe (2) · Middle-East (3) · America (4) · Asia-Pacific (5) · Africa (6), the five world-region aggregates |
| cut | −10 %, −20 %, −50 % |

Scenario ids are `<product>-<region>-<cut>`, for example `steel-europe-20`.
