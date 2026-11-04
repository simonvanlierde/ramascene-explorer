import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import "./engine-wasm.js";
import {
	arrayReader,
	fetchEngine,
	fetchRange,
	matrixReader,
	openEngine,
	storeBase,
} from "../src/lib/browser-engine/browser-data.js";

const infos = JSON.parse(readFileSync(new URL("fixture-store/info.json", import.meta.url), "utf8"));
const info = infos.M;
const shards = info.shard_bytes.map((_, i) => readFileSync(new URL(`fixture-store/M/c/${i}/0`, import.meta.url)));
const f32 = (row) => row.map(Math.fround);

// Reads the zarr-python fixture, recording each range asked for.
function fixture() {
	const calls = [];
	let fail = false;
	const readRange = async (shard, start, end) => {
		calls.push([shard, start, end]);
		if (fail) {
			fail = false;
			throw new Error("interrupted");
		}
		return shards[shard].buffer.slice(shards[shard].byteOffset + start, shards[shard].byteOffset + end);
	};
	return { calls, readRange, failNext: () => (fail = true) };
}

async function read(chunks, list) {
	const got = new Map();
	await chunks(list, (chunk, values) => got.set(chunk, [...values]));
	return got;
}

test("the shard reader decodes zarr-python's chunks, empty chunks as zeros", async () => {
	const { readRange } = fixture();
	const got = await read(arrayReader(info, readRange), [0, 1, 2, 3]);
	assert.deepEqual(got.get(0), f32([1.25, -0.125, 0]));
	assert.deepEqual(got.get(1), f32([1e-12, 1e9, 0.1]));
	assert.deepEqual(got.get(2), [0, 0, 0]);
	assert.deepEqual(got.get(3), f32([-0, 3, 2 ** -20]));
	assert.ok(Object.is(got.get(3)[0], -0));
});

test("neighbouring chunks share one range, cached chunks need none, and failures retry", async () => {
	const { calls, readRange, failNext } = fixture();
	const chunks = arrayReader(info, readRange);
	await read(chunks, [0, 1]);
	// the shard index, then one range for both rows
	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0], [0, info.shard_bytes[0] - 32, info.shard_bytes[0]]);
	await read(chunks, [1, 0]);
	assert.equal(calls.length, 2);
	failNext();
	await assert.rejects(read(chunks, [3]), /interrupted/);
	assert.deepEqual((await read(chunks, [3])).get(3), f32([-0, 3, 2 ** -20]));
	await assert.rejects(read(chunks, [4]), /invalid matrix row/);
	await assert.rejects(read(chunks, [0.5]), /invalid matrix row/);
});

test("an aborted read stops its chunk downloads but keeps the shared shard index", async () => {
	const signals = [];
	const calls = [];
	const readRange = async (shard, start, end, signal) => {
		calls.push([shard, start, end]);
		signals.push(signal);
		signal?.throwIfAborted();
		return shards[shard].buffer.slice(shards[shard].byteOffset + start, shards[shard].byteOffset + end);
	};
	const chunks = arrayReader(info, readRange);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		chunks([0, 1], () => {}, controller.signal),
		{ name: "AbortError" },
	);
	// the index went out without the signal, so another read can still use it
	assert.deepEqual(signals, [undefined, controller.signal]);
	assert.deepEqual((await read(chunks, [0])).get(0), f32([1.25, -0.125, 0]));
	assert.equal(calls.length, 3);
});

test("the chunk cache is bounded by bytes and evicts the oldest chunk", async () => {
	const { calls, readRange } = fixture();
	for (const cacheBytes of [-1, NaN, Infinity]) assert.throws(() => arrayReader(info, readRange, { cacheBytes }));
	const chunks = arrayReader(info, readRange, { cacheBytes: 12 });
	await read(chunks, [0]);
	await read(chunks, [1]);
	const before = calls.length;
	await read(chunks, [1]);
	assert.equal(calls.length, before, "the most recent chunk stays cached");
	await read(chunks, [0]);
	assert.equal(calls.length, before + 1, "an evicted chunk is read again");
});

