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
const { browserClient } = await import("../browser-client.js");

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
	await assert.rejects(client.request({ n: 4 }), /reload to try again/);
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
