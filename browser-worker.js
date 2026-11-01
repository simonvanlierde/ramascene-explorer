import { fetchEngine } from "./browser-data.js";
import { plan, readKey, scenarioFlows, startReads } from "./browser-engine.js";
import { browserResult } from "./browser-results.js";
import init from "./engine/pkg/ramascene_engine.js";

let loaded;
let engine;
const load = (base) =>
	(loaded ??= fetchEngine(new URL(base)).catch((e) => {
		loaded = null;
		throw e;
	}));

// Reads started for the selection the form shows, before Run: {key, reads}. One
// prefetch downloads at a time; while it does, only the newest selection waits.
let ahead = null;
let waiting = null;
let prefetching = false;
async function prefetch(base, steps) {
	waiting = steps;
	if (prefetching) return;
	prefetching = true;
	try {
		const data = await load(base);
		while (waiting) {
			const planned = plan(data.meta, waiting);
			waiting = null;
			const key = readKey(planned);
			if (ahead?.key === key) continue;
			ahead = { key, reads: startReads(data, planned) };
			await Promise.allSettled(Object.values(ahead.reads));
		}
	} catch {
		// a selection the form will refuse, or a failed load: Run reports either
	} finally {
		waiting = null;
		prefetching = false;
	}
}

self.onmessage = async ({ data: { id, base, body, ahead: steps } }) => {
	if (steps) return prefetch(base, steps);
	try {
		const loading = load(base);
		// the kernel loads alongside the data, and a failed load is tried again on the next message
		engine ??= init().catch((e) => {
			engine = null;
			throw e;
		});
		// this message's own load: a failure resets engine before a later await could see null
		const kernel = engine;
		kernel.catch(() => {});
		const data = await loading;
		// the form checks a selection's size with these before sending it
		if (!body)
			self.postMessage({
				id,
				value: {
					...data.meta.catalog,
					size: {
						products: data.meta.products,
						countries: data.meta.countries,
						arrays: Object.fromEntries(
							Object.entries(data.meta.arrays).map(([name, v]) => [name, { chunk_bytes: v.chunk_bytes }]),
						),
					},
				},
			});
		else {
			await kernel;
			const start = performance.now();
			const used = ahead;
			ahead = null;
			const flows = await scenarioFlows(data, body.model_details, used);
			const value = browserResult(data, body, flows, (performance.now() - start) / 1000);
			self.postMessage({ id, value }, [value.result.flows.baseline.buffer, flows.buffer]);
		}
	} catch (e) {
		// A trap (out of memory, or a panic) leaves the kernel's memory held and its state
		// unknown, so the page stops this worker.
		if (e instanceof WebAssembly.RuntimeError)
			self.postMessage({
				id,
				fatal: true,
				error: "the calculation stopped in this browser, likely out of memory; choose a narrower selection",
			});
		else self.postMessage({ id, error: e.message });
	}
};