test("a corrupt shard index or chunk is refused", async () => {
	const index = new Uint8Array(32);
	new DataView(index.buffer).setBigUint64(0, 1000n, true);
	const bad = arrayReader({ ...info, shard_bytes: [100, 62] }, async (shard, start, end) =>
		shard === 0 ? index.buffer.slice(0, end - start) : shards[1].buffer.slice(start, end),
	);
	await assert.rejects(read(bad, [0]), /invalid shard index/);
	const short = arrayReader(info, async () => new ArrayBuffer(4));
	await assert.rejects(read(short, [0]), /truncated shard index/);
	const wide = arrayReader({ ...info, shape: [4, 4] }, fixture().readRange);
	await assert.rejects(read(wide, [0]), /invalid matrix chunk/);
});

test("a chunk whose gzip size field overstates its data is refused", async () => {
	const { gzipSync } = await import("node:zlib");
	const chunk = gzipSync(Buffer.from(new Float32Array([1.5, 2.5]).buffer));
	// claim 12 bytes, a row of three values, for 8 bytes of data
	chunk.writeUInt32LE(12, chunk.length - 4);
	const index = new DataView(new ArrayBuffer(16));
	index.setBigUint64(8, BigInt(chunk.length), true);
	const shard = Buffer.concat([chunk, Buffer.from(index.buffer)]);
	const one = { shape: [1, 3], chunk_rows: 1, shard_rows: 1, shard_bytes: [shard.length], chunk_bytes: chunk.length };
	const chunks = arrayReader(one, async (_, start, end) =>
		shard.buffer.slice(shard.byteOffset + start, shard.byteOffset + end),
	);
	await assert.rejects(read(chunks, [0]), /invalid matrix chunk/);
});

test("decoded chunks own exactly their bytes, and a chunk claiming more than a row is refused", async () => {
	const { readRange } = fixture();
	const buffers = [];
	await arrayReader(info, readRange)([0, 1, 3], (_, values) => buffers.push(values.buffer.byteLength));
	assert.deepEqual(buffers, [12, 12, 12]);
	const { gzipSync } = await import("node:zlib");
	// a megabyte of zeros where a row of three values belongs
	const chunk = gzipSync(new Uint8Array(1024 ** 2));
	const index = new DataView(new ArrayBuffer(16));
	index.setBigUint64(8, BigInt(chunk.length), true);
	const shard = Buffer.concat([chunk, Buffer.from(index.buffer)]);
	const one = { shape: [1, 3], chunk_rows: 1, shard_rows: 1, shard_bytes: [shard.length], chunk_bytes: chunk.length };
	const bomb = arrayReader(one, async (_, start, end) =>
		shard.buffer.slice(shard.byteOffset + start, shard.byteOffset + end),
	);
	await assert.rejects(read(bomb, [0]), /invalid matrix chunk/);
});

test("range reads refuse a full download, a wrong offset and truncated data", async (t) => {
	const url = "https://example.test/A/c/0/0";
	t.mock.method(globalThis, "fetch", async () => new Response("0123456789"));
	await assert.rejects(fetchRange(url, 1, 3, 10), /range support/);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("12", { status: 206, headers: { "Content-Range": "bytes 1-2/10" } }),
	);
	assert.equal(new TextDecoder().decode(await fetchRange(url, 1, 3, 10)), "12");
	await assert.rejects(fetchRange(url, 2, 4, 10), /range support/);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("1", { status: 206, headers: { "Content-Range": "bytes 1-2/10" } }),
	);
	await assert.rejects(fetchRange(url, 1, 3, 10), /truncated/);
	await assert.rejects(fetchRange(url, -1, 3, 10), /invalid matrix byte range/);
	await assert.rejects(fetchRange(url, 1, 11, 10), /invalid matrix byte range/);
	// a store a newer deploy removed
	t.mock.method(globalThis, "fetch", async () => new Response("gone", { status: 404 }));
	await assert.rejects(fetchRange(url, 1, 3, 10), /updated: reload the page/);
});

