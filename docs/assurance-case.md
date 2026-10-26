# Assurance case

Why the page and its release files can be trusted. This page gives the
argument; [security.md](security.md) and [publishing.md](publishing.md) hold
the details it points to.

## Threat model

The page is static: files on GitHub Pages, with no server code, login or
stored data. The threats are:

1. **A crafted link** whose `?api=` or `?data=` makes the page load data from
   somewhere else, or show it as a real result.
2. **A swapped data file.** `embodied.parquet` lives on the `data-2011`
   release, outside git.
3. **A hijacked dependency or action** that runs in CI or ends up in the
   bundle.
4. **A file passed off as ours:** a tarball or Parquet file someone says came
   from this repository.

Out of scope: a job API the user picks with `?api=`. The page cannot tell a
good one from a bad one, so it labels a live result with its origin.

## Trust boundaries

| Boundary | What crosses it | Who controls the far side |
| --- | --- | --- |
| The URL | `?api=`, `?data=` | whoever wrote the link |
| A job API | catalog, job results | whoever runs that origin |
| Release assets | `embodied.parquet`, the `dist` tarball | anyone with write access to releases |
| Build and CI | npm and PyPI packages, actions | their publishers |

## Secure design

- **Least privilege.** Workflows default to `contents: read`, and a job gets
  a write permission only where it needs one, with the reason in a comment.
  In `release.yml` the job that runs `pnpm install` cannot sign or upload, and
  the job that signs runs no repository code.
- **Fail-safe defaults.** `?api=` and `?data=` pass an allow-list or are
  ignored, and the status line says so. `pages.yml` refuses data not marked
  `exiobase-v3`, and every download of `embodied.parquet` must match the hash
  in `data/embodied.sha256`.
- **Small attack surface.** No server, cookies or login. The
  Content-Security-Policy in `index.html` allows scripts and fonts from the
  page's own origin only.
- **Reviewed changes.** `main` takes changes only through pull requests with
  the required checks, and refuses force-pushes and deletion.

## Common weaknesses

- **Cross-site scripting (CWE-79).** The page renders data as text, never
  through `innerHTML` or `{@html}`, so a job API's text cannot add markup.
- **Improper input validation (CWE-20).** `apiUrl`, `dataUrl` and
  `scenarioBody` check every value from the URL and the form;
  `tests/live.test.js` and `tests/explorer.test.js` cover them.
- **Untrusted components (CWE-1357).** Actions are pinned to commit SHAs. No
  release younger than 7 days is installed, CI installs from the lockfiles
  only, zizmor and actionlint check the workflows, and a pull request that
  adds a dependency with a known advisory fails. CONTRIBUTING's Dependencies
  section names the files.
- **Downloads without an integrity check (CWE-494).** Release files carry a
  build provenance attestation;
  [publishing.md](publishing.md#check-a-release-file) shows how to verify one.

## Limits

- Releases v0.1.0 to v0.3.1 have no attestation.
- The `embodied.parquet` attestation says this workflow vouched for a file
  with that hash, not that it ran `precompute.py`: the file is built locally.
- The Pages site is not checked against the release tarball, since Pages may
  deploy a later commit of `main` than the tag. A `v*` tag is not checked to
  be on `main`; only the maintainer can publish releases.
- If immutable releases are turned on, `release.yml` must move to a
  draft-release flow, because it adds assets after publishing.
