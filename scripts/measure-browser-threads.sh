#!/usr/bin/env bash
# Run inside the browser test image through oss-bench, after pnpm build.
set -euo pipefail
# vite preview serves dist/ with byte ranges; the headers give it the cross-origin
# isolation the deployed site gets from _headers, which threads need.
node --input-type=module -e '
import { preview } from "vite";
await preview({ preview: { port: 4193, headers: {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
} } });
' >/tmp/ramascene-threads-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in {1..30}; do
	if curl -fsS http://127.0.0.1:4193/ >/dev/null; then break; fi
	sleep 1
done
output=docs/measurements/browser-engine-threads.json
if [ "${2:-}" = threshold ]; then
	output=docs/measurements/browser-engine-thread-threshold${3:+-$3}.json
elif [ -n "${2:-}" ]; then
	output=docs/measurements/browser-engine-thread-scaling.json
fi
node scripts/measure-browser-threads.js http://127.0.0.1:4193/ "$output" "${1:-3}" "${2:-}"
