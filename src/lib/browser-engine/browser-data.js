import { decode } from "../../../engine/pkg/ramascene_engine.js";
import { DATA_ORIGIN } from "../data-origin.js";

// The browser export is a float32 Zarr v3 store (pipeline/export_browser.py): each array
// is sharded by producing country, with gzip chunks of whole rows and a shard
// index of (offset, size) uint64 pairs at the end of each shard file.
const EMPTY = 0xffffffffffffffffn;
// Each request is one byte range: many static hosts answer a multi-range request
// with the whole file. Chunks closer than GAP share a request.
const GAP = 64 * 1024;
// At most PARALLEL × MAX_RANGE bytes in flight per array.
const MAX_RANGE = 1024 ** 2;
const PARALLEL = 64;

const SHAPES = { A: [9800, 9800], L: [9800, 9800], LC: [9800, 9800], H: [9800, 2205], X: [9800, 49], Y: [9800, 49] };

// readRange(shard, start, end) resolves to that byte range of the shard file.
export function arrayReader(info, readRange, { cacheBytes = 16 * 1024 ** 2 } = {}) {
	if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 0) throw new Error("invalid matrix cache budget");
	const [height, width] = info.shape;
	const rows = info.chunk_rows;
	const perShard = info.shard_rows / rows;
	const indexes = new Map();
	const cache = new Map();
	let retained = 0;

	function index(shard) {
		if (!indexes.has(shard)) {
			const size = info.shard_bytes[shard];
			const start = size - 16 * perShard;
			indexes.set(
				shard,
				readRange(shard, start, size)
					.then((buffer) => {
						if (buffer.byteLength !== 16 * perShard) throw new Error("truncated shard index");
						const view = new DataView(buffer);
						return Array.from({ length: perShard }, (_, i) => {
							const offset = view.getBigUint64(16 * i, true);
							const bytes = view.getBigUint64(16 * i + 8, true);
							if (offset === EMPTY && bytes === EMPTY) return null;
							if (offset + bytes > BigInt(start)) throw new Error("invalid shard index");
							return [Number(offset), Number(bytes)];
						});
					})
					.catch((e) => {
						indexes.delete(shard);
						throw e;
					}),
			);
		}
		return indexes.get(shard);
	}

	function keep(chunk, values) {
		// Two overlapping reads of one chunk must not count its bytes twice.
		if (cache.has(chunk) || values.byteLength > cacheBytes) return;
		while (retained + values.byteLength > cacheBytes) {
			const oldest = cache.keys().next().value;
			retained -= cache.get(oldest).byteLength;
			cache.delete(oldest);
		}
		cache.set(chunk, values);
		retained += values.byteLength;
	}

	// One shard's chunks, as single ranges with small gaps merged.
	async function ranges(shard, chunks) {
		const entries = await index(shard);
		const found = [];
		const empty = [];
		for (const chunk of chunks) {
			const entry = entries[chunk - shard * perShard];
			if (entry) found.push([chunk, ...entry]);
			else empty.push(chunk);
		}
		found.sort((a, b) => a[1] - b[1]);
		const out = [];
		for (const [chunk, offset, bytes] of found) {
			const last = out.at(-1);
			if (last && offset - last.end <= GAP && offset + bytes - last.start <= MAX_RANGE) {
				last.end = Math.max(last.end, offset + bytes);
				last.chunks.push([chunk, offset, bytes]);
			} else out.push({ shard, start: offset, end: offset + bytes, chunks: [[chunk, offset, bytes]] });
		}
		return { out, empty };
	}

	// Calls onChunk(chunk, values) once per requested chunk, in any order. An abort
	// stops the chunk downloads; shard indexes are shared between reads, so they finish.
	return async function chunks(list, onChunk, signal) {
		const byShard = new Map();
		for (const chunk of new Set(list)) {
			if (!Number.isInteger(chunk) || chunk < 0 || chunk * rows >= height) throw new Error("invalid matrix row");
			if (cache.has(chunk)) {
				const values = cache.get(chunk);
				cache.delete(chunk);
				cache.set(chunk, values);
				onChunk(chunk, values);
				continue;
			}
			const shard = Math.floor(chunk / perShard);
			if (!byShard.has(shard)) byShard.set(shard, []);
			byShard.get(shard).push(chunk);
		}
		const indexed = Promise.all([...byShard].map(([shard, list]) => ranges(shard, list)));
		// an abort does not wait for the shard indexes: they are small, and only the range
		// timeout ends one that stalls
		const planned = await (signal ? Promise.race([indexed, aborted(signal)]) : indexed);
		const zeros = new Float32Array(rows * width);
		for (const { empty } of planned) for (const chunk of empty) onChunk(chunk, zeros);
		const queue = planned.flatMap((p) => p.out);
		async function worker() {
			try {
				for (let range = queue.shift(); range; range = queue.shift()) {
					const bytes = new Uint8Array(await readRange(range.shard, range.start, range.end, signal));
					if (bytes.byteLength !== range.end - range.start) throw new Error("truncated matrix range");
					for (const [chunk, offset, size] of range.chunks) {
						// the kernel checks each chunk's gzip CRC-32 and size, and that every value is finite
						const values = decode(bytes.subarray(offset - range.start, offset - range.start + size), rows * width * 4);
						keep(chunk, values);
						onChunk(chunk, values);
					}
				}
			} catch (e) {
				// the read has failed: the other workers stop instead of fetching the rest
				queue.length = 0;
				throw e;
			}
		}
		await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
	};
}

