#!/usr/bin/env bash
# Run inside the browser test image through oss-bench.
set -euo pipefail
key=$(node -p '"embodied/" + require("./data/results.json").provenance.embodied.sha256 + ".parquet"')
node node_modules/wrangler/bin/wrangler.js r2 object put "ramascene-explorer-data/$key" --file data/embodied.parquet --local --persist-to /tmp/ramascene-threads-state
node node_modules/wrangler/bin/wrangler.js dev --port 4193 --ip 127.0.0.1 --local --persist-to /tmp/ramascene-threads-state >/tmp/ramascene-threads-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in {1..30}; do
	if curl -fsS http://127.0.0.1:4193/ramascene-explorer/ >/dev/null; then break; fi
	sleep 1
done
output=docs/measurements/browser-engine-threads.json
if [ "${2:-}" = threshold ]; then
	output=docs/measurements/browser-engine-thread-threshold${3:+-$3}.json
elif [ -n "${2:-}" ]; then
	output=docs/measurements/browser-engine-thread-scaling.json
fi
node measure-browser-threads.js http://127.0.0.1:4193/ramascene-explorer/ "$output" "${1:-3}" "${2:-}"
