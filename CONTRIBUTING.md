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

## Sign off your commits

Every commit in a pull request carries a `Signed-off-by:` line, which says you wrote the
change or have the right to submit it under the MIT license: the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). `git commit -s`
adds it; `git rebase --signoff origin/main` adds it to commits you already made. The `dco`
workflow fails a pull request from an outside contributor with a commit that lacks it. The
maintainer's and the dependency bots' pull requests skip it.

## Who maintains this

Simon van Lierde ([@simonvanlierde](https://github.com/simonvanlierde)) maintains the
project: reviews and merges pull requests, and tags releases. Only he can merge to `main`,
and only through a pull request whose checks pass. A new maintainer would be named here
first. If he stops maintaining it, the README says so and the repository is archived;
anyone may fork it under the MIT license.
