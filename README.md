# RaMa-Scene Explorer

[![ci](https://github.com/simonvanlierde/ramascene-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/simonvanlierde/ramascene-explorer/actions/workflows/ci.yml)
[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/simonvanlierde/ramascene-explorer?utm_source=badge)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23461260.svg)](https://doi.org/10.5281/zenodo.23461260)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/simonvanlierde/ramascene-explorer/badge)](https://scorecard.dev/viewer/?uri=github.com/simonvanlierde/ramascene-explorer)

A static, map-first page over **precomputed** RaMa-Scene engine output on the
EXIOBASE 2011 base year. It shows where a country's consumption causes
greenhouse-gas emissions, jobs and metal-ore extraction, split by 15 industry
sections, and what one intervention would have changed: three named
interventions and a grid of 150 material-efficiency scenarios. Nothing on the
published page is a live calculation (an optional live mode needs a job API; see
[docs/page.md](docs/page.md)), and nothing is a forecast. The engine changes final demand
or technical coefficients in the 2011 economy and has no projection step.

Open it at <https://simonvanlierde.github.io/ramascene-explorer/>.

`data/results.json` and `data/embodied.parquet` come from one precompute run
on 2026-10-14, with engine `split/3-performance @ d9113ca`, the head of
[CMLPlatform/ramascene#74](https://github.com/CMLPlatform/ramascene/pull/74).
The same run wrote `data/regions.json` and `data/flows.json`. The precompute
checks the flows against these detail files, and the page does not read them.
The Parquet file is too large for git, so it ships as a release asset (see
[docs/precompute.md](docs/precompute.md#embodied-flows)).

Nothing else in the repository is a result. `tests/fixture.json` and
`tests/fixture-embodied.parquet` are synthetic data for testing the page. For
any data whose `data_kind` is not `exiobase-v3`, the page shows a red
"SYNTHETIC TEST DATA: NOT A RESULT" banner.

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
see the page on the synthetic fixture. The selection lives in the query
string, so you can share a view by its URL.

## Build

`pnpm build` runs `vite build` and writes the static site to `dist/`, with
relative paths, so any static host can serve it. The build copies
`data/results.json`, `data/embodied.parquet` and `geo/` into `dist/`, and
skips any that is missing. The host must answer HTTP range requests, because
the page reads the Parquet file in pieces ([docs/page.md](docs/page.md)).
`pnpm preview` serves `dist/`. The GitHub Pages workflow that publishes the
site is in [docs/publishing.md](docs/publishing.md).

## Brightway check

[`brightway-check/`](brightway-check/) loads the same EXIOBASE v3.3.sm arrays into
Brightway as an input-output database and scores one product four ways: Brightway,
numpy, pymrio and this engine through the adapter in `precompute.py`. All agree to
within 2.2e-13. It is a separate uv project with its own Brightway and pymrio pins.

## Test

```sh
uv run pytest                          # everything except the engine adapter
uv run pytest --engine="$ENGINE_DIR"   # adds the real-engine adapter checks (768 MB)
node --test                            # the page logic (after pnpm install)
pnpm exec playwright test              # the built page in six browser setups, with axe (once: pnpm exec playwright install chromium firefox webkit)
pnpm mutation                          # mutation score of flows.js with Stryker (about 4 minutes); fails below 75%
```

Write `--engine=PATH` with the `=`. Without it, pytest takes the path as its
root directory and loads the engine's own `conftest.py`.

## Benchmark

```sh
pnpm bench   # the page's per-selection work, with Vitest
```

`.github/workflows/codspeed.yml` runs it on every pull request and push to
main under [CodSpeed](https://codspeed.io)'s CPU simulation, which reports the
change against main on the pull request.

## Docs

- [docs/scenarios.md](docs/scenarios.md): what each scenario changes
- [docs/precompute.md](docs/precompute.md): how to regenerate the data, the embodied flows, and the checks they must pass
- [docs/architecture.md](docs/architecture.md): how the parts fit together, and the page's modules
- [docs/interface.md](docs/interface.md): the URL parameters and the job API contract
- [docs/security.md](docs/security.md): what the page accepts from `?api=` and `?data=`
- [GOVERNANCE.md](GOVERNANCE.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [docs/page.md](docs/page.md): the map, the industry rail, What if…, Details and the optional live scenarios
- [docs/publishing.md](docs/publishing.md): CI and the GitHub Pages workflow

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
The results are a changed version of that dataset: each file holds scenario
totals and flows computed from its matrices, not the matrices themselves. They
are shared under CC BY 4.0 too. Reuse them with credit to EXIOBASE v3.3.sm and
its authors, as above, and say that they were changed.

The fonts are Public Sans and Spectral, under the SIL Open Font License 1.1,
bundled from the `@fontsource` packages. The map geometry is Natural Earth,
public domain; its source is in [docs/page.md](docs/page.md#map-geometry).
