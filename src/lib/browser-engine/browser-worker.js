import init from "../../../engine/pkg/ramascene_engine.js";
import { fetchEngine } from "./browser-data.js";
import { plan, readKey, scenarioFlows, startReads } from "./browser-engine.js";
import { loadKernel, useThreads } from "./browser-kernel.js";
import { browserResult } from "./browser-results.js";

let loaded;
let engine;
let compute;
const load = (base) =>
	(loaded ??= fetchEngine(new URL(base)).catch((e) => {
		loaded = null;
		throw e;
	}));
// the store's chunks decode in the kernel, so reads need it too; a failed load is tried again
const kernelLoad = () =>
	(engine ??= init().catch((e) => {
		engine = null;
		throw e;
	}));

// Reads started for the selection the form shows, before Run: {key, reads, stop}. One
// prefetch downloads at a time; while it does, only the newest selection waits. While a
// Run reads and computes, the newest selection waits for it, so the two never download
// together and share the memory budget.
let ahead = null;
let waiting = null;
let waitingBase;
let prefetching = false;
let running = 0;
const sameReads = (meta, steps, key) => {
	try {
		return readKey(plan(meta, steps)) === key;
	} catch {
		return false; // a selection the form will refuse
	}
};
async function prefetch(base, steps) {
	waiting = steps;
	waitingBase = base;
	if (prefetching || running) return;
	prefetching = true;
	try {
		const [data] = await Promise.all([load(base), kernelLoad()]);
		while (waiting && !running) {
			const planned = plan(data.meta, waiting);
			waiting = null;
			const key = readKey(planned);
			if (ahead?.key === key) continue;
			const controller = new AbortController();
			ahead = { key, reads: startReads(data, planned, controller.signal), stop: () => controller.abort() };
			const started = ahead;
			const settled = await Promise.allSettled(Object.values(started.reads));
			// failed reads would fail the run that takes them: Run reads afresh instead
			if (ahead === started && settled.some((r) => r.status === "rejected")) ahead = null;
		}
	} catch {
		// a selection the form will refuse, or a failed load: Run reports either
		waiting = null;
	} finally {
		prefetching = false;
	}
}

// A trap in a pool thread leaves the threaded call waiting instead of throwing, so the
// page times each call from these messages (browser-client.js). Downloads are not timed.
function timed(kernel, id) {
	const watch =
		(f) =>
		(...args) => {
			self.postMessage({ id, computing: true });
			try {
				return f(...args);
			} finally {
				self.postMessage({ id, computing: false });
			}
		};
	return { ...kernel, correction: watch(kernel.correction), fold: watch(kernel.fold) };
}

self.onmessage = async ({ data: { id, base, body, single, ahead: steps } }) => {
	if (steps) return prefetch(base, steps);
	let threaded = false;
	let counted = false;
	try {
		const loading = load(base);
		// the kernel loads alongside the data; this message keeps its own load, since a
		// failure resets engine before a later await could see null
		const kernel = kernelLoad();
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
			// Diagnostics can force either build; the client leaves single unset until fallback.
			const broad = useThreads(plan(data.meta, body.model_details), single === false);
			let maths;
			try {
				if (broad && !single) {
					compute ??= loadKernel();
					maths = timed(await compute, id);
					threaded = true;
				} else maths = await loadKernel(true);
			} catch {
				self.postMessage({ id, retrySingle: true });
				return;
			}
			running++;
			counted = true;
			const key = readKey(plan(data.meta, body.model_details));
			// a waiting selection this run reads already would only download again for nothing
			if (waiting && sameReads(data.meta, waiting, key)) waiting = null;
			let used = ahead;
			ahead = null;
			if (used && used.key !== key) {
				// another selection's reads beside this run's could pass the memory budget together
				used.stop();
				await Promise.allSettled(Object.values(used.reads));
				used = null;
			}
			const flows = await scenarioFlows(data, body.model_details, used, maths);
			const value = browserResult(data, body, flows, (performance.now() - start) / 1000);
			value.threads = maths.thread_count();
			self.postMessage({ id, value }, [value.result.flows.baseline.buffer, flows.buffer]);
		}
	} catch (e) {
		// A trap (out of memory, or a panic) leaves the kernel's memory held and its state
		// unknown, so the page stops this worker; a threaded run gets one try on one thread.
		if (e instanceof WebAssembly.RuntimeError && threaded) self.postMessage({ id, retrySingle: true });
		else if (e instanceof WebAssembly.RuntimeError)
			self.postMessage({
				id,
				fatal: true,
				error: "the calculation stopped in this browser, likely out of memory; choose a narrower selection",
			});
		else self.postMessage({ id, error: e.message });
	} finally {
		// the last Run out starts the selection that waited for it
		if (counted && --running === 0 && waiting) prefetch(waitingBase, waiting);
	}
};
