import { fetchEngine, outputFlows } from "./browser-data.js";
import { scenarioOutput } from "./browser-engine.js";
import { browserResult } from "./browser-results.js";

let loaded;
self.onmessage = async ({ data: { id, base, body } }) => {
	try {
		loaded ??= fetchEngine(new URL(base)).catch((e) => {
			loaded = null;
			throw e;
		});
		const data = await loaded;
		// the form checks a selection's size with these before sending it
		if (!body)
			self.postMessage({
				id,
				value: { ...data.meta.catalog, size: { products: data.meta.products, countries: data.meta.countries } },
			});
		else {
			const start = performance.now();
			const output = await scenarioOutput(data, body.model_details);
			const flows = outputFlows(data, output);
			const value = browserResult(data, body, flows, (performance.now() - start) / 1000);
			self.postMessage({ id, value }, [value.result.flows.baseline.buffer, flows.buffer]);
		}
	} catch (e) {
		self.postMessage({ id, error: e.message });
	}
};
