# RaMa-Scene Explorer

[![ci](https://github.com/simonvanlierde/ramascene-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/simonvanlierde/ramascene-explorer/actions/workflows/ci.yml)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23461260.svg)](https://doi.org/10.5281/zenodo.23461260)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/simonvanlierde/ramascene-explorer/badge)](https://scorecard.dev/viewer/?uri=github.com/simonvanlierde/ramascene-explorer)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16003/badge)](https://www.bestpractices.dev/projects/16003)

**What we consume connects us to environmental impacts across global supply chains.**
RaMa-Scene Explorer maps those connections using EXIOBASE data for 2011.
See where emissions and metal-ore extraction occur, and where people work,
to supply a country's consumption. Then explore how changes in demand or
production inputs would affect those footprints.

[Open the explorer](https://simonvanlierde.com/ramascene-explorer/).

1. Choose a country or region. **Its consumption** traces the supply chains serving its final demand.
2. Follow the flows on the map. Select an industry section to see its contribution.
3. Open **What if…**. Compare a published scenario with the 2011 baseline.

**Details → Method** explains the model, data and calculation checks.
The [reading guide](docs/page.md) explains the map and units.
For a custom scenario, [enable calculation on your device](docs/browser-engine.md)
or connect an optional [job API](docs/page.md#live-scenarios-optional).

## What the results mean

The demand-pull input–output model links spending to production throughout the supply chain.
It covers 49 countries and regions, with results grouped into 15 industry sections.
Employment is the number of people employed attributed to demand, labelled “jobs” in the interface.
It is not a measure of full-time equivalents or net job creation.

The 153 published scenarios change monetary final demand or inputs per unit of output.
Prices and unselected coefficients stay fixed; substitution and rebound are outside the model.
The results describe changes to the **2011 economy**, not forecasts.
See [what each scenario changes](docs/scenarios.md) before interpreting a reduction.

Calculation checks test numerical agreement and consistency.
The [Brightway comparison](brightway-check/README.md) compares one footprint across several implementations,
including an unresolved difference in the pycirk reconstruction.
These checks do not establish whether a scenario's assumptions are realistic.

## View

The page is Svelte 5, built with Vite. It needs Node 24 and pnpm. Install once with
`pnpm install`, and fetch the flows from the release (or with
`gh release download data-2011 --pattern embodied.parquet --dir data`):

```sh
curl -L -o data/embodied.parquet https://github.com/simonvanlierde/ramascene-explorer/releases/download/data-2011/embodied.parquet
```

Then:

```sh
pnpm dev        # dev server with live reload, on http://localhost:5173/
pnpm build      # static site in dist/, with relative paths
pnpm preview    # serves dist/ on http://127.0.0.1:4180/
```

Open `?mode=whatif&scenario=steel-in-vehicles-europe` or
`?region=CN&dir=out&indicator=7&sections=2`. Add `data=tests/fixture.json` to
see the page on the synthetic fixture.
Filters and published scenarios are stored in the URL.
Custom results are not included; a shared link opens the last published scenario.

## Build

`pnpm build` writes a static site to `dist/`, with `data/` and `geo/` copied in
when present. Any static host serves it, as long as it answers HTTP range
requests: the page reads the Parquet file in pieces. Publishing to GitHub
Pages is in [docs/publishing.md](docs/publishing.md).

## Data and reproducibility

The published results come from one run on 2026-10-14, using engine
`split/3-performance @ d9113ca`, the head of
[CMLPlatform/ramascene#74](https://github.com/CMLPlatform/ramascene/pull/74).
`data/results.json` holds scenario totals, parameters, checks and provenance.
`data/embodied.parquet` holds the map flows and ships as a release asset.
The [precompute guide](docs/precompute.md) explains how to reproduce both.

`data/regions.json` and `data/flows.json` provide additional checks; the page does not read them.
`brightway-check/` is a separate uv project with its own dependency pins.
`tests/fixture.json` and `tests/fixture-embodied.parquet` are synthetic fixtures.
Any dataset whose `data_kind` is not `exiobase-v3` gets a red
“SYNTHETIC TEST DATA: NOT A RESULT” banner.

## Test

```sh
uv run pytest                          # everything except the engine adapter
uv run pytest --engine="$ENGINE_DIR"   # adds checks that need the engine and EXIOBASE arrays
pnpm test                              # the page logic, with the coverage floor
pnpm exec playwright test              # the built page in six browser setups, with axe (once: pnpm exec playwright install chromium firefox webkit)
pnpm mutation                          # mutation score of flows.js with Stryker (about 4 minutes); fails below 75%
```

Write `--engine=PATH` with the `=`. Without it, pytest takes the path as its
root directory and loads the engine's own `conftest.py`.

## Benchmark

```sh
pnpm bench   # the page's per-selection work, with Vitest
```

The benchmarks run on the small test fixtures and take microseconds, so CI
doesn't run them: runner noise is bigger than any change they could show. Run
them before and after a change to the code they cover.

## Docs

- **Read the results:** [map and units](docs/page.md), [scenario definitions](docs/scenarios.md).
- **Understand the calculations:** [published data](docs/precompute.md), [browser method and limits](docs/browser-engine.md), [cross-engine comparison](brightway-check/README.md).
- **Develop:** [architecture](docs/architecture.md), [URL and API reference](docs/interface.md), [contributing](CONTRIBUTING.md).
- **Publish and maintain:** [CI and releases](docs/publishing.md), [security](docs/security.md), [security controls](docs/assurance-case.md), [governance](GOVERNANCE.md), [code of conduct](CODE_OF_CONDUCT.md), [roadmap](docs/roadmap.md).

## Cite

Cite the archived release: [doi:10.5281/zenodo.23461260](https://doi.org/10.5281/zenodo.23461260)
always points to the latest version. GitHub's "Cite this repository" button
reads [CITATION.cff](CITATION.cff). Cite EXIOBASE and the RaMa-Scene engine
separately (see below and [docs/precompute.md](docs/precompute.md)).

## Licence

The code is under the MIT licence (`LICENSE`), © 2026 Simon van Lierde.

The result files in `data/` are computed from **EXIOBASE v3.3.sm** by Franco
Donati and Arjan de Koning (Zenodo, version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)), which
the Zenodo record publishes under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
The result files hold scenario totals and flows. The optional
[browser export](docs/browser-engine.md) also includes matrices and derived
multipliers. All these data files are shared under CC BY 4.0. Reuse them with
credit to EXIOBASE v3.3.sm and its authors, as above, and say what was changed.

The fonts are Public Sans and Spectral, under the SIL Open Font License 1.1,
bundled from the `@fontsource` packages. The map geometry is Natural Earth,
public domain; its source is in [docs/page.md](docs/page.md#map-geometry).
