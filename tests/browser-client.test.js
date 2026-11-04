import assert from "node:assert/strict";
import { test } from "node:test";

// A stand-in for the module worker: it records messages and termination, and the
// test answers for it through onmessage.
class FakeWorker {
	static last;
	constructor() {
		this.sent = [];
		this.terminated = false;
		FakeWorker.last = this;
	}
	postMessage(message) {
		this.sent.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	answer(data) {
		this.onmessage({ data });
	}
}
globalThis.Worker = FakeWorker;
globalThis.document = { baseURI: "https://example.org/" };
const { browserClient } = await import("../src/lib/browser-engine/browser-client.js");

test("an ordinary error leaves the worker running, a fatal one stops it", { timeout: 2000 }, async () => {
	const client = browserClient();
	const worker = FakeWorker.last;
	const first = client.request({ n: 1 });
	worker.answer({ id: worker.sent[0].id, error: "too broad" });
	await assert.rejects(first, /too broad/);
	assert.equal(worker.terminated, false);

	const second = client.request({ n: 2 });
	const waiting = client.request({ n: 3 });
	worker.answer({ id: worker.sent[1].id, fatal: true, error: "the calculation stopped" });
	await assert.rejects(second, /the calculation stopped/);
	await assert.rejects(waiting, /browser worker stopped/);
	assert.equal(worker.terminated, true);
	assert.equal(client.stopped, true);
	await assert.rejects(client.request({ n: 4 }), /browser worker stopped/);
});

test("a prefetch sends the selection without an id, and a stopped client sends none", () => {
	const client = browserClient();
	const worker = FakeWorker.last;
	client.prefetch({ model_details: [{ product: 1 }] });
	assert.deepEqual(worker.sent, [{ base: "https://example.org/data/browser-engine/", ahead: [{ product: 1 }] }]);
	client.close();
	client.prefetch({ model_details: [] });
	assert.equal(worker.sent.length, 1);
});

test("a worker script that does not load asks for a reload, one that throws does not", { timeout: 2000 }, async () => {
	// after a deploy the tab's hashed worker files are gone, so the script never runs
	const stale = browserClient();
	const missing = stale.request();
	FakeWorker.last.onerror(new Event("error"));
	await assert.rejects(missing, /could not load\. Reload the page/);
	assert.equal(stale.outdated, true);

	// a script that throws is a stopped worker, which a fresh one can replace
	const client = browserClient();
	const run = client.request();
	FakeWorker.last.onerror(new ErrorEvent("error", { message: "startup failure" }));
	await assert.rejects(run, /browser worker stopped/);
	assert.equal(client.outdated, false);
});

test("a failed thread pool is terminated and pending requests retry on one thread", { timeout: 2000 }, async () => {
	const client = browserClient();
	const pool = FakeWorker.last;
	const body = { n: 1 };
	const first = client.request(body);
	const second = client.request({ n: 2 });
	body.n = 99;
	pool.answer({ id: pool.sent[0].id, retrySingle: true });
	const fallback = FakeWorker.last;
	try {
		assert.equal(pool.terminated, true);
		assert.notEqual(fallback, pool);
		assert.deepEqual(
			fallback.sent.map((m) => m.single),
			[true, true],
		);
		assert.deepEqual(fallback.sent[0].body, { n: 1 });
		pool.answer({ id: pool.sent[0].id, value: -1 });
		pool.onerror();
		fallback.answer({ id: fallback.sent[0].id, value: 10 });
		fallback.answer({ id: fallback.sent[1].id, value: 20 });
		assert.equal(await first, 10);
		assert.equal(await second, 20);
	} finally {
		client.close();
		await Promise.allSettled([first, second]);
	}
});

test("a threaded calculation that hangs retries once on one thread", { timeout: 2000 }, async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const client = browserClient();
	const pool = FakeWorker.last;
	const hung = client.request({ n: 1 });
	t.mock.timers.tick(60_000);
	const queued = client.request({ n: 2 });
	// a trap in a pool thread leaves the calling thread waiting instead of throwing
	t.mock.timers.tick(60_000);
	const fallback = FakeWorker.last;
	assert.equal(pool.terminated, true);
	assert.notEqual(fallback, pool);
	assert.deepEqual(
		fallback.sent.map(({ body, single }) => [body, single]),
		[
			[{ n: 1 }, true],
			[{ n: 2 }, true],
		],
	);
	// the replayed request's deadline starts again on the new worker
	t.mock.timers.tick(60_000);
	fallback.answer({ id: fallback.sent[0].id, value: 10 });
	fallback.answer({ id: fallback.sent[1].id, value: 20 });
	assert.equal(await hung, 10);
	assert.equal(await queued, 20);

	const again = client.request({ n: 3 });
	t.mock.timers.tick(120_000);
	await assert.rejects(again, /timed out/);
	assert.equal(fallback.terminated, true);
});
