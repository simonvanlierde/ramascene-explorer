# Security

## Report a vulnerability

Report it privately through GitHub:
[open a private advisory](https://github.com/simonvanlierde/ramascene-explorer/security/advisories/new).
Don't open a public issue or pull request for it: anyone can read those before there is a fix.

Please include:

- What the problem is and where: a page script, `pipeline/precompute.py`, a workflow, or the
  published page.
- How to reproduce it: the URL or query string, or the command and input.
- The impact you expect.

I acknowledge a report within 14 days, then tell you whether I can reproduce it and when I
expect a fix.

## Fixes and disclosure

A fix ships in a new tagged release. When the release is out, I publish the GitHub
security advisory for it, with a CVE where one applies, and credit you unless you'd
rather not be named. The CHANGELOG entry for that release links the advisory.

## Scope

In scope:

- The page: `index.html`, the scripts and components in `src/`, and how it reads the `?data=` and
  `?api=` parameters.
- `pipeline/` (`precompute.py`, `compare_data.py`) and the browser calculation and data reader modules in `src/lib/`.
- The workflows in `.github/workflows/`, including the Cloudflare deploy (`cloudflare.yml`),
  which publishes production only from `main` and previews from this repository's branches,
  and the data upload (`data.yml`), which runs only for `data-*` releases.

Out of scope:

- A vulnerability in a tool or dependency the project uses, such as Vite, Svelte,
  Playwright or uv. Report it upstream; a pin or setting this repository should change
  is in scope.
- A job API that you point the page at with `?api=`. How the page handles its response
  is in scope.
- The RaMa-Scene engine and the EXIOBASE data. Report those to their own projects.
