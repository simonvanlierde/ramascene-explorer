import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../hosting/worker.js";

const bytes = new TextEncoder().encode("PAR1data");
const calls = [];
// Follows R2: a range object is clamped to the end, and one that starts at or past it throws.
const env = {
	EMBODIED: {
		async head() {
			calls.push("head");
			return { size: bytes.length, httpEtag: '"fixture"' };
		},
		async get(key, { range } = {}) {
			calls.push("get");
			assert.match(key, /^embodied\/[a-f0-9]{64}\.parquet$/);
			const size = bytes.length;
			let offset = range?.offset ?? 0;
			let length = range?.length ?? size - offset;
			if (range?.suffix !== undefined) {
				length = Math.min(range.suffix, size);
				offset = size - length;
			}
			if (offset >= size) throw new Error("get: The requested range is not satisfiable (10039)");
			return { size, httpEtag: '"fixture"', body: bytes.slice(offset, offset + length) };
		},
	},
};
const request = (headers = {}, method = "GET", path = "/data/embodied.parquet") =>
	worker.fetch(new Request(`https://example.test${path}`, { headers, method }), env);

test("the hosted Parquet serves exact ranges, suffixes and HEAD", async () => {
	for (const [range, expected, contentRange] of [
		["bytes=0-1", "PA", "bytes 0-1/8"],
		["bytes=4-", "data", "bytes 4-7/8"],
		["bytes=-4", "data", "bytes 4-7/8"],
		["bytes=6-99", "ta", "bytes 6-7/8"],
	]) {
		const res = await request({ Range: range });
		assert.equal(res.status, 206);
		assert.equal(res.headers.get("Content-Range"), contentRange);
		assert.equal(Number(res.headers.get("Content-Length")), expected.length);
		assert.equal(await res.text(), expected);
	}
	const head = await request({}, "HEAD");
	assert.equal(head.status, 200);
	assert.equal(head.headers.get("Content-Length"), "8");
	assert.equal(await head.text(), "");
	assert.equal(await (await request()).text(), "PAR1data");
});

test("invalid or multiple ranges never become full-file downloads", async () => {
	for (const range of ["bytes=8-9", "bytes=4-2", "bytes=-0", "bytes=0-1,4-5", "bad", "bytes=9007199254740992-"]) {
		const res = await request({ Range: range });
		assert.equal(res.status, 416, range);
		assert.equal(res.headers.get("Content-Range"), "bytes */8");
	}
});

test("the bucket is read-only and only the published file is reachable", async () => {
	assert.equal((await request({}, "POST")).status, 405);
	assert.equal((await request({}, "GET", "/private.parquet")).status, 404);
	const res = await worker.fetch(new Request("https://example.test/data/embodied.parquet"), {
		EMBODIED: { head: async () => null, get: async () => null },
	});
	assert.equal(res.status, 404);
});

test("under the production prefix only the prefixed data paths reach the data", async () => {
	const prod = { ...env, BASE_PATH: "/ramascene-explorer" };
	const at = (path) =>
		worker.fetch(new Request(`https://example.test${path}`, { headers: { Range: "bytes=0-3" } }), prod);
	const res = await at("/ramascene-explorer/data/embodied.parquet");
	assert.equal(res.status, 206);
	assert.equal(await res.text(), "PAR1");
	for (const path of [
		"/data/embodied.parquet",
		"/ramascene-explorer-x/data/embodied.parquet",
		"/ramascene-explorerdata/embodied.parquet",
	])
		assert.equal((await at(path)).status, 404, path);
});

test("a range against an older ETag gets the whole current file", async () => {
	const stale = await request({ Range: "bytes=0-1", "If-Range": '"older"' });
	assert.equal(stale.status, 200);
	assert.equal(await stale.text(), "PAR1data");
	const current = await request({ Range: "bytes=0-1", "If-Range": '"fixture"' });
	assert.equal(current.status, 206);
	assert.equal(await current.text(), "PA");
});

test("shard reads share one cache entry whatever the query string", async () => {
	const stored = new Map();
	const fetched = [];
	globalThis.caches = {
		default: {
			async match(req) {
				return stored.get(req.url)?.clone();
			},
			async put(req, res) {
				stored.set(req.url, res);
			},
		},
	};
	const shardEnv = {
		ASSETS: {
			async fetch(req) {
				fetched.push(req.url);
				return new Response("shard");
			},
		},
	};
	const path = `/data/browser-engine/store-${"a".repeat(64)}/A/c/0/0`;
	for (const query of ["", "?x=1", "?x=2"])
		assert.equal((await worker.fetch(new Request(`https://example.test${path}${query}`), shardEnv)).status, 200);
	assert.deepEqual(fetched, [`https://example.test${path}`]);
	const post = await worker.fetch(new Request(`https://example.test${path}`, { method: "POST" }), shardEnv);
	assert.equal(post.status, 405);
	delete globalThis.caches;
});

test("a Parquet range costs one R2 read", async () => {
	calls.length = 0;
	assert.equal((await request({ Range: "bytes=0-1" })).status, 206);
	assert.equal((await request()).status, 200);
	assert.deepEqual(calls, ["get", "get"]);
});

test("a failing R2 read asks the browser to retry", async () => {
	const down = async () => {
		throw new Error("R2 unavailable");
	};
	for (const EMBODIED of [
		{ head: down, get: down },
		{ ...env.EMBODIED, get: down },
	]) {
		const res = await worker.fetch(
			new Request("https://example.test/data/embodied.parquet", { headers: { Range: "bytes=0-1" } }),
			{ EMBODIED },
		);
		assert.equal(res.status, 503);
		assert.equal(res.headers.get("Retry-After"), "5");
	}
});