test("a failed range read names its file and range, and a failed fetch its phase, unless its own signal stopped it", async (t) => {
	const url = "https://example.test/A/c/0/0";
	const abort = new DOMException("The operation was aborted. ", "AbortError");
	const always = t.mock.method(globalThis, "fetch", () => Promise.reject(abort));
	const error = await fetchRange(url, 1, 3, 10).catch((e) => e);
	assert.match(
		error.message,
		/^the browser data could not be read \(AbortError: The operation was aborted\.; \/A\/c\/0\/0 bytes 1-2, before the response, after \d+ ms, second try\)$/,
	);
	assert.equal(error.cause, abort);
	assert.equal(always.mock.callCount(), 2);
	// the response came, its body broke after the first byte
	t.mock.method(globalThis, "fetch", async () =>
		ranged(body(["1"], new TypeError("NetworkError when attempting to fetch resource."))),
	);
	await assert.rejects(
		fetchRange(url, 1, 3, 10),
		/\(TypeError: NetworkError .*bytes 1-2, reading the body, after \d+ ms, second try\)$/,
	);
	t.mock.method(globalThis, "fetch", async () => ranged("123"));
	await assert.rejects(fetchRange(url, 1, 3, 10), {
		message: "oversized matrix range (/A/c/0/0 bytes 1-2, over 2 bytes)",
	});
	// the read's own errors keep their message
	t.mock.method(globalThis, "fetch", async () => new Response("gone", { status: 404 }));
	await assert.rejects(fetchRange(url, 1, 3, 10), {
		message: "the browser data was updated: reload the page (/A/c/0/0 bytes 1-2)",
	});
	t.mock.method(globalThis, "fetch", async () => new Response("0123456789"));
	await assert.rejects(fetchRange(url, 1, 3, 10), {
		message: "browser scenario data needs a server with HTTP range support (/A/c/0/0 bytes 1-2, status 200)",
	});
	t.mock.method(globalThis, "fetch", async () => new Response("busy", { status: 503 }));
	await assert.rejects(fetchRange(url, 1, 3, 10), {
		message: "the data host failed: try again (/A/c/0/0 bytes 1-2, status 503)",
	});
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("1", { status: 206, headers: { "Content-Range": "bytes 1-2/10" } }),
	);
	await assert.rejects(fetchRange(url, 1, 3, 10), { message: "truncated matrix range (/A/c/0/0 bytes 1-2, 1 bytes)" });
	const controller = new AbortController();
	controller.abort();
	t.mock.method(globalThis, "fetch", () => Promise.reject(abort));
	const stopped = t.mock.method(globalThis, "fetch", () => Promise.reject(abort));
	await assert.rejects(fetchRange(url, 1, 3, 10, controller.signal), (e) => e === abort);
	assert.equal(stopped.mock.callCount(), 1);
});

// A 206 for bytes 1-2 of a 10-byte file.
const ranged = (content) => new Response(content, { status: 206, headers: { "Content-Range": "bytes 1-2/10" } });
// A body that sends `chunks` `delay` ms apart, then fails with `error` or ends. Like a
// browser's, it fails with the reason when `signal` aborts.
function body(chunks, error, delay = 0, signal = undefined) {
	const left = chunks.map((c) => new TextEncoder().encode(c));
	return new ReadableStream({
		start(controller) {
			signal?.addEventListener("abort", () => controller.error(signal.reason));
		},
		async pull(controller) {
			if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
			if (signal?.aborted) return;
			if (left.length) controller.enqueue(left.shift());
			else if (error) controller.error(error);
			else controller.close();
		},
	});
}

test("a body read the page did not stop gets one more try", async (t) => {
	const url = "https://example.test/A/c/0/0";
	const aborted = () => new DOMException("The operation was aborted.", "AbortError");
	// as in Firefox: the first body read aborts by itself, the second arrives
	const fetches = t.mock.method(globalThis, "fetch", async () =>
		ranged(fetches.mock.callCount() === 0 ? body(["1"], aborted()) : "12"),
	);
	assert.equal(new TextDecoder().decode(await fetchRange(url, 1, 3, 10)), "12");
	assert.equal(fetches.mock.callCount(), 2);
	// only one more: a second abort fails the read
	const both = t.mock.method(globalThis, "fetch", async () => ranged(body([], aborted())));
	await assert.rejects(
		fetchRange(url, 1, 3, 10),
		/\(AbortError: The operation was aborted\.; \/A\/c\/0\/0 bytes 1-2, reading the body, after \d+ ms, second try\)$/,
	);
	assert.equal(both.mock.callCount(), 2);
});

