# CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest`, `node --test` and
`pnpm exec playwright test`. None of them needs the dataset: the engine checks
skip without `--engine`, and the page tests read `tests/fixture.json`. The
browser tests load the page over the fixture and the committed results, in
light, dark and phone layouts, with axe checking WCAG 2.2 AA.

`pages.yml` publishes to GitHub Pages only when started by hand (Actions →
pages → Run workflow). Before you run it, commit the precompute output and
set the repository's Pages source to GitHub Actions. The workflow ships the
page and its modules, the fonts, the map geometry and the three data files, and
nothing else. It stops if `data/results.json` is missing or isn't marked
`data_kind: exiobase-v3`, so the synthetic fixture can never go out.
