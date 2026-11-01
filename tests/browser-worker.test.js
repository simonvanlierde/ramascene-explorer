import assert from "node:assert/strict";
import { mock, test } from "node:test";

// The worker runs for real; its data, engine and kernel are stand-ins, so a calculation
// can trap after the pool has started.
const posted = [];
globalThis.self = { postMessage: (message) => posted.push(message) };
const at = (path) => new URL(path, import.meta.url).href;
let scenarioFlows;
mock.module(at("../browser-data.js"), { namedExports: { fetchEngine: async () => ({ meta: {} }) } });
mock.module(at("../browser-engine.js"), {
	namedExports: { plan: () => ({}), scenarioFlows: (...args) => scenarioFlows(...args) },
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

const run = async (single) => {
	posted.length = 0;
	await self.onmessage({ data: { id: 7, base: "https://example.test/", body: { model_details: [] }, single } });
	return posted;
};

test("a trap in a threaded calculation asks the page to retry on one thread", async () => {
	const kernels = [];
	scenarioFlows = async (_data, _steps, maths) => {
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