test("a slow body that keeps sending passes the stall timer, one that stops does not", async (t) => {
	const url = "https://example.test/A/c/0/0";
	// six chunks 15 ms apart take about 90 ms, longer than the 40 ms timer
	const bytes = ["1", "2", "3", "4", "5", "6"];
	t.mock.method(globalThis, "fetch", async (_url, { signal }) => ({
		status: 206,
		headers: new Headers({ "Content-Range": "bytes 1-6/10" }),
		body: body(bytes, null, 15, signal),
	}));
	assert.equal(new TextDecoder().decode(await fetchRange(url, 1, 7, 10, undefined, 40)), "123456");
	// the body sends one byte, then nothing: only an abort ends the read, as in a browser
	t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
		let sent = false;
		return ranged(
			new ReadableStream({
				pull(controller) {
					if (!sent) {
						sent = true;
						controller.enqueue(new Uint8Array([49]));
						return;
					}
					return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
				},
			}),
		);
	});
	await assert.rejects(
		fetchRange(url, 1, 3, 10, undefined, 20),
		/\(TimeoutError: no data for 20 ms; \/A\/c\/0\/0 bytes 1-2, reading the body, after \d+ ms\)$/,
	);
});

test("a stall timer that fires late, because a calculation held the thread, waits again", async (t) => {
	let release;
	t.mock.method(globalThis, "fetch", async (_url, { signal }) =>
		ranged(
			new ReadableStream({
				start(controller) {
					signal.addEventListener("abort", () => controller.error(signal.reason));
				},
				async pull(controller) {
					await new Promise((resolve) => {
						release = resolve;
					});
					controller.enqueue(new TextEncoder().encode("12"));
					controller.close();
				},
			}),
		),
	);
	const read = fetchRange("https://example.test/A/c/0/0", 1, 3, 10, undefined, 20);
	await new Promise((resolve) => setTimeout(resolve, 0));
	// hold the thread past the 20 ms timer by over a second, as a long kernel call does
	const until = performance.now() + 1100;
	while (performance.now() < until);
	setTimeout(() => release(), 0);
	assert.equal(new TextDecoder().decode(await read), "12");
});

test("a range that stalls times out with its read named, and its own stop still wins", async (t) => {
	const url = "https://example.test/A/c/0/0";
	// a server that never answers: only an abort ends the request, as in a browser
	const stalls = t.mock.method(globalThis, "fetch", (_url, { signal }) => {
		return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
	});
	await assert.rejects(
		fetchRange(url, 1, 3, 10, undefined, 20),
		/^Error: the browser data could not be read \(TimeoutError: .*; \/A\/c\/0\/0 bytes 1-2, before the response, after \d+ ms\)$/,
	);
	// a stall is not tried again: a second one would pass the page's deadline
	assert.equal(stalls.mock.callCount(), 1);
	await assert.rejects(fetchRange(url, 1, 3, 10, new AbortController().signal, 20), /TimeoutError: .*bytes 1-2/);
	const controller = new AbortController();
	const stopped = fetchRange(url, 1, 3, 10, controller.signal, 60_000);
	controller.abort();
	await assert.rejects(stopped, (e) => e === controller.signal.reason);
});

test("rows from chunks of several rows come back in the order asked, with columns", async () => {
	const p = infos.P;
	const files = p.shard_bytes.map((_, i) => readFileSync(new URL(`fixture-store/P/c/${i}/0`, import.meta.url)));
	const read = matrixReader(p, async (shard, start, end) =>
		files[shard].buffer.slice(files[shard].byteOffset + start, files[shard].byteOffset + end),
	);
	const row = (r) => [3 * r, 3 * r + 1, 3 * r + 2].map((v) => v / 4);
	assert.deepEqual([...(await read([5, 0, 5, 3]))], [...row(5), ...row(0), ...row(5), ...row(3)]);
	assert.deepEqual([...(await read([7, 2], [2, 0]))], [row(7)[2], row(7)[0], row(2)[2], row(2)[0]]);
	await assert.rejects(read([0], [3]), /invalid matrix column/);
	await assert.rejects(read([8]), /invalid matrix row/);
});

