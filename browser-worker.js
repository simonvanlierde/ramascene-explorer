import { fetchEngine } from "./browser-data.js";
import { plan, scenarioFlows } from "./browser-engine.js";
import { loadKernel, useThreads } from "./browser-kernel.js";
import { browserResult } from "./browser-results.js";
import init from "./engine/pkg/ramascene_engine.js";

let loaded;
let engine;
let compute;
self.onmessage = async ({ data: { id, base, body, single } }) => {
	try {
		loaded ??= fetchEngine(new URL(base)).catch((e) => {
			loaded = null;
			throw e;
		});
		// the kernel loads alongside the data, and a failed load is tried again on the next message
		engine ??= init().catch((e) => {
			engine = null;
			throw e;
		});
		// this message's own load: a failure resets engine before a later await could see null
		const kernel = engine;
		kernel.catch(() => {});
		const data = await loaded;
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
			// Diagnostics can force either build; the client leaves single unset until fallback.
			const broad = useThreads(plan(data.meta, body.model_details), single === false);
			let maths;
			try {
				if (broad && !single) {
					compute ??= loadKernel();
					maths = await compute;
				} else maths = await loadKernel(true);
			} catch {
				self.postMessage({ id, retrySingle: true });
				return;
			}
			const flows = await scenarioFlows(data, body.model_details, maths);
			const value = browserResult(data, body, flows, (performance.now() - start) / 1000);
			value.threads = maths.thread_count();
			self.postMessage({ id, value }, [value.result.flows.baseline.buffer, flows.buffer]);
		}
	} catch (e) {
		// A trap (out of memory, or a panic) leaves the kernel's memory held and its state
		// unknown, so the page stops this worker.
		if (e instanceof WebAssembly.RuntimeError)
			self.postMessage({
				id,
				fatal: true,
				error:
					"the calculation stopped in this browser, likely out of memory; reload the page to try again, or choose a narrower selection",
			});
		else self.postMessage({ id, error: e.message });
	}
};
