import assert from "node:assert/strict";
import { fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import * as single from "../engine/pkg/ramascene_engine.js";
import "./engine-wasm.js";

// The real worker, engine and store reader over the exported store, with fetch replaced.
// A read-ahead read waits in held until the test releases it, and an abort only marks
// it: the test decides when the stopped read settles. Every read has a timeout signal;
// only a read-ahead's joins it to its own, with AbortSignal.any.
const directory = process.env.BROWSER_ENGINE_DATA;
const posted = [];
globalThis.self = { postMessage: (message) => posted.push(message) };
mock.module(new URL("../src/lib/browser-engine/browser-kernel.js", import.meta.url).href, {
	exports: { loadKernel: async () => single, useThreads: () => false },
});
const base = "https://example.test/data/browser-engine/";
const files = new Map();
const held = [];
const joined = new WeakSet();
const any = AbortSignal.any;
AbortSignal.any = (signals) => {
	const signal = any.call(AbortSignal, signals);
	joined.add(signal);
	return signal;
};
let fetches = 0;
globalThis.fetch = async (url, { headers, signal } = {}) => {
	const path = `${directory}/${String(url).slice(base.length)}`;
	if (!headers?.Range) return new Response(readFileSync(path));
	fetches++;
	const [start, end] = /bytes=(\d+)-(\d+)/.exec(headers.Range).slice(1).map(Number);
	if (joined.has(signal)) await new Promise((resolve, reject) => held.push({ signal, resolve, reject }));
	if (!files.has(path)) files.set(path, openSync(path, "r"));
	const fd = files.get(path);
	const bytes = new Uint8Array(end - start + 1);
	readSync(fd, bytes, 0, bytes.length, start);
	return new Response(bytes, {
		status: 206,
		headers: { "Content-Range": `bytes ${start}-${end}/${fstatSync(fd).size}` },
	});
};
const release = () => {
	for (const read of held.splice(0)) read.signal.aborted ? read.reject(read.signal.reason) : read.resolve();
};
// enough event-loop turns for the worker to reach its next wait on a held read
const settle = async () => {
	for (let i = 0; i < 50; i++) await setImmediate();
};
if (directory) await import("../src/lib/browser-engine/browser-worker.js");

const step = (product, originReg, consumedBy, consumedReg) => [
	{
		product: [product],
		originReg: [originReg],
		consumedBy: [consumedBy],
		consumedReg: [consumedReg],
		techChange: [-20],
	},
];

test("Run stops another selection's read-ahead and waits for it before reading its own", {
	skip: !directory && "Set BROWSER_ENGINE_DATA to the exported browser dataset.",
}, async (t) => {
	t.after(release);
	await self.onmessage({ data: { id: 0, base } });
	assert.ok(posted.at(-1).value, posted.at(-1).error);

	self.onmessage({ data: { base, ahead: step(5, 1, 198, 2) } });
	await settle();
	const ahead = held.length;
	assert.ok(ahead > 0, "the read-ahead holds no reads");

	const before = fetches;
	const running = self.onmessage({ data: { id: 1, base, body: { model_details: step(180, 1, 198, 2) } } });
	await settle();
	assert.equal(held.filter((r) => r.signal.aborted).length, ahead, "Run left the read-ahead running");
	assert.equal(fetches, before, "Run read before the stopped read-ahead settled");

	release();
	await running;
	const run = posted.find((m) => m.id === 1);
	assert.ok(run?.value, run?.error);
	assert.ok(fetches > before, "Run read nothing of its own");
});
