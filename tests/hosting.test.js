import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../hosting/worker.js";

const bytes = new TextEncoder().encode("PAR1data");
const env = {
	EMBODIED: {
		async head() {
			return { size: bytes.length, httpEtag: '"fixture"' };
		},
		async get(key, { range }) {
			assert.match(key, /^embodied\/[a-f0-9]{64}\.parquet$/);
			return { body: bytes.slice(range.offset, range.offset + range.length) };
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
		EMBODIED: { head: async () => null },
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
