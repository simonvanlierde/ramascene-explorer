import assert from "node:assert/strict";
import { fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { mock, test } from "node:test";
import * as single from "../engine/pkg/ramascene_engine.js";
import "./engine-wasm.js";

// The real worker, engine and store reader over the exported store, with fetch
// replaced by slow range reads that stop on abort, as a browser's do.
const directory = process.env.BROWSER_ENGINE_DATA;
const posted = [];
globalThis.self = { postMessage: (message) => posted.push(message) };
mock.module(new URL("../src/lib/browser-engine/browser-kernel.js", import.meta.url).href, {
	exports: { loadKernel: async () => single, useThreads: () => false },
});
const base = "https://example.test/data/browser-engine/";
const files = new Map();
let delay = () => 0;
globalThis.fetch = async (url, { headers, signal } = {}) => {
	const path = `${directory}/${String(url).slice(base.length)}`;
	if (!headers?.Range) return new Response(readFileSync(path));
	const [start, end] = /bytes=(\d+)-(\d+)/.exec(headers.Range).slice(1).map(Number);
	await new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, delay());
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});
	if (!files.has(path)) files.set(path, openSync(path, "r"));
	const fd = files.get(path);
	const bytes = new Uint8Array(end - start + 1);
	readSync(fd, bytes, 0, bytes.length, start);
	return new Response(bytes, {
		status: 206,
		headers: { "Content-Range": `bytes ${start}-${end}/${fstatSync(fd).size}` },
	});
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let id = 0;
const run = async (steps) => {
	const mine = id++;
	await self.onmessage({ data: { id: mine, base, body: { model_details: steps } } });
	return posted.find((m) => m.id === mine);
};

test("Run gets no aborted read when the selection changes while the prefetch downloads", {
	skip: !directory && "Set BROWSER_ENGINE_DATA to the exported browser dataset.",
}, async () => {
	// the deploy check's order: a first Run, four selection changes, Run on the last
	const steps = [step(180, 1, 198, 2), step(5, 1, 198, 2), step(5, 1, 5, 2), step(5, 1, 5, 1)];
	const failures = [];
	for (let trial = 0; trial < 10; trial++) {
		// seeded, so each trial asks for the same delays and gaps
		let seed = trial + 1;
		const random = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		delay = () => random() * 40;
		const first = await run(steps[0]);
		assert.ok(first.value, first.error);
		// prefetches for some of the selections, at uneven gaps, then Run
		for (const s of steps) {
			if (random() < 0.6) self.onmessage({ data: { base, ahead: s } });
			await pause(random() * 60);
		}
		const last = await run(steps.at(-1));
		if (!last.value) failures.push([trial, last.error]);
	}
	assert.deepEqual(failures, []);
});
