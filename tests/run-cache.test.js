import assert from "node:assert/strict";
import { test } from "node:test";
import { runCache } from "../src/lib/run-cache.js";

// A read that counts its calls per run and resolves (or rejects) when told.
function reads() {
	const calls = [];
	const pending = [];
	const read = (run) => {
		calls.push(run);
		return new Promise((resolve, reject) => pending.push({ run, resolve, reject }));
	};
	return { calls, pending, read };
}

test("a run is read once while cached, and a hit moves it to the back of the line", async () => {
	const r = reads();
	const get = runCache(async (run) => r.calls.push(run) && run, 2);
	await get("a");
	await get("b");
	await get("a"); // a is now the most recent
	await get("c"); // so b is dropped
	await get("a");
	assert.deepEqual(r.calls, ["a", "b", "c"]);
	await get("b");
	assert.deepEqual(r.calls, ["a", "b", "c", "b"]);
});

test("the 21st run evicts the first at a size of 20", async () => {
	const calls = [];
	const get = runCache(async (run) => calls.push(run) && run, 20);
	for (let i = 0; i <= 20; i++) await get(i);
	await get(20);
	await get(1);
	assert.equal(calls.length, 21);
	await get(0);
	assert.deepEqual(calls.slice(21), [0]);
});

test("a failed read leaves the cache, but not a fresh read under the same key", async () => {
	const r = reads();
	const get = runCache(r.read, 1);
	const first = get("a");
	get("b"); // evicts the pending a
	const fresh = get("a"); // a fresh read of a, evicting b
	r.pending[0].reject(new Error("dropped")); // the evicted read of a fails late
	await assert.rejects(first, /dropped/);
	assert.equal(get("a"), fresh);
	r.pending[2].resolve("A");
	assert.equal(await fresh, "A");
	assert.deepEqual(r.calls, ["a", "b", "a"]);
	// a read that fails while cached is dropped, so asking again reads again
	const b = get("b");
	r.pending[3].reject(new Error("dropped"));
	await assert.rejects(b, /dropped/);
	get("b");
	assert.deepEqual(r.calls, ["a", "b", "a", "b", "b"]);
});
