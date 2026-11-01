import assert from "node:assert/strict";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { fetchEngine, matrixReader, openEngine, rangeFile } from "../browser-data.js";

test("the compressed matrix reader preserves float64 rows, caches successes and retries failures", async () => {
	const inner = await asyncBufferFromFile(new URL("fixture-matrix.parquet", import.meta.url).pathname);
	let broken = false;
	let calls = 0;
	const file = {
		byteLength: inner.byteLength,
		slice: (a, b) => {
			calls++;
			if (broken) {
				broken = false;
				return Promise.reject(new Error("interrupted"));
			}
			return inner.slice(a, b);
		},
	};
	const row = await matrixReader(file, [2, 3]);
	assert.deepEqual([...(await row(0))], [1.25, -0.125, 0]);
	const before = calls;
	await row(0);
	assert.equal(calls, before);
	broken = true;
	await assert.rejects(row(1), /interrupted/);
	assert.deepEqual([...(await row(1))], [1e-12, 1e9, 0.1]);
	assert.throws(() => row(2), /invalid matrix row/);
	await assert.rejects(matrixReader(inner, [3, 2]), /row groups/);
});

test("range reads refuse a full download, a wrong offset and truncated data", async (t) => {
	const file = rangeFile("https://example.test/matrix.parquet", 10);
	t.mock.method(globalThis, "fetch", async () => new Response("0123456789"));
	await assert.rejects(file.slice(1, 3), /range support/);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("12", { status: 206, headers: { "Content-Range": "bytes 1-2/10" } }),
	);
	assert.equal(new TextDecoder().decode(await file.slice(1, 3)), "12");
	await assert.rejects(file.slice(2, 4), /range support/);
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response("1", { status: 206, headers: { "Content-Range": "bytes 1-2/10" } }),
	);
	await assert.rejects(file.slice(1, 3), /truncated/);
	await assert.rejects(file.slice(-1, 3), /invalid matrix byte range/);
});

test("invalid manifests are refused before reading a matrix", async () => {
	const noRead = () => {
		throw new Error("should not read");
	};
	await assert.rejects(
		openEngine({ version: 2, products: 200, countries: 49, baseline_residual: NaN }, noRead),
		/unsupported/,
	);
	await assert.rejects(
		openEngine({ version: 2, products: 200, countries: 49, baseline_residual: 0 }, noRead),
		/manifest/,
	);
});

test("the byte-bounded row cache evicts completed rows and shares in-flight reads", async () => {
	const inner = await asyncBufferFromFile(new URL("fixture-matrix.parquet", import.meta.url).pathname);
	let calls = 0;
	const file = {
		byteLength: inner.byteLength,
		slice: (a, b) => {
			calls++;
			return inner.slice(a, b);
		},
	};
	const row = await matrixReader(file, [2, 3], { cacheBytes: 24 });
	for (const cacheBytes of [-1, NaN, Infinity])
		await assert.rejects(matrixReader(file, [2, 3], { cacheBytes }), /cache budget/);
	const [a, b] = await Promise.all([row(0), row(0)]);
	assert.strictEqual(a, b);
	await row(1);
	const before = calls;
	await row(0);
	assert.ok(calls > before, "an evicted row must be read again");
	const after = calls;
	await row(0);
	assert.equal(calls, after, "the most recent row stays cached");
});

test("the monolithic v1 dataset is refused before any large matrix is opened", async () => {
	const shapes = { A: [9800, 9800], L: [9800, 9800], X: [9800, 49], Y: [9800, 49], B: [3, 9800], M: [60, 9800] };
	const meta = {
		version: 1,
		products: 200,
		countries: 49,
		baseline_residual: 0,
		files: Object.fromEntries(
			Object.entries(shapes).map(([name, shape]) => [name, { shape, bytes: 1, sha256: "0".repeat(64) }]),
		),
	};
	await assert.rejects(
		openEngine(meta, () => {
			throw new Error("opened a monolithic dataset");
		}),
		/unsupported browser dataset/,
	);
});

test("row files use one full GET, share pending loads, evict and retry", async (t) => {
	const { rowFile, rowReader } = await import("../browser-data.js");
	const { readFileSync } = await import("node:fs");
	const bytes = readFileSync(new URL("fixture-row.parquet", import.meta.url));
	let calls = 0;
	let fail = false;
	t.mock.method(globalThis, "fetch", async (_url, options) => {
		calls++;
		assert.equal(options, undefined, "a row GET must not issue ranges or footer reads");
		if (fail) {
			fail = false;
			return new Response(null, { status: 503 });
		}
		return new Response(bytes);
	});
	const row = rowReader((index) => rowFile(`https://example.test/A-hash/${index}.parquet`), [2, 3], { cacheBytes: 24 });
	const [a, b] = await Promise.all([row(0), row(0)]);
	assert.strictEqual(a, b);
	assert.deepEqual([...a], [1.25, -0.125, 0]);
	assert.equal(calls, 1);
	await row(0);
	assert.equal(calls, 1);
	fail = true;
	await assert.rejects(row(1), /503/);
	await row(1);
	assert.equal(calls, 3);
	await row(0);
	assert.equal(calls, 4, "an evicted row downloads again");
	assert.throws(() => row(-1), /invalid matrix row/);
	await assert.rejects(rowReader(() => rowFile("https://example.test/row"), [1, 4])(0), /dimensions/);
});

test("oversized row responses are cancelled with or without Content-Length", async (t) => {
	const { rowFile } = await import("../browser-data.js");
	let cancelled = 0;
	const body = () =>
		new ReadableStream({
			pull(controller) {
				controller.enqueue(new Uint8Array(128 * 1024 + 1));
			},
			cancel() {
				cancelled++;
			},
		});
	t.mock.method(
		globalThis,
		"fetch",
		async () => new Response(body(), { headers: { "Content-Length": String(128 * 1024 + 1) } }),
	);
	await assert.rejects(rowFile("https://example.test/row"), /byte limit/);
	t.mock.method(globalThis, "fetch", async () => new Response(body()));
	await assert.rejects(rowFile("https://example.test/row"), /byte limit/);
	assert.equal(cancelled, 2);
});

test("the v2 reader avoids an older cached manifest URL", async (t) => {
	let requested;
	t.mock.method(globalThis, "fetch", async (url) => {
		requested = new URL(url).pathname;
		return new Response("unavailable", { status: 503 });
	});
	await assert.rejects(fetchEngine(new URL("https://example.test/data/browser-engine/")), /browser dataset: 503/);
	assert.equal(requested, "/data/browser-engine/manifest-v2.json");
});
