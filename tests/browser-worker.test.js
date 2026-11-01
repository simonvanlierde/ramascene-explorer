import assert from "node:assert/strict";
import { mock, test } from "node:test";

// The worker runs for real; its data, engine and kernel are stand-ins, so a calculation
// can trap after the pool has started.
const posted = [];
globalThis.self = { postMessage: (message) => posted.push(message) };
const at = (path) => new URL(path, import.meta.url).href;
let scenarioFlows;
let startReads = () => ({});
mock.module(at("../browser-data.js"), { namedExports: { fetchEngine: async () => ({ meta: {} }) } });
mock.module(at("../browser-engine.js"), {
	namedExports: {
		plan: (_meta, steps) => ({ steps }),
		readKey: ({ steps }) => JSON.stringify(steps),
		startReads: (...args) => startReads(...args),
		scenarioFlows: (...args) => scenarioFlows(...args),
	},
});
mock.module(at("../browser-kernel.js"), {
	namedExports: {
		loadKernel: async (single = false) => ({ single, thread_count: () => (single ? 1 : 4) }),
		useThreads: () => true,
	},
});
mock.module(at("../browser-results.js"), { namedExports: { browserResult: () => ({}) } });
mock.module(at("../engine/pkg/ramascene_engine.js"), { defaultExport: async () => {} });
await import("../browser-worker.js");

const base = "https://example.test/";
const run = async (single, steps = []) => {
	posted.length = 0;
	await self.onmessage({ data: { id: 7, base, body: { model_details: steps }, single } });
	return posted;
};

test("a trap in a threaded calculation asks the page to retry on one thread", async () => {
	const kernels = [];
	scenarioFlows = async (_data, _steps, _ahead, maths) => {
		kernels.push(maths.single);
		throw new WebAssembly.RuntimeError("unreachable");
	};
	assert.deepEqual(await run(undefined), [{ id: 7, retrySingle: true }]);
	assert.deepEqual(kernels, [false]);
});

test("a trap on one thread stops the worker", async () => {
	scenarioFlows = async () => {
		throw new WebAssembly.RuntimeError("unreachable");
	};
	const [message] = await run(true);
	assert.equal(message.fatal, true);
	assert.match(message.error, /likely out of memory/);
});

test("Run on another selection stops the prefetch and waits for it before reading", async () => {
	let signal;
	let settled = false;
	startReads = (_data, _planned, s) => {
		signal = s;
		// a download that ends only when stopped, as fetch rejects on abort
		const pending = new Promise((_, reject) => s.addEventListener("abort", () => reject(s.reason)));
		pending.catch(() => (settled = true));
		return { technical: pending };
	};
	const handed = [];
	scenarioFlows = async (_data, _steps, ahead) => {
		handed.push([ahead, settled]);
		return new Float64Array();
	};
	self.onmessage({ data: { base, ahead: [{ product: 1 }] } });
	await new Promise((resolve) => setTimeout(resolve));
	await run(true, [{ product: 2 }]);
	assert.equal(signal.aborted, true);
	assert.deepEqual(handed, [[null, true]]);
	// the same selection is handed over, not stopped
	self.onmessage({ data: { base, ahead: [{ product: 3 }] } });
	await new Promise((resolve) => setTimeout(resolve));
	await run(true, [{ product: 3 }]);
	assert.equal(signal.aborted, false);
	assert.equal(handed[1][0].key, JSON.stringify([{ product: 3 }]));
});
