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
geometry, `results.json`, `embodied.parquet` and the browser dataset. Both release
downloads are pinned by their checksums. It stops if `data/results.json` is missing or
isn't marked `data_kind: exiobase-v3`, so the synthetic fixture can never go out.

To check that the site serves range requests, ask for two bytes. The answer
must be `206`:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H 'Range: bytes=0-1' https://simonvanlierde.com/ramascene-explorer/data/embodied.parquet
```

## Check a release file

`release.yml` attests what a release ships: the `dist` tarball with its
`SHA256SUMS` when a `v*` release is published, and `embodied.parquet` on
`data-2011-r2` when run by hand from `main`. To check a downloaded file:

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

`cloudflare.yml` deploys it on every push to `main`. Each run first uploads a version
without serving it, then runs `hosting/check.js` against that version's preview URL in
the Playwright image. On `main`, only a version that passes the check goes on the
production routes. Each pull request from this repository stops after the check, which
runs in Chromium only (`CHECK_BROWSERS`); the run on `main` uses Chromium, Firefox and
WebKit. Only the first engine replays all 155 scenarios, which read the whole store: through
the Worker, those reads count toward its daily request allowance. The pull request keeps the
alias `pr-<number>`. Its version URL,
`https://pr-<number>-ramascene-explorer.<subdomain>.workers.dev/ramascene-explorer/`,
shows on the pull request as the `cloudflare` environment's deployment. Preview builds add
`X-Robots-Tag: noindex` to their `_headers`; production is indexed. Pull requests from
forks get no secrets, so they get no preview.