test("a failed range stops the other requests", async () => {
	const { gzipSync } = await import("node:zlib");
	// 200 one-row chunks, each 70 KB apart so none merge
	const chunk = gzipSync(new Uint8Array(12));
	const index = new DataView(new ArrayBuffer(200 * 16));
	const body = new Uint8Array(200 * 70_000);
	for (let i = 0; i < 200; i++) {
		body.set(chunk, i * 70_000);
		index.setBigUint64(i * 16, BigInt(i * 70_000), true);
		index.setBigUint64(i * 16 + 8, BigInt(chunk.length), true);
	}
	const shard = Buffer.concat([body, Buffer.from(index.buffer)]);
	const one = {
		shape: [200, 3],
		chunk_rows: 1,
		shard_rows: 200,
		shard_bytes: [shard.length],
		chunk_bytes: chunk.length,
	};
	let reads = 0;
	const chunks = arrayReader(one, async (_, start, end) => {
		if (start < body.length && reads++ === 0) throw new Error("interrupted");
		await new Promise((resolve) => setTimeout(resolve, 1));
		return shard.buffer.slice(shard.byteOffset + start, shard.byteOffset + end);
	});
	const all = Array.from({ length: 200 }, (_, i) => i);
	await assert.rejects(read(chunks, all), /interrupted/);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.ok(reads <= 64, `${reads} ranges read after the failure`);
});

// A one-shard array of one-row chunks, three values wide. `chunks` maps a chunk number
// to [offset, gzip bytes]; the others are empty. Every readRange call is recorded.
const EMPTY = 0xffffffffffffffffn;
function synthetic(chunks, { slots = 8, length, index = {}, read } = {}) {
	const end = length ?? Math.max(...chunks.map(([, [offset, bytes]]) => offset + bytes.length));
	const body = new Uint8Array(end);
	const table = new DataView(new ArrayBuffer(16 * slots));
	for (let i = 0; i < slots; i++) {
		table.setBigUint64(16 * i, EMPTY, true);
		table.setBigUint64(16 * i + 8, EMPTY, true);
	}
	for (const [slot, [offset, bytes]] of chunks) {
		body.set(bytes, offset);
		table.setBigUint64(16 * slot, BigInt(offset), true);
		table.setBigUint64(16 * slot + 8, BigInt(bytes.length), true);
	}
	for (const [slot, [offset, bytes]] of Object.entries(index)) {
		table.setBigUint64(16 * slot, offset, true);
		table.setBigUint64(16 * slot + 8, bytes, true);
	}
	const shard = Buffer.concat([body, Buffer.from(table.buffer)]);
	const info = { shape: [slots, 3], chunk_rows: 1, shard_rows: slots, shard_bytes: [shard.length], chunk_bytes: 20 };
	const calls = [];
	const readRange = async (_, start, stop) => {
		calls.push([start, stop]);
		const bytes = await (read ? read(start, stop, end) : null);
		const out = shard.buffer.slice(shard.byteOffset + start, shard.byteOffset + stop);
		return bytes === "short" ? out.slice(0, -1) : out;
	};
	return { info, readRange, calls, end };
}

const ZEROS = gzipSync(new Uint8Array(12));
const GAP = 64 * 1024;

