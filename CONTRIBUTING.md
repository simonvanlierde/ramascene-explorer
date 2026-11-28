# Contributing

To report a bug or ask for a feature, open an
[issue](https://github.com/simonvanlierde/ramascene-explorer/issues). Say what you did,
what you expected, what happened, and the version (or commit) you ran. Report a
vulnerability as [.github/SECURITY.md](.github/SECURITY.md) says, not in an issue.

## Set up

Use the Node version in `.node-version` with pnpm (the version is pinned in `packageManager`
in `package.json`), [uv](https://docs.astral.sh/uv/) for the Python side, Rust through rustup
with `wasm-bindgen-cli` for the browser kernel, [just](https://just.systems) for the task
recipes, and prek for the git hooks (`uv tool install prek`, then `prek install`).

[docs/develop.md](docs/develop.md#view) has the commands, including the data download.

## Run the checks before you push

[docs/develop.md](docs/develop.md#test) lists the checks CI runs ([docs/publishing.md](docs/publishing.md)
describes them). Run them before you push.

New behaviour comes with a test, and a bug fix with a test that fails without it. Page
logic tests go in `tests/*.test.js`, browser tests in `tests/e2e/`, Python tests in `tests/`.
Browser tests import `test` and `expect` from `tests/e2e/test.js`, not `@playwright/test`,
so `pnpm measure-coverage` counts them.

The checks hold the code to these standards: ruff with every rule selected and ty for Python,
biome for JavaScript, clippy with `-D warnings` for the Rust kernel, at least 80% line coverage
for the page logic and the Python code, and Conventional Commits for commit messages.

## Dependencies

Add one only when the standard library or an existing dependency can't do the job. CI
installs from the lockfiles unchanged, `engine/Cargo.lock` for the Rust kernel. The
release-age rule is in `pnpm-workspace.yaml` and `pyproject.toml`; the Rust compiler is pinned
in `engine/rust-toolchain.toml` and the cargo tools in `.github/workflows/ci.yml`, and
`engine/deny.toml` checks the crates' advisories and licences. The update schedule is in
[renovate.json5](renovate.json5). `.github/workflows/hygiene.yml` reviews each pull request's new
dependencies and checks the licenses of everything that ships (the allow-list is in
`scripts/check-licenses.js`), and `.github/workflows/osv.yml` scans the lockfiles every week.

## Sign off your commits

Every commit in a pull request carries a `Signed-off-by:` line. It says you wrote the
change or have the right to submit it under the MIT license, as the
[Developer Certificate of Origin 1.1](https://developercertificate.org/) sets out. `git commit -s`
adds it. To add it to commits you already made, rebase them onto `main`, then update the
pushed branch:

```sh
git fetch origin && git rebase --signoff origin/main
git push --force-with-lease
```

In a fork, use the remote that points at this repository, often `upstream`, in place of
`origin` in the first line. The `dco` workflow fails any pull request with a commit that
lacks it, the maintainer's included. Only commits a bot wrote in a bot's pull request
(Renovate) are skipped.

## Who maintains this

Simon van Lierde ([@simonvanlierde](https://github.com/simonvanlierde)) maintains the
project. Ask questions by email at [code@duinlab.nl](mailto:code@duinlab.nl). How decisions are made, and what happens if he stops, is in
[GOVERNANCE.md](GOVERNANCE.md).
