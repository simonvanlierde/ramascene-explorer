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
