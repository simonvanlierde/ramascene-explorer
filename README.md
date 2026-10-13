# RaMa-Scene scenario explorer

A static page over **precomputed** RaMa-Scene engine output. It shows a
baseline, three interventions and a grid of 150 material-efficiency scenarios
on the EXIOBASE 2011 base year. Each has three indicators, broken down by the
region where the impact occurs. Nothing here is a live calculation, and nothing
is a forecast. The engine changes final demand or technical coefficients in the
2011 economy and has no projection step.

`data/results.json`, `data/regions.json` and `data/flows.json` come from one
precompute run on 2026-10-13, with engine `split/3-performance @ d9113ca`, the
head of [CMLPlatform/ramascene#74](https://github.com/CMLPlatform/ramascene/pull/74).
Nothing else in the repository is a result. `tests/fixture.json` is
hand-shaped synthetic data for testing the page, and the page shows a red
"SYNTHETIC TEST DATA: NOT A RESULT" banner for any data whose `data_kind` is
not `exiobase-v3`.

## View

```sh
python3 -m http.server
# then open http://localhost:8000/?scenario=steel-in-vehicles-europe&indicator=5
```

Add `data=tests/fixture.json` to see the page on the synthetic fixture. The
selection lives in the query string, so you can share a view by its URL.

## Test

```sh
uv run pytest                          # everything except the engine adapter
uv run pytest --engine="$ENGINE_DIR"   # adds the real-engine adapter checks (768 MB)
node --test                            # the page logic
```

Write `--engine=PATH` with the `=`. Without it, pytest takes the path as its
root directory and loads the engine's own `conftest.py`.

## Docs

- [docs/scenarios.md](docs/scenarios.md): what each scenario changes
- [docs/precompute.md](docs/precompute.md): how to regenerate the data, and the checks it must pass
- [docs/page.md](docs/page.md): the map, the Sankey and the optional live scenarios
- [docs/publishing.md](docs/publishing.md): CI and the GitHub Pages workflow

## Licence

The code is under the MIT licence (`LICENSE`), © 2026 Simon van Lierde.

The result files in `data/` are computed from **EXIOBASE v3.3.sm** by Franco
Donati and Arjan de Koning (Zenodo, version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)), which
the Zenodo record publishes under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
The results are a changed version of that dataset: each file holds scenario
totals computed from its matrices, not the matrices themselves. They are
shared under CC BY 4.0 too. Reuse them with credit to EXIOBASE v3.3.sm and
its authors, as above, and say that they were changed.

`fonts/` holds Barlow and Barlow Semi Condensed under the SIL Open Font License
1.1 (`fonts/OFL.txt`). The map geometry is Natural Earth, public domain; its
source is in [docs/page.md](docs/page.md#world-map).
