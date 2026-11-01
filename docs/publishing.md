# CI and publishing

`.github/workflows/ci.yml` runs ruff, ty, `uv run pytest --cov`,
`brightway-check/table.py --check`, `biome ci`,
`pnpm test` and `pnpm exec playwright test`. None of them needs the engine or
the EXIOBASE matrices, because the engine checks skip without `--engine`.
Both test steps fail below a line-coverage floor: `fail_under` in
`pyproject.toml` for `precompute.py` and `compare_data.py`, and the `test`
script in `package.json` for the JS modules (not the Svelte files).

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

`pages.yml` publishes to <https://simonvanlierde.com/ramascene-explorer/>
only when started by hand (Actions → pages → Run workflow), and only from
`main`. Before you run it, commit the precompute output. The workflow ships the
bundled page and fonts, the map geometry, `results.json`, `embodied.parquet`
and the browser dataset. Both release downloads are pinned by their checksums.
It stops if `data/results.json` is missing or isn't marked
`data_kind: exiobase-v3`, so the synthetic fixture can never go out.
The build also refuses a site of 1 GB or more.

To check that Pages serves range requests, ask for two bytes. The answer
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
`assets.base_path` serves `dist/` under that prefix, so the domain's other pages stay on
GitHub Pages. The routes take effect once the domain's DNS records are proxied through
Cloudflare; until then GitHub Pages serves the site at the same address.

`cloudflare.yml` deploys it on every push to `main`. Each pull request from this
repository uploads a version without deploying it, with the alias `pr-<number>`. Its
version URL, `https://pr-<number>-ramascene-explorer.<subdomain>.workers.dev/ramascene-explorer/`,
shows on the pull request as the `cloudflare` environment's deployment. Preview builds add
`X-Robots-Tag: noindex` to their `_headers`; production is indexed. Pull requests from
forks get no secrets, so they get no preview.

The site sends COOP and COEP headers so browsers can use shared memory. The current kernel
still uses one thread; hosting alone does not make calculations multithreaded.
Paths in `_headers` and `run_worker_first` are public paths, so they carry the prefix,
and the Worker drops `BASE_PATH` before it matches the data paths.

The app, fonts, maps and browser dataset ship as static assets. The Parquet file
exceeds Cloudflare's 25 MiB asset limit, so `public/.assetsignore` excludes it.
The Worker streams it from the `ramascene-explorer-data` R2 bucket at the same
`data/embodied.parquet` URL. Its R2 key includes the checksum from `results.json`,
so an older deployment keeps reading its own dataset.

The local Workers asset server returns whole files for range requests.
The Worker therefore routes Zarr store reads through Cloudflare's Cache API,
which returns exact byte ranges from complete cached shards. A cold cache fetches
a complete shard internally; the browser receives only the requested range.
These reads and the Parquet reads invoke the Worker and count toward its request
allowance. Other static files are served directly. Each Parquet range request
uses one R2 HEAD and one GET (two Class B operations); uploading the file uses
one PUT (one Class A operation). R2 reads and storage have their own usage charges. See [Cloudflare's pricing](https://developers.cloudflare.com/r2/pricing/).

Set up once:

1. Enable R2 in the Cloudflare account and create the bucket:
   `pnpm exec wrangler r2 bucket create ramascene-explorer-data`.
2. Create a `cloudflare` GitHub environment with the secret `CLOUDFLARE_API_TOKEN`, and set
   the repository variable `CLOUDFLARE_ACCOUNT_ID`. The environment allows every branch,
   because pull requests deploy previews. Scope the token to the account with Workers
   Scripts Write and Workers R2 Storage Write, and to the simonvanlierde.com zone with
   Workers Routes Write. Local OAuth login does not configure GitHub Actions.

Release files are checksum-verified before upload. CI runs `hosting/check.js` against the
local Workers runtime with a local R2 object; it needs no Cloudflare credentials. The check
covers HEAD and exact ranges for both data sources, immutable shard caching, cross-origin
isolation, the map and a custom calculation in Chromium, Firefox and WebKit. To run it
yourself, build the kernel and the site, then:

```sh
key=$(node -p '"embodied/" + require("./data/results.json").provenance.embodied.sha256 + ".parquet"')
pnpm exec wrangler r2 object put "ramascene-explorer-data/$key" --file data/embodied.parquet --local
pnpm exec wrangler dev --port 4191 --ip 127.0.0.1 --local
node hosting/check.js http://127.0.0.1:4191/ramascene-explorer/   # in another terminal
```

Pass a preview's version URL instead to check a pull request's deployment.
The compatibility date matches the runtime bundled with the pinned Wrangler release.

To switch production from GitHub Pages:

1. Run the check against a pull request's preview URL.
2. In Cloudflare, proxy the simonvanlierde.com DNS records and set SSL/TLS to Full, not
   Full (strict): GitHub's certificate renewal can fail behind the proxy.
3. Run the check against `https://simonvanlierde.com/ramascene-explorer/`.
4. Remove `pages.yml` once production has served a few days.