test("chunks within 64 KiB of each other share a range, farther ones and those past 1 MiB do not", async () => {
	const L = ZEROS.length;
	// gaps of exactly 64 KiB, one byte more, and 100 KB
	const at = [0, L + GAP, 2 * L + 2 * GAP + 1, 3 * L + 3 * GAP + 1 + 100_000 - GAP];
	const gap = synthetic(at.map((offset, i) => [i, [offset, ZEROS]]));
	await read(arrayReader(gap.info, gap.readRange), [0, 1, 2, 3]);
	assert.deepEqual(gap.calls.slice(1), [
		[0, at[1] + L],
		[at[2], at[2] + L],
		[at[3], at[3] + L],
	]);
	// 50 KB steps, the 22nd chunk ending exactly at 1 MiB, then one more
	const step = Array.from({ length: 21 }, (_, i) => i * 50_000);
	const edge = [...step, 1024 ** 2 - L, 1024 ** 2 - L + 50_000];
	const big = synthetic(
		edge.map((offset, i) => [i, [offset, ZEROS]]),
		{ slots: 32 },
	);
	await read(
		arrayReader(big.info, big.readRange),
		edge.map((_, i) => i),
	);
	assert.deepEqual(big.calls.slice(1), [
		[0, 1024 ** 2],
		[edge[22], edge[22] + L],
	]);
});

test("chunks listed out of order in the index are fetched in offset order as one range", async () => {
	const L = ZEROS.length;
	const shard = synthetic([
		[0, [1000, ZEROS]],
		[1, [0, ZEROS]],
	]);
	const got = await read(arrayReader(shard.info, shard.readRange), [0, 1]);
	assert.deepEqual([...got.keys()].sort(), [0, 1]);
	assert.deepEqual(shard.calls.slice(1), [[0, 1000 + L]]);
});

test("a range grows to the furthest end when a chunk lies inside the one before", async () => {
	// B is a whole gzip member inside A's header field, so it ends before A does
	const inner = ZEROS;
	const xlen = 10 + inner.length;
	const head = Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 3, xlen, 0]);
	const extra = Buffer.alloc(10);
	// the decoder reads the field length at this offset
	extra.writeUInt16LE(xlen, 8);
	const outer = Buffer.concat([head, extra, inner, ZEROS.subarray(10)]);
	const shard = synthetic([
		[0, [0, outer]],
		[1, [head.length + extra.length, inner]],
	]);
	const got = await read(arrayReader(shard.info, shard.readRange), [0, 1]);
	assert.deepEqual([...got.keys()].sort(), [0, 1]);
	assert.deepEqual(shard.calls.slice(1), [[0, outer.length]]);
});

test("up to 64 ranges are in flight at once", async () => {
	const at = Array.from({ length: 200 }, (_, i) => i * 70_000);
	const shard = synthetic(
		at.map((offset, i) => [i, [offset, ZEROS]]),
		{
			slots: 200,
			read: async (start, _, end) => {
				if (start >= end) return;
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active--;
			},
		},
	);
	let active = 0;
	let peak = 0;
	await read(
		arrayReader(shard.info, shard.readRange),
		at.map((_, i) => i),
	);
	assert.equal(peak, 64);
});

test("the cache evicts the least recently used chunk, not the oldest one read", async () => {
	const { calls, readRange } = fixture();
	// two chunks of 12 bytes fit
	const chunks = arrayReader(info, readRange, { cacheBytes: 24 });
	await read(chunks, [0]);
	await read(chunks, [1]);
	await read(chunks, [0]);
	await read(chunks, [3]);
	const before = calls.length;
	await read(chunks, [0]);
	assert.equal(calls.length, before, "the chunk read again last stays");
	await read(chunks, [1]);
	assert.ok(calls.length > before, "the chunk not read since is evicted");
});

test("two reads of one chunk at once count its bytes once", async () => {
	const { calls, readRange } = fixture();
	const chunks = arrayReader(info, readRange, { cacheBytes: 24 });
	await Promise.all([read(chunks, [0]), read(chunks, [0])]);
	await read(chunks, [1]);
	const before = calls.length;
	await read(chunks, [0, 1]);
	assert.equal(calls.length, before, "both chunks fit the budget");
});

test("a chunk larger than the cache is returned but not kept", async () => {
	const { calls, readRange } = fixture();
	const chunks = arrayReader(info, readRange, { cacheBytes: 8 });
	assert.deepEqual((await read(chunks, [0])).get(0), f32([1.25, -0.125, 0]));
	const before = calls.length;
	await read(chunks, [0]);
	assert.ok(calls.length > before);
});

