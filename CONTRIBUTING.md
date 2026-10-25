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
uv run pytest
pnpm exec biome ci .
node --test
pnpm build && pnpm exec playwright test   # once: pnpm exec playwright install chromium firefox webkit
```

`pnpm mutation` (about 4 minutes) fails when the mutation score of `flows.js` is below 75%.

A pull request that adds or changes behaviour adds a test for it, and a bug fix adds a
test that fails without the fix. Put page logic tests in `tests/*.test.js`, browser tests
in `tests/e2e/`, and Python tests in `tests/` next to the ones already there.

## Dependencies

Add a dependency only when the standard library or an existing one cannot do the job.
Every version is pinned in a lockfile (`pnpm-lock.yaml`, `uv.lock`), and CI installs from
the lockfile without changing it. pnpm (`minimumReleaseAge` in `pnpm-workspace.yaml`) and uv
(`exclude-newer` in `pyproject.toml`) install no release younger than 7 days, so a
hijacked release has time to be yanked. GitHub Actions are pinned to a full commit SHA.
[Renovate](renovate.json5) proposes updates once a month, and the dependency review job
blocks a pull request that adds a package with a known vulnerability.

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
