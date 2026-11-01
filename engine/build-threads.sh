#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/threads"
# The pinned nightly and rust-src are declared beside this build's Cargo config.
rustup toolchain install
cargo build --locked --manifest-path ../Cargo.toml --release --target wasm32-unknown-unknown --features threads -Z build-std=std,panic_abort
target=$(cargo metadata --manifest-path ../Cargo.toml --format-version 1 --no-deps | sed 's/.*"target_directory":"\([^"]*\)".*/\1/')
wasm-bindgen --target web --no-typescript --out-name index --out-dir ../pkg-threads "$target/wasm32-unknown-unknown/release/ramascene_engine.wasm"