The site sends COOP and COEP headers so browsers can use shared memory. Broad dense
calculations can use the [threaded kernel](browser-engine.md#browser-threads).
Paths in `_headers` and `run_worker_first` are public paths, so they carry the prefix,
and the Worker drops `BASE_PATH` before it matches the data paths.

The app, fonts, maps and browser dataset ship as static assets. The Parquet file
exceeds Cloudflare's 25 MiB asset limit, so `public/.assetsignore` excludes it.
The Worker streams it from the `ramascene-explorer-data` R2 bucket at the same
`data/embodied.parquet` URL. Its R2 key includes the checksum from `results.json`,
so an older deployment keeps reading its own dataset.

Nothing deletes those older objects, so each data change leaves one in the bucket
(about 52 MB). Keep it while you might roll back to a version that reads it. After that,
find its checksum in the history of `data/embodied.sha256` and delete it:

```sh
git log -p --format=%h -- data/embodied.sha256
pnpm exec wrangler r2 object delete "ramascene-explorer-data/embodied/<old sha256>.parquet" --remote
```

Never delete the key the current `results.json` names: the live site reads it.

The local Workers asset server returns whole files for range requests.
The Worker therefore routes Zarr store reads through Cloudflare's Cache API,
which returns exact byte ranges from complete cached shards. A cold cache fetches
a complete shard internally; the browser receives only the requested range.
These reads and the Parquet reads invoke the Worker and count toward its request
allowance. Other static files are served directly. Each Parquet range request
uses one R2 GET (one Class B operation). A HEAD request, a range the Worker refuses
and a request with `If-Range` read the object's size and ETag first, one more Class B
operation. When R2 or the cache fails, the Worker answers 503 with `Retry-After`.
Uploading the file uses one PUT (one Class A operation). R2 reads and storage have their own usage charges. See [Cloudflare's pricing](https://developers.cloudflare.com/r2/pricing/).

Set up once:

1. Enable R2 in the Cloudflare account and create the bucket:
   `pnpm exec wrangler r2 bucket create ramascene-explorer-data`.
2. Create a `cloudflare` GitHub environment with the secret `CLOUDFLARE_API_TOKEN`, and set
   the repository variable `CLOUDFLARE_ACCOUNT_ID`. The environment allows every branch,
   because pull requests deploy previews. Scope the token to the account with Workers
   Scripts Write and Workers R2 Storage Write, and to the simonvanlierde.com zone with
   Workers Routes Write. Local OAuth login does not configure GitHub Actions.

## Data host

The Worker counts every request it runs, refused ones included, and the free plan allows
100,000 a day. One custom scenario reads about 270 byte ranges, so serving the data through
the Worker caps how many scenarios a day the site can run. The data can come from R2
directly instead, with no Worker in the path:

- `cloudflare.yml` uploads the Parquet file as `embodied/<sha256>.parquet` and the browser
  store as `browser-engine/store-<hash>/...`, both with an immutable `Cache-Control`. A store
  goes up once: the `.complete` marker, written last, tells later runs it is all there.
- The page needs CORS, because it is cross-origin isolated. The data is public, so any origin
  may read it, previews on `workers.dev` included.
- With the repository variable `DATA_ORIGIN` set (for example
  `https://ramascene-data.simonvanlierde.com/`), the build bakes it in as
  `VITE_DATA_ORIGIN`. The page then reads both files from that host by their hashes, and
  `hosting/check.js` checks ranges, CORS and caching there. `results.json` and the store's
  manifest still ship with the page, so each deployment names its own data.
- Without the variable, the page reads the data next to itself, through the Worker, as above.

Set up once:

1. R2 → `ramascene-explorer-data` → Settings → Custom Domains → add
   `ramascene-data.simonvanlierde.com`.
2. Caching → Cache Rules → hostname equals `ramascene-data.simonvanlierde.com`, Eligible for
   cache, edge TTL from the origin. Cloudflare caches only some file types by default, and the
   shards have no extension.
3. Rules → Transform Rules → Modify Response Header → hostname equals
   `ramascene-data.simonvanlierde.com`, set `Access-Control-Allow-Origin: *` and
   `Access-Control-Expose-Headers: Content-Range, ETag`. R2 adds CORS headers only to requests
   that send `Origin`, and the edge cache ignores `Vary: Origin`: without this rule, one plain
   read caches a copy the page cannot use, for a year.
4. Set the bucket's CORS rule, for preflights:
   `pnpm exec wrangler r2 bucket cors set ramascene-explorer-data --file hosting/r2-cors.json`.
5. After a `main` run has uploaded the store, set the `DATA_ORIGIN` variable and run
   `gh workflow run cloudflare.yml --ref main`.

`hosting/check.js` reads each data file without and then with `Origin`, so a cached copy
without CORS headers fails it. To go back to the Worker, delete the variable and run the
workflow again: every version still ships the store, and the Worker still serves the Parquet.
Cache misses are R2 reads (Class B operations). A second input-output database is a new
upload under its own keys, with no change to the Worker.

Old stores stay in the bucket too, about 770 MB each. To delete one the live manifest does not
name, delete its `browser-engine/store-<hash>/.complete` marker first, so a later run uploads
it again in full, then the objects under that prefix.

Release files are checksum-verified before upload. CI runs `hosting/check.js` against the
local Workers runtime with a local R2 object; it needs no Cloudflare credentials. The check
covers HEAD and exact ranges for both data sources, immutable shard caching, cross-origin
isolation, the map and a custom calculation in Chromium, Firefox and WebKit, and the 155
published scenarios in the first of them. To run it
yourself, build the kernel and the site, then:

```sh
key=$(node -p '"embodied/" + require("./data/results.json").provenance.embodied.sha256 + ".parquet"')
pnpm exec wrangler r2 object put "ramascene-explorer-data/$key" --file data/embodied.parquet --local
pnpm exec wrangler dev --port 4191 --ip 127.0.0.1 --local
node hosting/check.js http://127.0.0.1:4191/ramascene-explorer/   # in another terminal
```

Pass a preview's version URL instead to check a pull request's deployment, as `cloudflare.yml` does.
The compatibility date matches the runtime bundled with the pinned Wrangler release.

SSL/TLS on the zone stays Full, not Full (strict): GitHub's certificate renewal can fail
behind the proxy. With Flexible, Cloudflare asks GitHub Pages over HTTP, Pages redirects
to HTTPS, and every page on the domain loops.

To roll back a bad production deploy, run `pnpm exec wrangler rollback` and pick the last
good version; it needs no rebuild.
