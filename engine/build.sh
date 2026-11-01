#!/usr/bin/env bash
# Builds the kernel to wasm and writes its JS glue to engine/pkg.
# Needs the wasm32 target (rust-toolchain.toml) and wasm-bindgen-cli at the
# version of the wasm-bindgen crate in Cargo.lock.
set -euo pipefail
cd "$(dirname "$0")"
want=$(cargo pkgid --locked wasm-bindgen | sed 's/.*@//')
have=$(wasm-bindgen --version 2>/dev/null | cut -d' ' -f2)
if [ "$have" != "$want" ]; then
	echo "needs wasm-bindgen-cli $want, found ${have:-none}" >&2
	exit 1
fi
cargo build --locked --release --target wasm32-unknown-unknown
# CARGO_TARGET_DIR or build.target-dir can move the output away from engine/target.
target=$(cargo metadata --format-version 1 --no-deps | sed 's/.*"target_directory":"\([^"]*\)".*/\1/')
wasm-bindgen --target web --no-typescript --out-dir pkg "$target/wasm32-unknown-unknown/release/ramascene_engine.wasm"

./build-threads.sh
