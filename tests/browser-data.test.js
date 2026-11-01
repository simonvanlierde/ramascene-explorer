import assert from "node:assert/strict";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { matrixReader, openEngine, rangeFile } from "../browser-data.js";

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
		openEngine({ version: 1, products: 200, countries: 49, baseline_residual: NaN }, noRead),
		/unsupported/,
	);
	await assert.rejects(
		openEngine({ version: 1, products: 200, countries: 49, baseline_residual: 0 }, noRead),
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
