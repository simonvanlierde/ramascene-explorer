# Security of the page

This page covers the technical surface. To report a vulnerability, follow
[.github/SECURITY.md](../.github/SECURITY.md).

## A static site

The published page is static files, served by a Cloudflare Worker that only answers
byte ranges ([publishing.md](publishing.md#cloudflare)). There is no database or login,
and it stores nothing. Without `?api=` it fetches only its own files, and, with the
[data host](publishing.md#data-host) set, the published data from that host by hash
([page.md](page.md#live-scenarios-optional)). How those files are built and
checked is in [publishing.md](publishing.md).

The Content-Security-Policy is the `<meta>` tag in `index.html`. It allows
scripts, styles and fonts from the page's own origin only (plus inline styles).
`connect-src` also allows any `https:` origin, because `?api=` can name any
https job API, and loopback over http. The page renders data as text, never
through `innerHTML` or Svelte's `{@html}`, so a job API's text cannot add
markup.

`public/_headers` adds `Content-Security-Policy: frame-ancestors 'none'` and
`X-Frame-Options: DENY`, so no other site can frame the page, and
`Strict-Transport-Security` for one year. `frame-ancestors` works only as a
header, so it sits there and not in the `<meta>` tag.

The `<meta>` policy covers the page, not the custom-scenario worker: a worker
takes its policy from its own response, and the Worker sends none. The worker
compiles the WebAssembly kernel, so a Content-Security-Policy header served for
the whole site (for example from a host's `_headers` file) needs
`'wasm-unsafe-eval'` in `script-src` for `browser-worker`'s script. Leave it out
of the page's own policy, which compiles no WebAssembly.

The custom-scenario worker reads only the page's own browser dataset.
It sends no scenario to an external service. Matrix dimensions, finite values,
ids and percentage bounds are checked. Every matrix read is a single byte range
inside a shard whose size the manifest records, and a server that ignores Range
is refused, for the matrices and the embodied-flows Parquet file alike. Shard indexes must point inside their shard. The WebAssembly
kernel decodes each chunk and stops one byte past the row's size, and the
chunk's gzip size field and CRC-32 must match, so a crafted chunk cannot grow
past one row. A range read fails once the data host has sent nothing, to it or to any other read, for a minute, after one more try on a fresh request; the first load
fails after two minutes, and a threaded calculation call that runs over two minutes
is retried once on one thread. The data archive is pinned by `data/browser-engine-zarr.sha256` in CI
and publishing.

## What `?api=` accepts

`apiUrl` in `src/lib/live.js` turns the value into an origin, or ignores it. It accepts
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
So a live result is labelled "computed by the job API",
with the API's origin and provenance: check that origin before you trust it.
A live run never enters the shared link.

## What `?data=` accepts

`dataUrl` in `src/lib/explorer.js` accepts only a relative path ending in `.json`: the
first segment holds word characters and dashes, later segments may also hold
dots, and no segment is `..`. So `?data=` cannot point at another origin. Any
other value shows in the status line and the page reads `data/results.json`. A
file whose `data_kind` is not `exiobase-v3` gets the red synthetic-data banner.

## Cloudflare

The [Cloudflare deployment](publishing.md#cloudflare) and its pull-request previews send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. The browser can then use shared memory;
the [threaded kernel](browser-engine.md#browser-threads) uses it for broad dense calculations.
The app keeps its existing meta CSP.

The hosting Worker exposes only the pinned Parquet object for GET and HEAD.
It never accepts uploads or exposes arbitrary R2 keys. With the data host set, the bucket
itself is public, read-only, on its own hostname, with CORS for any origin: keep only
public data, keyed by hash, in it. Zarr store reads use the
Cache API for byte ranges; all other assets go directly through static hosting.
R2 credentials stay on Cloudflare or in the deployment environment, never in the browser.
The deploy token is a secret on the `cloudflare` GitHub environment and can change Workers
only. The environment allows every branch, because pull requests deploy previews, so any
workflow on a branch of this repository could name it and read the token. That includes the
retire run when a pull request turns draft, which runs the branch's own `preview-retire.yml`.
The workflows skip forks, drafts and bot pull requests, but a branch can change its own copy
of them, so the real limit is write access to the repository. The token can also deploy a
Worker bound to the R2 bucket, so a workflow holding it could write to the bucket; the bucket
lock below is what protects the published data. The deploy job builds without the Cargo
cache, so a poisoned cache cannot reach the token.
`data.yml` is the only workflow meant to write to R2, with a token scoped to the one bucket,
on the `data` environment, which takes `data-*` tags only. It writes each object once and
never deletes. A Worker's R2 binding can always write, so preview Workers get none and read
the data host. The production Worker keeps its binding to serve the Parquet file;
`cloudflare.yml` promotes it only from `main`. Bucket lock rules on `embodied/` and `browser-engine/` refuse any
overwrite or delete there for 365 days after an upload, whoever writes. `data.yml` compares each existing object's ETag, which R2
computes from the bytes, so it notices a replaced object.

## Secrets

The workflows hold three Cloudflare credentials, each as a secret on one GitHub environment:

| Secret | Environment | Can change |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `cloudflare` | Workers only |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `data` | the one R2 bucket |

Everything else uses GitHub's own short-lived token or, for attestations, the run's OIDC
identity, so there is nothing else to rotate.

- Each token gets an expiry date at Cloudflare of at most one year.
- Replace a token before it expires, at once if it may have leaked, and when anyone who could
  read it loses access. Make the new token with the same scope, update the environment secret,
  run the workflow that uses it, then delete the old token at Cloudflare.
- Only the maintainer can read or change the secrets.
