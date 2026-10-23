# Security of the page

This page covers the technical surface. To report a vulnerability, follow
[.github/SECURITY.md](../.github/SECURITY.md).

## A static site

The published page is files on GitHub Pages: HTML, scripts, `results.json`,
`embodied.parquet`, the map geometry and fonts. It has no server code, no
database, no login, and it stores nothing. Without `?api=` it fetches only
those files from its own origin ([page.md](page.md#live-scenarios-optional)).

`index.html` sets a Content-Security-Policy. Scripts and fonts load from the
page's own origin only. Styles also come from the page's own origin, plus
inline styles (`'unsafe-inline'`). `object-src` and `form-action` are `none`,
and `base-uri` is `none`. `connect-src` allows the page's own origin, any `https:`
origin, and `127.0.0.1` and `localhost` over http (and `ws://localhost` for the
dev server). The wide `https:` entry exists because `?api=` can name any
https job API. The page renders data as text. It does not use `innerHTML` or
Svelte's `{@html}`, so text from a job API cannot add markup.

## What `?api=` accepts

`apiUrl` in `live.js` takes the value and returns an origin, or nothing. It
accepts a value only if all of these hold:

- it parses as a URL;
- the scheme is `https`, or `http` with the host `127.0.0.1` or `localhost`
  (`[::1]` is refused);
- it has no user name or password, no query, no fragment, and no path beyond
  `/`.

Anything else is ignored. The page shows the refused value in the status line
and stays static. `tests/live.test.js` covers these cases.

The page then sends requests only to that origin, with no cookies
([interface.md](interface.md#job-api) lists them). The request body is built
from form values by `scenarioBody`, which accepts integer ids and a finite
number, and throws on anything else.

## What the page cannot do about `?api=`

A link with `?api=https://other.example` makes the page ask `other.example`
for its catalog as soon as it loads, and send it a job once a person clicks
Run. The browser lets the page read the answers only if `other.example` sends
CORS headers for the page's origin. The page cannot tell a good job API
from a bad one. A bad one can return wrong numbers, which the page labels
"computed live by the job API, not precomputed" and shows with the job API's
origin and its provenance. Take the origin in the status line and the panel
seriously before you trust a live result. A live run never enters the shared
link ([page.md](page.md#live-scenarios-optional)).

## What `?data=` accepts

`dataUrl` in `explorer.js` accepts a relative path ending in `.json`, and
nothing else. The first segment holds only word characters and dashes; later
segments may also hold dots; no segment is `..`. So `?data=` cannot point the
page at another origin. Any other value is ignored and shown in the status
line, and the page reads `data/results.json`. A file whose `data_kind` is not `exiobase-v3` gets the
red synthetic-data banner.

## Origins in the build

`pages.yml` runs only by hand and only from `main`. It downloads the Parquet
file from the release and checks its SHA-256, and it stops if
`results.json` is not marked `exiobase-v3`
([publishing.md](publishing.md)).
