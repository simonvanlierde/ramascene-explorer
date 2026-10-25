# Assurance case

Why the published page and the release files can be trusted, claim by claim,
with the file that shows each one. [security.md](security.md) describes what
the page accepts from `?api=` and `?data=`; this page does not repeat it.

## Threat model

The page is static: files on GitHub Pages, no server code, no login, nothing
stored. So the threats are not about a server. They are:

1. **A crafted link.** Someone sends a link whose `?api=` or `?data=` makes the
   page load data from somewhere else, or show it as a real result.
2. **A changed data file.** `embodied.parquet` (51.5 MB) lives on the
   `data-2011` release, outside git. A swapped file would ship wrong numbers.
3. **A compromised dependency or action.** A hijacked npm, PyPI or GitHub
   Actions release runs in CI or ends up in the bundle.
4. **A file passed off as ours.** Someone hands out a `dist` tarball or a
   Parquet file and says it came from this repository.

Out of scope: a job API that a user chooses to trust with `?api=`. The page
cannot tell a good job API from a bad one ([security.md](security.md)).

## Trust boundaries

| Boundary | What crosses it | Who controls the far side |
| --- | --- | --- |
| The URL | `?api=`, `?data=` | whoever wrote the link |
| A job API | catalog, job results | whoever runs that origin |
| Release assets | `embodied.parquet`, the `dist` tarball | anyone with write access to releases |
| Build and CI | npm and PyPI packages, actions | their publishers |

## Claims

### C1. A link cannot make the page load data from another origin without saying so

- `?data=` takes only a relative path ending in `.json`, with no `..`
  segment, or falls back to `data/results.json`:
  [`explorer.js` L7-L12](../explorer.js#L7-L12), tested in
  [`tests/explorer.test.js`](../tests/explorer.test.js).
- `?api=` takes only a bare `https` origin, or `http` on `127.0.0.1` or
  `localhost`, with no credentials, path, query or fragment:
  [`live.js` L12-L25](../live.js#L12-L25), tested in
  [`tests/live.test.js`](../tests/live.test.js).
- A refused value is shown in the status line (`ignoredData`, `ignoredApi`),
  not silently dropped.
- The Content-Security-Policy in [`index.html` L8](../index.html#L8) allows
  scripts and fonts from the page's own origin only, and no `object`, `base`
  or form targets.
- A live result is labelled "computed live by the job API, not precomputed"
  ([`live.js`](../live.js), `LIVE_STATUS`) and shows its origin.

### C2. The page never ships synthetic data or a changed Parquet file

- `pages.yml` stops unless `data/results.json` is marked
  `data_kind: exiobase-v3`
  ([`pages.yml` L28-L35](../.github/workflows/pages.yml#L28-L35)). The page
  itself shows the red synthetic banner for any other value (`banner` in
  [`explorer.js`](../explorer.js)).
- Every workflow that downloads `embodied.parquet` checks it against the
  SHA-256 committed in [`data/embodied.sha256`](../data/embodied.sha256):
  [`pages.yml` L45](../.github/workflows/pages.yml#L45),
  [`ci.yml` L67 and L96](../.github/workflows/ci.yml#L67), and
  [`release.yml`](../.github/workflows/release.yml). A swapped release asset
  fails the build; changing the pinned hash needs a commit to `main`.
- The page shows the Parquet flows only if their footer names the same
  dataset hash, engine commit and timestamp as `results.json` (`sameRun` in
  [`explorer.js`](../explorer.js)).

### C3. A hijacked release of a dependency or action has a week to be caught

- Every action is pinned to a full commit SHA, with the version in a comment
  (all files in [`.github/workflows/`](../.github/workflows/)). Renovate's
  `config:best-practices` keeps them pinned
  ([`renovate.json5` L5](../renovate.json5#L5)).
- Renovate proposes no release younger than 7 days
  ([`renovate.json5` L13](../renovate.json5#L13)). pnpm installs none
  ([`pnpm-workspace.yaml` L3](../pnpm-workspace.yaml#L3)) and uv resolves
  none ([`pyproject.toml` L24](../pyproject.toml#L24)), so a manual add or a
  lock refresh waits too. An exception for a security fix is dated and names
  its advisories ([`pnpm-workspace.yaml` L4-L7](../pnpm-workspace.yaml#L4-L7)).
- CI installs from the lockfiles only: `pnpm install --frozen-lockfile`,
  `uv sync --locked` ([`ci.yml`](../.github/workflows/ci.yml)).
- zizmor and actionlint check every workflow on each commit and in CI
  ([`.pre-commit-config.yaml`](../.pre-commit-config.yaml),
  [`hygiene.yml`](../.github/workflows/hygiene.yml)), with zizmor's online
  audits for impostor commits and known-vulnerable actions.
- Workflows default to `contents: read`. A job gets a write permission only
  where it needs it, with the reason in a comment. Checkout never keeps the
  token (`persist-credentials: false`).
- A pull request that adds a dependency with a known advisory fails
  `dependency-review` ([`hygiene.yml`](../.github/workflows/hygiene.yml)).
- `main` takes changes only through pull requests, with linear history, and
  refuses force-pushes and deletion (the `protect-main` ruleset).

### C4. Anyone can check a release file came from this repository's workflow

- When a `v*` release is published, [`release.yml`](../.github/workflows/release.yml)
  builds `dist/` as `pages.yml` does, packs it as
  `ramascene-explorer-<tag>-dist.tar.gz`, and attests it with
  `actions/attest-build-provenance`. It uploads the tarball, `SHA256SUMS` and
  the Sigstore bundle (`.sigstore.json`) to the release. The build job, which
  runs `pnpm install`, has no write access to the repository; a separate job
  with `contents: write` only uploads.
- Run by hand, the same workflow checks `embodied.parquet` against
  `data/embodied.sha256`, attests it and adds its bundle to `data-2011`. This
  attestation says this repository's workflow vouched for a file with that
  hash. It does not say the workflow ran `precompute.py`: the file is built
  locally, against the EXIOBASE matrices ([precompute.md](precompute.md)).
- To verify a file:

  ```sh
  gh attestation verify ramascene-explorer-v0.4.0-dist.tar.gz --repo simonvanlierde/ramascene-explorer
  gh attestation verify embodied.parquet --repo simonvanlierde/ramascene-explorer
  ```

  Add `--bundle <file>.sigstore.json` to check against the downloaded bundle
  instead of GitHub's attestation store.

## Limits

- Releases from v0.1.0 to v0.3.1 have no attestation. The first one with a
  tarball and bundle is the next `v*` release.
- The page served by GitHub Pages is not checked against the tarball. Pages
  deploys from its own run of `pages.yml`, from the same commit.
- If immutable releases are turned on for the repository, the upload job
  can no longer add assets after publishing, and must move to a draft-release
  flow.
