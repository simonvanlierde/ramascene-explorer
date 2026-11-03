import { openSync, readSync } from "node:fs";
import { shardPath } from "../src/lib/browser-engine/browser-data.js";

// readRange for an export on disk, as the parity tests and checks use it.
export function localRange(directory, meta) {
	const files = new Map();
	return async (name, shard, start, end) => {
		const path = `${directory}/${shardPath(meta, name, shard)}`;
		if (!files.has(path)) files.set(path, openSync(path, "r"));
		const bytes = new Uint8Array(end - start);
		readSync(files.get(path), bytes, 0, bytes.length, start);
		return bytes.buffer;
	};
}
