# CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest`, `biome ci`,
`node --test` and `pnpm exec playwright test`. None of them needs the engine or
the EXIOBASE matrices: the engine checks skip without `--engine`. The page jobs
read the synthetic fixtures and the shipped results, with `embodied.parquet`
downloaded from the `data-2011` release and checked against its SHA-256; in CI
the real-data checks fail rather than skip when it is missing. The browser
tests run in light, dark and phone layouts, with axe checking WCAG 2.2 AA.

`pages.yml` publishes to GitHub Pages only when started by hand (Actions →
pages → Run workflow). Before you run it, commit the precompute output and
set the repository's Pages source to GitHub Actions. The workflow ships the
bundled page and fonts, the map geometry, `results.json` and `embodied.parquet`
(downloaded from the release and checked against its SHA-256), and nothing
else. It stops if `data/results.json` is missing or isn't marked
`data_kind: exiobase-v3`, so the synthetic fixture can never go out.
