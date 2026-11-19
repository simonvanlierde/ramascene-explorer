// Tools for an agent in the reader's own browser (WebMCP, `document.modelContext`): the same
// contract as the Ask panel (names in, the page's engine computes, nothing clamped), so an agent
// can change the view or run a what-if on the map the reader is looking at. docs/interface.md#webmcp.

import { applyView, findNames, INDICATORS, leverText, MAX_LEVERS, toModelDetails } from "./ask.js";
import { CHANGE_RANGE } from "./live.js";

const KINDS = { products: "products", regions: "regions", industries: "consumers" };

// The map's headline once it has changed from `before`: the sentence a reader sees, numbers included.
async function headlineAfter(before) {
	const text = () => document.getElementById("headline")?.textContent.trim() ?? "";
	for (let i = 0; i < 50 && text() === before; i++) await new Promise((r) => setTimeout(r, 100));
	return text();
}

// panel: the mounted LivePanel (catalogue, runScenario, cancelRun); setMode: App's; signal
// unregisters the tools. Does nothing in a browser without WebMCP.
export function registerTools({ panel, meta, ui, setMode, signal }) {
	const mc = document.modelContext;
	if (!mc?.registerTool) return;
	const catalog = async () => {
		const c = await panel.catalogue();
		if (!c) throw new Error("the scenario data did not load; try again");
		return c;
	};
	const lever = {
		type: "object",
		properties: {
			product: { type: "string", description: "a product name from find_names" },
			origin_region: { type: "string", description: 'where it is made; "Total" for all regions' },
			consumed_by: {
				type: "array",
				minItems: 1,
				items: { type: "string" },
				description:
					'industry names from find_names; "Y: Final Consumption" for household demand, "All industries" for every industry',
			},
			consumed_region: { type: "string", description: 'where it is used; "Total" for all regions' },
			change_percent: {
				type: "number",
				minimum: CHANGE_RANGE.min,
				maximum: CHANGE_RANGE.max,
				description: "-20 is 20% less",
			},
		},
		required: ["product", "origin_region", "consumed_by", "consumed_region", "change_percent"],
		additionalProperties: false,
	};
	const tools = [
		{
			name: "find_names",
			title: "Find catalogue names",
			description:
				"RaMa-Scene Explorer (EXIOBASE, 2011): the product, region or industry names a what-if accepts that contain every word of the query. Names must be passed to run_whatif exactly as returned.",
			inputSchema: {
				type: "object",
				properties: { kind: { enum: Object.keys(KINDS) }, query: { type: "string" } },
				required: ["kind", "query"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true },
			execute: async ({ kind, query }) => ({ names: findNames(await catalog(), KINDS[kind], query) }),
		},
		{
			name: "show_view",
			title: "Change the map's view",
			description:
				"Changes what the map shows: the indicator (ghg emissions, jobs or metal-ore extraction) and/or the consuming country (a country name, or World). Leave out what should stay.",
			inputSchema: {
				type: "object",
				properties: { indicator: { enum: Object.keys(INDICATORS) }, region: { type: "string" } },
				additionalProperties: false,
			},
			execute: async ({ indicator = null, region = null }) => ({ outcome: applyView({ indicator, region }, meta, ui) }),
		},
		{
			name: "run_whatif",
			title: "Run a what-if scenario",
			description:
				"Changes how much of a product, made in one region, the given industries in another region use per unit of output (or households buy), then computes the result in this browser and shows it on the map. Returns the changes as run and the map's headline with the numbers. The model behind this page never estimates numbers; the engine computes them.",
			inputSchema: {
				type: "object",
				properties: { levers: { type: "array", minItems: 1, maxItems: MAX_LEVERS, items: lever } },
				required: ["levers"],
				additionalProperties: false,
			},
			execute: async ({ levers }, { signal: stop } = {}) => {
				const model_details = toModelDetails(levers, await catalog());
				// the run shows only in What if…: the agent asked for one, so go there first
				setMode("whatif");
				const before = document.getElementById("headline")?.textContent.trim() ?? "";
				stop?.addEventListener("abort", () => panel.cancelRun(), { once: true });
				const { ok, text, cancelled } = await panel.runScenario({ label: "custom scenario", model_details });
				if (cancelled) throw new Error("cancelled");
				if (!ok) throw new Error(text);
				return { changes: levers.map(leverText), outcome: text, headline: await headlineAfter(before) };
			},
		},
	];
	// a refused tool (the page not allowed the "tools" feature) leaves the page as it is
	for (const tool of tools) mc.registerTool(tool, { signal }).catch(() => {});
}
