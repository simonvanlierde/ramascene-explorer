import { liveFlows } from "./live.js";

export const BROWSER_STATUS = "computed in this browser";
export const BROWSER_SOURCE = {
	status: BROWSER_STATUS,
	pill: "Browser method",
	heading: "Custom calculation",
	note: "The browser recalculates the 2011 supply chain using float64 Woodbury updates on matrices stored as float32. All published scenarios match RaMa-Scene within relative 1e-6. This agreement checks the calculation; assess the assumptions of your custom scenario separately.",
};

export function browserProvenance(job) {
	return [
		["Status", BROWSER_STATUS],
		["Dataset", "EXIOBASE v3.3.sm · doi:10.5281/zenodo.3533196 · 2011 · CC BY 4.0"],
		["Method", "Float64 Woodbury update on float32 matrices, computed in a worker on this device"],
		["Scenario parameters", JSON.stringify(job.scenario.model_details)],
		["Computed", `${job.duration_s < 0.01 ? "less than 0.01" : job.duration_s.toFixed(2)} s including data reads`],
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