// Rejects with the signal's reason once it aborts.
const aborted = (signal) =>
	new Promise((_, reject) => {
		if (signal.aborted) reject(signal.reason);
		else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});

function validArray(info, shape) {
	return (
		JSON.stringify(info?.shape) === JSON.stringify(shape) &&
		Number.isInteger(info.chunk_rows) &&
		info.chunk_rows > 0 &&
		info.shard_rows % info.chunk_rows === 0 &&
		shape[0] % info.shard_rows === 0 &&
		Array.isArray(info.shard_bytes) &&
		info.shard_bytes.length === shape[0] / info.shard_rows &&
		info.shard_bytes.every((v) => Number.isSafeInteger(v) && v >= (16 * info.shard_rows) / info.chunk_rows) &&
		Number.isFinite(info.chunk_bytes) &&
		info.chunk_bytes >= 0
	);
}

// Rows of one array as float64, rows.length × columns.length (all columns when
// none are given), in the order asked.
export function matrixReader(info, readRange, options) {
	const chunks = arrayReader(info, readRange, options);
	const [height, width] = info.shape;
	const step = info.chunk_rows;
	return async function read(rows, columns, signal) {
		if (columns && !columns.every((c) => Number.isInteger(c) && c >= 0 && c < width))
			throw new Error("invalid matrix column");
		const w = columns ? columns.length : width;
		const out = new Float64Array(rows.length * w);
		const wanted = new Map();
		rows.forEach((r, i) => {
			if (!Number.isInteger(r) || r < 0 || r >= height) throw new Error("invalid matrix row");
			const chunk = Math.floor(r / step);
			if (!wanted.has(chunk)) wanted.set(chunk, []);
			wanted.get(chunk).push([r, i]);
		});
		await chunks(
			[...wanted.keys()],
			(chunk, values) => {
				for (const [r, i] of wanted.get(chunk)) {
					const at = (r - chunk * step) * width;
					if (!columns) out.set(values.subarray(at, at + width), i * w);
					else for (let j = 0; j < w; j++) out[i * w + j] = values[at + columns[j]];
				}
			},
			signal,
		);
		return out;
	};
}

// readRange(name, shard, start, end) is injected for local parity tests.
// The manifest names the store by its hash only: the host it is read from is the
// page's own directory or DATA_ORIGIN (storeBase), never one the manifest names.
export function openEngine(meta, readRange) {
	const C = meta.countries;
	if (
		meta.version !== 3 ||
		meta.products !== 200 ||
		C !== 49 ||
		!/^[a-f0-9]{64}$/.test(meta.store) ||
		!Number.isFinite(meta.baseline_residual) ||
		meta.baseline_residual > 1e-9 ||
		meta.baseline_flows?.length !== meta.indicators.length * C * meta.sections.length * C ||
		// the flows' width is the stored width of H
		meta.baseline_flows.length !== SHAPES.H[1] * C
	)
		throw new Error("unsupported browser dataset");
	const readers = {};
	for (const [name, shape] of Object.entries(SHAPES)) {
		if (!validArray(meta.arrays?.[name], shape)) throw new Error(`invalid ${name} matrix manifest`);
		readers[name] = matrixReader(meta.arrays[name], (shard, start, end, signal) =>
			readRange(name, shard, start, end, signal),
		);
	}
	const baseline = Float64Array.from(meta.baseline_flows);
	if (!baseline.every(Number.isFinite)) throw new Error("invalid baseline flows");

	async function read(name, rows, columns, signal) {
		if (!readers[name]) throw new Error(`unknown matrix ${name}`);
		return readers[name](rows, columns, signal);
	}
	return { meta, baseline, read };
}

