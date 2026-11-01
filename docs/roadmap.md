# Roadmap

What is planned for the next year (to late 2027), in rough order. None of it has a date.

## Planned

- **A newer EXIOBASE vintage.** [v3.8.2](https://doi.org/10.5281/zenodo.3583070)
  has the same 200 products and 49 regions as the v3.3.sm data used now, so the engine reads it once the arrays are converted. It is
  licensed CC BY-SA 4.0, so the derived data would be share-alike; later vintages need the
  publisher's permission to publish multipliers. The move waits on that licence question.
- **Final demand by category.** Split the Sankey's consumption side into households,
  government and investment. This needs a new Parquet layout and a fresh engine run, so it
  comes with the next data release.

## Available

- [Browser scenarios](browser-engine.md) use float64 Woodbury updates on a float32 Zarr store
  and read only the rows a scenario needs. CI checks all 153 published scenarios against
  RaMa-Scene at relative 1e-6.
- The browser reader joins the [agreement table](../brightway-check/README.md).

## Not planned

- A server for the published page. It stays static; custom scenarios against the job API
  stay opt-in behind `?api=` ([interface.md](interface.md)).
- Forecasts. Every scenario changes final demand or technical coefficients in the 2011
  economy; there is no projection step.
- Languages other than English.
