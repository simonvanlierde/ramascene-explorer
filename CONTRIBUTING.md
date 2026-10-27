# Contributing

To report a bug or ask for a feature, open an
[issue](https://github.com/simonvanlierde/ramascene-explorer/issues). Say what you did,
what you expected, what happened, and the version (or commit) you ran. Report a
vulnerability as [.github/SECURITY.md](.github/SECURITY.md) says, not in an issue.

## Set up

You need Node 24 with pnpm (the version is pinned in `packageManager` in `package.json`),
[uv](https://docs.astral.sh/uv/) for the Python side, and prek for the git hooks
(`uv tool install prek`, then `prek install`).

```sh
pnpm install
gh release download data-2011 --pattern embodied.parquet --dir data
pnpm dev
```

[README.md](README.md#view) has the full steps, including the `curl` form of the download.

## Run the checks before you push

These are the checks CI runs ([docs/publishing.md](docs/publishing.md) describes them):

```sh
prek run -a
uv run ruff check && uv run ruff format --check && uv run ty check
uv run pytest --cov=precompute --cov=compare_data
pnpm exec biome ci .
pnpm test
pnpm build && pnpm exec playwright test   # once: pnpm exec playwright install chromium firefox webkit
```

`pnpm mutation` (about 4 minutes) fails when the mutation score of `flows.js` is below 75%.

New behaviour comes with a test, and a bug fix with a test that fails without it. Page
logic tests go in `tests/*.test.js`, browser tests in `tests/e2e/`, Python tests in `tests/`.
Browser tests import `test` and `expect` from `tests/e2e/test.js`, not `@playwright/test`,
so `pnpm measure-coverage` counts them.

## Dependencies

Add one only when the standard library or an existing dependency can't do the job. CI
installs from the lockfiles unchanged. The release-age rule is in `pnpm-workspace.yaml` and
`pyproject.toml`, the update schedule in [renovate.json5](renovate.json5), and the
dependency review in `.github/workflows/hygiene.yml`.

## Sign off your commits

Every commit in a pull request carries a `Signed-off-by:` line, which says you wrote the
change or have the right to submit it under the MIT license: the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). `git commit -s`
adds it; `git rebase --signoff upstream/main` (the branch you started from) adds it to commits you already made. The `dco`
workflow fails a pull request from a fork with a commit that lacks it. Pull requests from a branch in this repository skip it.

## Who maintains this

Simon van Lierde ([@simonvanlierde](https://github.com/simonvanlierde)) maintains the
project. How decisions are made, and what happens if he stops, is in
[GOVERNANCE.md](GOVERNANCE.md).
