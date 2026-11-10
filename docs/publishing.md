# CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest --cov`,
`brightway-check/table.py --check`, `biome ci`,
`pnpm test` and `pnpm exec playwright test`. None of them needs the engine or
the EXIOBASE matrices, because the engine checks skip without `--engine`.
Both test steps fail below a line-coverage floor: `fail_under` in
`pyproject.toml` for `pipeline/precompute.py` and `pipeline/compare_data.py`, and the `test`
script in `package.json` for the JS modules (not the Svelte files).
Playwright runs as one job per browser engine (Chromium, Firefox, WebKit) with
four workers each; the required check `browser and accessibility tests` passes
only when all three did.

The page jobs read the synthetic fixtures and the shipped results. CI
downloads `embodied.parquet` from the `data-2011-r2` release and checks it with
`sha256sum --check data/embodied.sha256`. In CI the real-data checks fail
rather than skip when the file is missing. The browser tests run in Chromium
(the light theme, the dark theme and a phone), Firefox, desktop Safari and an iPhone (WebKit),
with axe checking WCAG 2.2 AA.

The page jobs also download the [browser dataset](browser-engine.md#build-or-download-the-data),
verify `data/browser-engine-zarr.sha256`, and rerun every published scenario at relative 1e-6
with `BROWSER_ENGINE_DATA=data/browser-engine`. The browser smoke test uses the
real export. The other agreement routes use committed results; only the browser
route is rerun in these jobs.

The pnpm version is pinned once, in `packageManager` in `package.json`; the
workflows' `pnpm/action-setup` steps read it.

`cloudflare.yml` publishes the site ([Cloudflare](#cloudflare)). Commit the precompute
output before you merge it. The workflow ships the bundled page and fonts, the map
geometry, `results.json` and the browser store's manifest, whose release download is pinned
by its checksum. `embodied.parquet` and the store go to R2 separately, through
[`data.yml`](#publish-the-data). The deploy stops if `data/results.json` is missing or
isn't marked `data_kind: exiobase-v3`, so the synthetic fixture can never go out.

To check that the [data host](#data-host) serves range requests, ask for two bytes. The
answer must be `206`:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-1' "https://ramascene-data.simonvanlierde.com/embodied/$(cut -d' ' -f1 data/embodied.sha256).parquet"
```

## Check a release file

`release.yml` attests what a release ships: the `dist` tarball with its
`SHA256SUMS` when a `v*` release is published, and `embodied.parquet` on
`data-2011-r2` when run by hand from `main`. From v0.7.0 on, a release also carries
`<tarball>.cdx.json`, a CycloneDX SBOM of the npm packages the page ships, attested
against the tarball. To check a downloaded file:

```sh
gh attestation verify <file> --repo simonvanlierde/ramascene-explorer --signer-workflow simonvanlierde/ramascene-explorer/.github/workflows/release.yml
```

For `embodied.parquet`, add `--source-ref refs/heads/main`. Add
`--bundle <file>.sigstore.json` to check against the downloaded bundle instead
of GitHub's attestation store.

## Tags

Each `v*` tag from v0.4.0 on is signed (`git tag -s`) with an SSH key that
GitHub knows, so the tag shows as Verified on GitHub. To check one locally,
add the maintainer's signing keys (listed at
<https://api.github.com/users/simonvanlierde/ssh_signing_keys>) to the file
`gpg.ssh.allowedSignersFile` names, then run `git verify-tag v0.4.0`.

## Svelte coverage

`pnpm test` measures the JS modules only. The browser tests can measure the
Svelte files too, in Chromium:

```sh
COVERAGE=1 pnpm build
CI=1 COVERAGE=1 pnpm exec playwright test --project light --project dark --project phone
pnpm measure-coverage
```

A Svelte line counts when the build made code from it, and is covered when any
test ran that code. On 2026-10-27 the browser tests covered 92.1% of the
Svelte lines (1,397 of 1,517); `Sentence.svelte` was lowest at 69.3%. One
`load.spec.js` test alone covers 50.4%. CI does not run this, so the number is
a snapshot, not a gate.

## Cloudflare

`wrangler.jsonc` describes one Worker, `ramascene-explorer`, on the routes
`simonvanlierde.com/ramascene-explorer` and `simonvanlierde.com/ramascene-explorer/*`.
`pnpm build:cloudflare` builds into `site/ramascene-explorer/`, so the assets sit under that
prefix. The domain's DNS records are proxied through Cloudflare, so these routes take
production, and the domain's other pages still come from GitHub Pages through the proxy.

`cloudflare.yml` deploys it on every push to `main`. The run builds the site, checks that
the data this commit names is [published](#publish-the-data), and uploads a version without
serving it. It then runs `hosting/check.js` against that version's URL in the Playwright
image, in Chromium, Firefox and WebKit. Only a version that passes goes on the production
routes. Only the first engine replays all 155 scenarios, which read the whole store from the
data host.

Each ready pull request from this repository gets its own preview Worker,
`ramascene-explorer-pr-<number>`, deployed from `wrangler.preview.jsonc` and checked in
Chromium only (`CHECK_BROWSERS`). Its only address,
`https://ramascene-explorer-pr-<number>.<subdomain>.workers.dev/ramascene-explorer/`, shows
on the pull request as the `cloudflare` environment's deployment; the bare address redirects
there (`public/_redirects`). Version URLs are off for these Workers, so nothing else serves
the build. Previews add `X-Robots-Tag: noindex` to their `_headers`; production is indexed.

A preview is live only while its pull request is open and not a draft:

- Drafts, pull requests from forks and bot pull requests (any author ending in `[bot]`, so
  Renovate) get no preview job, so their code never runs with the token.
- Before it deploys, the job reads the pull request again, so a late run cannot bring back
  the preview of one that has closed or turned draft.
- `preview-retire.yml` deletes the Worker through the Cloudflare API when the pull request
  closes, merges or turns draft, and fails unless the address then answers 404. It first
  waits, up to 10 minutes, for that commit's `cloudflare.yml` run, so a preview check still
  running is not left testing a deleted Worker. A run whose deploy is still queued behind
  the retire is not waited for. Its daily
  sweep deletes any `ramascene-explorer-pr-<number>` Worker whose pull request is no longer
  open and ready. To retire some by hand: `gh workflow run preview-retire.yml -f prs="12 13"`.

Earlier pull requests uploaded versions of the production Worker with a `pr-<number>` alias.
Those `pr-<number>-ramascene-explorer` URLs still serve their builds; the retire workflow
does not touch the production Worker.

The site sends COOP and COEP headers so browsers can use shared memory. Broad dense
calculations can use the [threaded kernel](browser-engine.md#browser-threads).
Paths in `_headers` are public paths, so they carry the prefix.

The Worker serves static assets only and runs no code of its own, so its requests do not
count toward the Workers request allowance. The app, fonts, maps, `results.json` and the
store's manifest ship as assets. The page reads the Parquet file and the store's shards from
the [data host](#data-host), so a deploy needs `DATA_ORIGIN`, and `public/.assetsignore`
keeps both out of the upload. Their keys include their checksums, so an older deployment
keeps reading its own dataset.

No workflow deletes those older objects, so each data change leaves one in the bucket
(about 52 MB). Keep it while you might roll back to a version that reads it. After that,
find its checksum in the history of `data/embodied.sha256` and delete it with your own
login (the workflows' tokens are not meant for this):

```sh
git log -p --format=%h -- data/embodied.sha256
pnpm exec wrangler r2 object delete "ramascene-explorer-data/embodied/<old sha256>.parquet" --remote
```

Never delete the key the current `results.json` names: the live site reads it, and every
deploy checks it is there.

Set up once:

1. Enable R2 in the Cloudflare account and create the bucket:
   `pnpm exec wrangler r2 bucket create ramascene-explorer-data`.
2. Create a `cloudflare` GitHub environment with the secret `CLOUDFLARE_API_TOKEN`, and set
   the repository variable `CLOUDFLARE_ACCOUNT_ID`. The environment allows every branch,
   because pull requests deploy previews. Scope the token to the account with Workers
   Scripts Write, and to the simonvanlierde.com zone with Workers Routes Write. It needs no
   R2 permission: the deploys never write to the bucket. Local OAuth login does not
   configure GitHub Actions.
3. Set up [data publishing](#publish-the-data).

## Publish the data

`data.yml` puts a data release's files in the `ramascene-explorer-data` bucket. It runs when
a `data-*` release is published, or by hand:
`gh workflow run data.yml --ref <tag> -f tag=<tag>`. The tag's commit must contain
`data.yml`: `data-2011` and `data-2011-r2` predate it, so their data, already in the bucket,
can only be published again through a new `data-*` release. It checks the release files against the
committed `data/embodied.sha256` and `data/browser-engine-zarr.sha256` of the commit it runs
on, and skips a release file with another checksum, such as an older Parquet on the same
release. It then uploads through R2's S3 API:

- the Parquet file as `embodied/<sha256>.parquet`, and
- the browser store as `browser-engine/store-<hash>/...`, eight files at a time, then the
  `browser-engine/store-<hash>/.complete` marker last, so the marker means the store is whole.

All of them get an immutable `Cache-Control`. Each key is written once (`If-None-Match: *`).
When a key is already there, the run passes only if the object has the same size, and the
same SHA-256 where its metadata stores one; anything else fails the run. Nothing is deleted.

Every deploy and preview checks, over HTTPS on `DATA_ORIGIN`, that the Parquet file and the
store's `.complete` marker its commit names are there. If not, it fails with "the data for
this commit is not published". So publish a data release, and let `data.yml` finish, before
you merge the commit that reads it.

Set up once:

1. R2 → Manage API tokens → Create Account API token
   (`https://dash.cloudflare.com/<account id>/r2/api-tokens`): Object Read & Write, applied
   to the `ramascene-explorer-data` bucket only.
2. Create a `data` GitHub environment whose deployment policy allows the tag pattern `data-*`
   only, with the secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from that token, and
   the variable `R2_ACCOUNT_ID` (the same account ID as `CLOUDFLARE_ACCOUNT_ID`).

## Data host

The deployed page reads the Parquet file and the browser store straight from R2, on the
bucket's own hostname, with no Worker in the path. One custom scenario reads about 270 byte
ranges.

- [`data.yml`](#publish-the-data) puts the Parquet file and the browser store in the bucket
  under their hashes.
- The page needs CORS, because it is cross-origin isolated. The data is public, so any origin
  may read it, previews on `workers.dev` included.
- The repository variable `DATA_ORIGIN` (for example
  `https://ramascene-data.simonvanlierde.com/`) names the host, and the build bakes it in as
  `VITE_DATA_ORIGIN`. The page then reads both files from that host by their hashes, and
  `hosting/check.js` checks ranges, CORS and caching there. `results.json` and the store's
  manifest still ship with the page, so each deployment names its own data.
- Every deploy and preview needs the variable: without it, `cloudflare.yml` stops before it
  uploads anything. A build without it, such as `pnpm build` for the tests, reads the data
  next to the page.

Set up once:

1. R2 → `ramascene-explorer-data` → Settings → Custom Domains → add
   `ramascene-data.simonvanlierde.com`.
2. Caching → Cache Rules → hostname equals `ramascene-data.simonvanlierde.com`, Eligible for
   cache, edge TTL from the origin. Cloudflare caches only some file types by default, and the
   shards have no extension.
3. Rules → Overview → Create rule → Response Header Transform Rule (not the request-header
   kind) → hostname equals `ramascene-data.simonvanlierde.com`: Set static
   `Access-Control-Allow-Origin` to `*` and `Access-Control-Expose-Headers` to
   `Content-Range, ETag`. Leave the bucket without a CORS policy.
4. Caching → Configuration → Custom Purge → Hostname → `ramascene-data.simonvanlierde.com`.
5. Set the `DATA_ORIGIN` variable and run `gh workflow run cloudflare.yml --ref main`.

R2 adds CORS headers only when it answers a read itself, and the edge can serve a copy cached
without them for a year; that broke production once. The response-header rule sets the
headers on every answer, cached ones included, so the CORS headers have one source. The page
sends no preflight requests (single-range reads need none), so R2 never has to answer
`OPTIONS`. `hosting/check.js` reads each data file without `Origin`, with the version's
origin and with production's, and fails on a missing header.
Cache misses are R2 reads (Class B operations); R2 reads and storage have their own
[usage charges](https://developers.cloudflare.com/r2/pricing/). A second input-output
database is a new upload under its own keys, with no change to the site's hosting.

Old stores stay in the bucket too, about 770 MB each. To delete one the live manifest does not
name, delete its `browser-engine/store-<hash>/.complete` marker first, so no deploy takes the
store as whole while you delete it, then the objects under that prefix. To bring it back, run
`data.yml` for its release again.

`cloudflare.yml` runs `hosting/check.js` against each preview and each uploaded version. The
check covers HEAD, exact ranges, CORS and immutable caching on the data host, cross-origin
isolation, the map and a custom calculation in Chromium, Firefox and WebKit, and the 155
published scenarios in the first of them. To check a deployment yourself:

```sh
DATA_ORIGIN=https://ramascene-data.simonvanlierde.com/ node hosting/check.js <preview or version URL>
```

The compatibility date matches the runtime bundled with the pinned Wrangler release.

SSL/TLS on the zone stays Full, not Full (strict): GitHub's certificate renewal can fail
behind the proxy. With Flexible, Cloudflare asks GitHub Pages over HTTP, Pages redirects
to HTTPS, and every page on the domain loops.

To roll back a bad production deploy, run `pnpm exec wrangler rollback` and pick the last
good version; it needs no rebuild.