export function shardPath(meta, name, shard) {
	return `store-${meta.store}/${name}/c/${shard}/0`;
}

// The manifest ships with the page and names the store by its hash; the shards come from
// the data origin when one is set (data-origin.js), else from next to the manifest.
export const storeBase = (base, origin) => (origin ? new URL("browser-engine/", origin) : base);

export async function fetchEngine(base, origin = DATA_ORIGIN) {
	// Revalidated, so a deploy's new store is not paired with a cached manifest.
	const response = await fetch(new URL("manifest-v3.json", base), { cache: "no-cache" });
	if (!response.ok) throw new Error(`browser dataset: ${response.status}`);
	const meta = await response.json();
	const store = storeBase(base, origin);
	return openEngine(meta, (name, shard, start, end, signal) =>
		fetchRange(new URL(shardPath(meta, name, shard), store), start, end, meta.arrays[name].shard_bytes[shard], signal),
	);
}

// A range read that takes longer than this fails the run with that read named. The
// time counts from the fetch, so it includes waiting behind the run's other reads.
const RANGE_TIMEOUT_MS = 60_000;

export async function fetchRange(url, start, end, byteLength, signal, timeoutMs = RANGE_TIMEOUT_MS) {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > byteLength)
		throw new Error("invalid matrix byte range");
	// every failure names its read, so a failed run says which file and range broke
	const where = `${new URL(url).pathname} bytes ${start}-${end - 1}`;
	for (let retried = false; ; retried = true) {
		const began = performance.now();
		let phase = "before the response";
		try {
			const timeout = AbortSignal.timeout(timeoutMs);
			const response = await fetch(url, {
				headers: { Range: `bytes=${start}-${end - 1}` },
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});
			if (response.status === 404) {
				await response.body?.cancel();
				// The manifest names the store by its hash: next to the page, a 404 means a newer
				// deploy; on the data host, a store that was never uploaded, which hosting/check.js
				// catches before main promotes a version.
				throw new Error(`the browser data was updated: reload the page (${where})`);
			}
			if (response.status >= 500) {
				await response.body?.cancel();
				// The Worker answers a passing R2 or cache failure with 503; that is the host, not its setup.
				throw new Error(`the data host failed: try again (${where}, status ${response.status})`);
			}
			if (
				response.status !== 206 ||
				response.headers.get("Content-Range") !== `bytes ${start}-${end - 1}/${byteLength}`
			) {
				await response.body?.cancel();
				throw new Error(
					`browser scenario data needs a server with HTTP range support (${where}, status ${response.status})`,
				);
			}
			phase = "reading the body";
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength !== end - start)
				throw new Error(`truncated matrix range (${where}, ${buffer.byteLength} bytes)`);
			return buffer;
		} catch (e) {
			// A read the read-ahead stopped keeps its AbortError. Any other fetch failure, an
			// AbortError the signal did not cause and the range's own timeout included, also says
			// when it failed.
			if (signal?.aborted || !(e instanceof TypeError || ["AbortError", "TimeoutError"].includes(e.name))) throw e;
			// Firefox sometimes aborts a body read the page never stopped, so such a failure gets
			// one more try. A timeout does not: a second minute would pass the page's deadline.
			if (!retried && e.name !== "TimeoutError") continue;
			const ms = Math.round(performance.now() - began);
			throw new Error(
				`the browser data could not be read (${e.name}: ${e.message.trim()}; ${where}, ${phase}, after ${ms} ms${retried ? ", second try" : ""})`,
				{ cause: e },
			);
		}
	}
}
