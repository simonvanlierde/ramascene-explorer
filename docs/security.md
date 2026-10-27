# Security of the page

This page covers the technical surface. To report a vulnerability, follow
[.github/SECURITY.md](../.github/SECURITY.md).

## A static site

The published page is files on GitHub Pages, with no server code, database or
login, and it stores nothing. Without `?api=` it fetches only its own files
([page.md](page.md#live-scenarios-optional)). How those files are built and
checked is in [publishing.md](publishing.md).

The Content-Security-Policy is the `<meta>` tag in `index.html`. It allows
scripts, styles and fonts from the page's own origin only (plus inline styles).
`connect-src` also allows any `https:` origin, because `?api=` can name any
https job API, and loopback over http. The page renders data as text, never
through `innerHTML` or Svelte's `{@html}`, so a job API's text cannot add
markup.

## What `?api=` accepts

`apiUrl` in `live.js` turns the value into an origin, or ignores it. It accepts
a value only if:

- it parses as a URL;
- the scheme is `https`, or `http` with the host `127.0.0.1` or `localhost`
  (`[::1]` is refused);
- it has no user name or password, query, fragment, or path beyond `/`.

A refused value shows in the status line and the page stays static.
`tests/live.test.js` covers these cases.

The page then talks only to that origin, without cookies
([interface.md](interface.md#job-api) lists the calls). `scenarioBody` builds
the request from the form and throws on anything but integer ids and a finite
number from −100 to +1000. `liveFlows` refuses a job whose flows do not fit
the page's layout or hold a value that is not a number.

## Trusting a live result

A link with `?api=https://other.example` makes the page fetch that origin's
catalog on load, and send it a job when someone clicks Run. The page cannot
tell a good job API from a bad one, and a bad one can return wrong numbers.
So a live result is labelled "computed live by the job API, not precomputed",
with the API's origin and provenance: check that origin before you trust it.
A live run never enters the shared link.

## What `?data=` accepts

`dataUrl` in `explorer.js` accepts only a relative path ending in `.json`: the
first segment holds word characters and dashes, later segments may also hold
dots, and no segment is `..`. So `?data=` cannot point at another origin. Any
other value shows in the status line and the page reads `data/results.json`. A
file whose `data_kind` is not `exiobase-v3` gets the red synthetic-data banner.
