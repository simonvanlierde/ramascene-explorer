# Scenarios

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

## Material-efficiency grid

150 more scenarios of one shape, defined as data in `precompute.py`
(`GRID_PRODUCTS`, `GRID_REGIONS`, `GRID_CUTS`, `grid_scenarios()`). Each one
scales the technical coefficient of one product, from all regions, into
**every industry of one continental region** by the cut. Nothing else changes.
It is `cement-in-construction` with the consuming side widened from one
industry to the engine database's 15 industry sections (`consumedBy` 1–15,
whose leaves are all 200 industries).

| axis | values (engine database ids) |
| --- | --- |
| product | Basic iron and steel and of ferro-alloys and first products thereof (180) · Aluminium and aluminium products (184) · Cement, lime and plaster (177) · Plastics, basic (162) · Electrical machinery and apparatus n.e.c. (196) · Copper products (188) · Glass and glass products (173) · N-fertiliser (164) · Chemicals nec (166) · Rubber and plastic products (172) |
| region | Europe (2) · Middle-East (3) · America (4) · Asia-Pacific (5) · Africa (6), the five continental aggregates |
| cut | −10 %, −20 %, −50 % |

Scenario ids are `<product>-<region>-<cut>`, for example `steel-europe-20`.
