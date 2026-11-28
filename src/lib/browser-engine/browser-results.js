import { liveFlows } from "../live.js";
import { msg } from "../messages.js";

export const BROWSER_STATUS = msg.browser.status;
const BROWSER_SOURCE = {
	status: BROWSER_STATUS,
	pill: msg.browser.pill,
	heading: msg.browser.heading,
	note: msg.browser.note,
};

export function browserProvenance(job) {
	return [
		[msg.terms.status, BROWSER_STATUS],
		[msg.terms.dataset, "EXIOBASE v3.3.sm · doi:10.5281/zenodo.3533196 · 2011 · CC BY 4.0"],
		[msg.terms.method, msg.browser.method],
		[msg.terms.parameters, job.scenario.model_details.map((s) => JSON.stringify(s)).join("\n")],
		[
			msg.terms.computed,
			msg.browser.computed(job.duration_s < 0.01 ? msg.browser.lessThan : job.duration_s.toFixed(2)),
		],
	];
}

export function browserRun(job, meta, text) {
	return {
		run: `browser-${job.id}`,
		...liveFlows(job, meta),
		live: { source: BROWSER_SOURCE, text, rows: browserProvenance(job), job },
	};
}

// Reuse the custom panel's result contract, without pretending that a server
// job or a measured worker RSS exists for a browser computation.
export function browserResult(data, body, scenario, duration) {
	const { meta } = data;
	const countries = meta.catalog.regions.filter((r) => r.leaves.length === 1).sort((a, b) => a.leaves[0] - b.leaves[0]);
	const baseline = Float64Array.from(data.baseline);
	const C = meta.countries;
	const S = meta.sections.length;
	const totals = (flows) =>
		Object.fromEntries(
			meta.indicators.map((id, i) => [
				id,
				Object.fromEntries(
					countries.map((r, p) => {
						let value = 0;
						for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) value += flows[((i * C + p) * S + s) * C + c];
						return [r.name, value];
					}),
				),
			]),
		);
	return {
		id: crypto.randomUUID(),
		duration_s: duration,
		scenario: body,
		result: {
			regions: countries.map((r) => r.name),
			indicators: meta.indicators.map((id) => ({ id })),
			provenance: { dataset: meta.dataset },
			results: { baseline: totals(baseline), scenario: totals(scenario) },
			flows: { shape: [meta.indicators.length, C, S, C], baseline, scenario },
		},
	};
}
