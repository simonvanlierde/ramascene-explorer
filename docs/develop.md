# Run, build and test the page

The page is Svelte 5, built with Vite. [CONTRIBUTING.md](../CONTRIBUTING.md) lists the tools
and the checks to run before you push.

## View

Use Node 26 and pnpm. Install once with `pnpm install`. The custom-scenario kernel
in `engine/` is Rust built to WebAssembly: with [rustup](https://rustup.rs/) and
`wasm-bindgen-cli` at the version of the `wasm-bindgen` crate in `engine/Cargo.lock`
(`cargo install wasm-bindgen-cli --version <that version> --locked`), run
`pnpm engine` once, and again after changing `engine/`. It writes `engine/pkg/` and `engine/pkg-threads/`, which `pnpm dev`, `pnpm build` and `pnpm test` import. The threaded build installs
the pinned nightly and `rust-src` declared in `engine/threads/rust-toolchain.toml`.
It rebuilds the standard library with WebAssembly atomics. The map flows are a release
asset, not in git, so fetch them into `data/`:

```sh
gh release download data-2011-r2 --pattern embodied.parquet --dir data
# or, without the GitHub CLI:
curl -L -o data/embodied.parquet https://github.com/simonvanlierde/ramascene-explorer/releases/download/data-2011-r2/embodied.parquet
```

Then:

```sh
pnpm dev        # dev server with live reload, on http://localhost:5173/
pnpm build      # static site in dist/, with relative paths
pnpm preview    # serves dist/ on http://127.0.0.1:4180/
```

Open `?mode=whatif&scenario=coal-power-china` or
`?region=CN&dir=out&indicator=7&sections=2`. Add `data=tests/fixture.json` to
see the page on the synthetic fixture.
The URL stores the filters and the published scenario. It does not store a custom
result: a shared link opens the last published scenario.
The [URL reference](interface.md#url-parameters) lists every parameter.

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

```sh
uv run pytest                          # everything except the engine adapter
uv run pytest --engine="$ENGINE_DIR"   # adds checks that need the engine and EXIOBASE arrays
pnpm test                              # the page logic, with the coverage floor
pnpm exec playwright test              # the built page in six browser setups, with axe (once: pnpm exec playwright install chromium firefox webkit)
pnpm mutation                          # mutation score of src/lib/flows.js with Stryker (about 4 minutes); fails below 75%
(cd engine && cargo fmt --check && cargo clippy --locked --target wasm32-unknown-unknown --all-targets -- -D warnings && cargo clippy --locked --features threads --all-targets -- -D warnings && RAYON_NUM_THREADS=4 cargo nextest run --locked --features threads && cargo deny check)  # the Rust kernel, as CI runs it
```

Write `--engine=PATH` with the `=`. Without it, pytest takes the path as its
root directory and loads the engine's own `conftest.py`.

## Benchmark

```sh
pnpm bench   # the page's per-selection work, with Vitest
```

The benchmarks run on the small test fixtures and take microseconds, so CI
doesn't run them: runner noise is bigger than any change they could show. Run
them before and after a change to the code they cover.