test("chunks with NaN or infinite values are refused", async () => {
	for (const bad of [NaN, Infinity, -Infinity]) {
		const chunk = gzipSync(Buffer.from(new Float32Array([1, bad, 2]).buffer));
		const shard = synthetic([[0, [0, chunk]]]);
		await assert.rejects(read(arrayReader(shard.info, shard.readRange), [0]), /invalid matrix values/);
	}
});

test("a range with fewer bytes than asked for is refused", async () => {
	const shard = synthetic([[0, [0, ZEROS]]], { read: (start, _stop, end) => (start < end ? "short" : null) });
	await assert.rejects(read(arrayReader(shard.info, shard.readRange), [0]), /truncated matrix range/);
});

test("a shard index entry with only one half empty is refused", async () => {
	for (const entry of [
		[EMPTY, 5n],
		[0n, EMPTY],
	]) {
		const shard = synthetic([[0, [0, ZEROS]]], { index: { 1: entry } });
		await assert.rejects(read(arrayReader(shard.info, shard.readRange), [1]), /invalid shard index/);
	}
});

test("older and invalid manifests are refused before reading a matrix", () => {
	const noRead = () => {
		throw new Error("should not read");
	};
	const array = (shape, shard = 200) => ({
		shape,
		chunk_rows: shard === 200 ? 1 : 200,
		shard_rows: shard,
		shard_bytes: Array(shape[0] / shard).fill(4000),
		chunk_bytes: 10,
	});
	const meta = {
		version: 3,
		products: 200,
		countries: 49,
		store: "0".repeat(64),
		baseline_residual: 0,
		indicators: [5, 3, 7],
		sections: Array(15).fill({}),
		baseline_flows: Array(2205 * 49).fill(0),
		arrays: {
			A: array([9800, 9800]),
			L: array([9800, 9800]),
			LC: array([9800, 9800]),
			H: array([9800, 2205]),
			X: array([9800, 49], 9800),
			Y: array([9800, 49], 9800),
		},
	};
	assert.equal(openEngine(meta, noRead).baseline.length, 2205 * 49);
	// four indicators with matching flows would read H at the wrong width
	const four = { indicators: [5, 3, 7, 1], baseline_flows: Array(4 * 15 * 49 * 49).fill(0) };
	for (const over of [{ version: 2 }, { baseline_residual: NaN }, { store: "../x" }, { baseline_flows: [0] }, four])
		assert.throws(() => openEngine({ ...meta, ...over }, noRead), /unsupported/);
	assert.throws(() => openEngine({ ...meta, arrays: { ...meta.arrays, L: array([9800, 49]) } }, noRead), /L matrix/);
	const short = { ...array([9800, 9800]), shard_bytes: [4000] };
	assert.throws(() => openEngine({ ...meta, arrays: { ...meta.arrays, A: short } }, noRead), /A matrix/);
	// a shard cannot be smaller than its index: 200 pairs of 16 bytes
	const small = { ...array([9800, 9800]), shard_bytes: Array(49).fill(4000).fill(3199, 7, 8) };
	assert.throws(() => openEngine({ ...meta, arrays: { ...meta.arrays, A: small } }, noRead), /A matrix/);
	const exact = { ...array([9800, 9800]), shard_bytes: Array(49).fill(3200) };
	assert.doesNotThrow(() => openEngine({ ...meta, arrays: { ...meta.arrays, A: exact } }, noRead));
});

test("the v3 reader avoids an older cached manifest URL", async (t) => {
	let requested;
	let cache;
	t.mock.method(globalThis, "fetch", async (url, init) => {
		requested = new URL(url).pathname;
		cache = init?.cache;
		return new Response("unavailable", { status: 503 });
	});
	await assert.rejects(fetchEngine(new URL("https://example.test/data/browser-engine/")), /browser dataset: 503/);
	assert.equal(requested, "/data/browser-engine/manifest-v3.json");
	assert.equal(cache, "no-cache");
});

test("the shards come from the data origin when one is set, the manifest never does", () => {
	const base = new URL("https://example.test/ramascene-explorer/data/browser-engine/");
	assert.equal(storeBase(base, null), base);
	assert.equal(storeBase(base, "https://data.example.org/").href, "https://data.example.org/browser-engine/");
});
