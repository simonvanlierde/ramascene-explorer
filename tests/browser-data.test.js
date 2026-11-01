import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrayReader, fetchEngine, fetchRange, matrixReader, openEngine } from "../browser-data.js";

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
