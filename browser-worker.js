import { fetchEngine } from "./browser-data.js";
import { scenarioFlows } from "./browser-engine.js";
import { browserResult } from "./browser-results.js";
import init from "./engine/pkg/ramascene_engine.js";

let loaded;
let engine;
self.onmessage = async ({ data: { id, base, body } }) => {
	try {
		loaded ??= fetchEngine(new URL(base)).catch((e) => {
			loaded = null;
			throw e;
		});
		engine ??= init();
		const [data] = await Promise.all([loaded, engine]);
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
			const start = performance.now();
			const flows = await scenarioFlows(data, body.model_details);
			const value = browserResult(data, body, flows, (performance.now() - start) / 1000);
			self.postMessage({ id, value }, [value.result.flows.baseline.buffer, flows.buffer]);
		}
	} catch (e) {
		self.postMessage({ id, error: e.message });
	}
};
