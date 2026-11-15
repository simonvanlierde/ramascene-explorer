# Task runner: https://just.systems. `just` lists the recipes. CI runs `py`, `page` and
# `rust` in ci.yml, so a recipe that passes here passes there.

# The browser store for the parity tests, when it is here (`just data store`). Empty
# otherwise, so those tests skip outside CI.
export BROWSER_ENGINE_DATA := env("BROWSER_ENGINE_DATA", if path_exists("data/browser-engine") == "true" { "data/browser-engine" } else { "" })

# List the recipes.
default:
    @just --list

# Everything CI checks except the browser tests (`just e2e`). Needs `just engine` and `just data`.
check: hooks py page rust

# The quick tests: the Python pipeline and the page logic, without lint or the Rust kernel.
test:
    uv run pytest
    pnpm test

# Every git hook over the whole repo, as hygiene.yml runs them (ruff and the formatters).
hooks:
    prek run -a

# ci.yml's precompute job: types, tests over the coverage floor, the README table against its results.
py:
    uv run ty check
    uv run pytest --cov=precompute --cov=compare_data
    uv run python brightway-check/table.py --check

# ci.yml's page job: lint and format, the page logic over the coverage floor, the browser store against Brightway.
page:
    pnpm exec biome ci .
    pnpm test
    node brightway-check/browser_check.js "$BROWSER_ENGINE_DATA"

# ci.yml's engine job: the Rust kernel, linted for wasm32 too, where its JavaScript exports compile. Needs cargo-nextest and cargo-deny.
[working-directory('engine')]
rust:
    cargo fmt --check
    cargo clippy --locked --target wasm32-unknown-unknown --all-targets -- -D warnings
    cargo clippy --locked --features threads --all-targets -- -D warnings
    RAYON_NUM_THREADS=4 cargo nextest run --locked --features threads
    cargo deny check

# Build the WebAssembly kernel into engine/pkg and engine/pkg-threads (docs/develop.md#view).
engine:
    pnpm engine

# Fetch and check the release data: embodied, store or all (scripts/fetch-data.sh).
data what="all":
    scripts/fetch-data.sh {{ quote(what) }}

# Build the page and run the browser tests; extra arguments reach Playwright (`just e2e --project=light`).
e2e *args:
    pnpm build
    pnpm exec playwright test {{ args }}
