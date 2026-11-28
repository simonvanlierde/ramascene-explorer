# Run, build and test the page

The page is Svelte 5, built with Vite. [CONTRIBUTING.md](../CONTRIBUTING.md) lists the tools
and the checks to run before you push.

## View

1. Install the Node version in `.node-version`, pnpm, [just](https://just.systems) and
   [rustup](https://rustup.rs/). Then install the page's packages:

   ```sh
   pnpm install
   ```

2. Install `wasm-bindgen-cli` at the version of the `wasm-bindgen` crate in
   `engine/Cargo.lock`. The first command prints that version after the `@`:

   ```sh
   cargo pkgid --locked --manifest-path engine/Cargo.toml wasm-bindgen
   cargo install wasm-bindgen-cli --version <that version> --locked
   ```

3. Build the custom-scenario kernel, which is Rust built to WebAssembly. Run this again
   after you change `engine/`:

   ```sh
   pnpm engine
   ```

   It writes `engine/pkg/` and `engine/pkg-threads/`, which `pnpm dev`, `pnpm build` and
   `pnpm test` import. It stops with "needs wasm-bindgen-cli" when the version from step 2
   does not match. The threaded build installs the pinned nightly and `rust-src` declared in
   `engine/threads/rust-toolchain.toml`, and rebuilds the standard library with WebAssembly
   atomics.

4. Fetch the data. The map flows and the custom-scenario store are release assets, not in
   git. `scripts/fetch-data.sh` fetches them into `data/` with curl, checks them against
   `data/*.sha256`, and checks that `data/results.json` names the same embodied flows:

   ```sh
   scripts/fetch-data.sh embodied   # the map flows (52 MB); enough to view the page
   scripts/fetch-data.sh store      # the custom-scenario store (an 803 MB tar)
   ```

5. Start the page:

   ```sh
   pnpm dev        # dev server with live reload, on http://localhost:5173/
   pnpm build      # static site in dist/, with relative paths
   pnpm preview    # serves dist/ on http://127.0.0.1:4180/
   ```

6. With `pnpm dev` running, open <http://localhost:5173/>. The map opens on Germany, with no red synthetic-data banner.

Then try `?mode=whatif&scenario=coal-power-china` or
`?region=CN&dir=out&indicator=7&sections=2`. Add `data=tests/fixture.json` to
see the page on the synthetic fixture.
The URL stores the filters and the published scenario. It does not store a custom
result: a shared link opens the last published scenario.
The [URL reference](interface.md#url-parameters) lists every parameter.

## Social card

`public/og.png` is rendered by `scripts/og-card.js`: it opens the built page on Germany, takes the
globe, and sets it in a 1200 x 630 poster with the headline figure read from the page's own
sentence. Run `pnpm build`, then `node scripts/og-card.js`, after the map's look or the sample
numbers change. It needs `data/embodied.parquet`.

## Build

`pnpm build` writes a static site to `dist/`, with `data/` and `geo/` copied in
when present. Any static host serves it, as long as it answers HTTP range
requests: the page reads the Parquet file in pieces. Publishing to Cloudflare
is in [publishing.md](publishing.md#cloudflare).

## Data and reproducibility

The published results come from one run on 2026-11-01, using engine
`split/3-performance @ d9113ca`, the head of
[CMLPlatform/ramascene#74](https://github.com/CMLPlatform/ramascene/pull/74).
`data/results.json` holds the scenario totals, parameters, checks and provenance.
`data/embodied.parquet` holds the map flows and ships as a release asset.
The [precompute guide](precompute.md) explains how to reproduce both.

`data/regions.json` and `data/flows.json` hold extra checks; the page does not read them.
`brightway-check/` is a separate uv project with its own dependency pins.
`tests/fixture.json` and `tests/fixture-embodied.parquet` are synthetic fixtures.
Any dataset whose `data_kind` is not `exiobase-v3` gets a red
“SYNTHETIC TEST DATA: NOT A RESULT” banner.

## Test

The [justfile](../justfile) holds the checks; ci.yml runs the same recipes. `just` lists them.

```sh
just check                             # all of the below except e2e: what CI runs
just hooks                             # the git hooks: ruff, biome, repo-review and the formatters
just py                                # ty, pytest over the coverage floor, the README table
just page                              # biome, the page logic over the coverage floor, the browser store
just rust                              # the Rust kernel: fmt, clippy, nextest, cargo deny
just e2e                               # the built page in six browser setups, with axe (once: pnpm exec playwright install chromium firefox webkit)
just test                              # the quick tests: pytest and pnpm test, no lint
uv run pytest --engine="$ENGINE_DIR"   # adds checks that need the engine and EXIOBASE arrays
pnpm mutation                          # mutation score with Stryker (about 4 minutes); fails below 75%
```

`just page` and the browser parity tests read the store: fetch it with `just data store`.
`BROWSER_ENGINE_DATA=data/browser-engine uv run pytest tests/test_numpy_engine.py` runs the numpy engine's parity test on its own.

The citesync hook requires a name, version, author, licence and DOI in both `CITATION.cff` and `codemeta.json`.
[citesync.toml](../citesync.toml) lists the required fields.

`pnpm mutation` mutates `src/lib/flows.js`, `src/lib/range.js` and
`src/lib/browser-engine/browser-data.js` and `browser-engine.js`
(`stryker.config.json` lists them).

Write `--engine=PATH` with the `=`. Without it, pytest takes the path as its
root directory and loads the engine's own `conftest.py`.

## Benchmark

```sh
pnpm bench   # the page's per-selection work, with Vitest
```

The benchmarks run on the small test fixtures and take microseconds, so CI
doesn't run them: runner noise is bigger than any change they could show. Run
them before and after a change to the code they cover.

To compare two trees, check each out in its own worktree and run `pnpm bench`
in both. Alternate the order each round (old, new, then new, old) for at least
five rounds, and compare medians of the `mean` column, not single runs. When a
tree has new fixtures or new benchmarks, run the old code on the new fixtures
too, or a slowdown may only be the bigger input.
