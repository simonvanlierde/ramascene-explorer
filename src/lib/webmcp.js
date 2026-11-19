// Tools for an agent in the reader's own browser (WebMCP, `document.modelContext`): the same
// contract as the Ask panel (names in, the page's engine computes, nothing clamped), so an agent
// can change the view or run a what-if on the map the reader is looking at. docs/interface.md#webmcp.

import { tick } from "svelte";
import { applyView, findNames, INDICATORS, leverText, MAX_LEVERS, toModelDetails } from "./ask.js";
import { CHANGE_RANGE } from "./live.js";

const KINDS = { products: "products", regions: "regions", industries: "consumers" };
const FOUND = 25;

// panel: the mounted LivePanel (catalogue, runScenario, cancelRun); setMode: App's; drawn: App's
// promise for the last run sent to the map, settled once it is on screen; signal unregisters the
// tools.
export function registerTools({ panel, meta, ui, setMode, drawn, signal }) {
	const catalog = async () => {
		const c = await panel.catalogue();
		if (!c) throw new Error("the scenario data did not load; try again");
		return c;
	};
	const lever = {
		type: "object",
		properties: {
			product: { type: "string", description: "a product name from find_names" },
			origin_region: { type: "string", description: 'where it is made: a region from find_names, "Total" for all' },
			consumed_by: {
				type: "array",
				minItems: 1,
				items: { type: "string" },
				description:
					'industry names from find_names; "Y: Final Consumption" for household demand, "All industries" for every industry',
			},
			consumed_region: { type: "string", description: 'where it is used: a region from find_names, "Total" for all' },
			change_percent: {
				type: "number",
				minimum: CHANGE_RANGE.min,
				maximum: CHANGE_RANGE.max,
				description: `percent, ${CHANGE_RANGE.min} to ${CHANGE_RANGE.max}; -20 is 20% less`,
			},
		},
		required: ["product", "origin_region", "consumed_by", "consumed_region", "change_percent"],
		additionalProperties: false,
	};
	const tools = [
		{
			name: "find_names",
			title: "Find catalogue names",
			description: `RaMa-Scene Explorer (EXIOBASE, 2011): the names of one kind (products, regions or industries) that contain every word of the query, at most ${FOUND}; more: true means narrow the query. Regions include "Total" and five world regions besides the countries. Pass names to run_whatif exactly as returned.`,
			inputSchema: {
				type: "object",
				properties: { kind: { enum: Object.keys(KINDS) }, query: { type: "string" } },
				required: ["kind", "query"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true },
			execute: async ({ kind, query }) => {
				if (!Object.hasOwn(KINDS, kind)) throw new Error(`kind must be one of ${Object.keys(KINDS).join(", ")}`);
				const names = findNames(await catalog(), KINDS[kind], String(query ?? ""));
				return { names: names.slice(0, FOUND), more: names.length > FOUND };
			},
		},
		{
			name: "show_view",
			title: "Change the map's view",
			description:
				'Changes what the map shows: the indicator (ghg emissions, jobs or metal-ore extraction) and/or the consuming country (a country name, or "World"; not "Total" or a world region). Leave out what should stay.',
			inputSchema: {
				type: "object",
				properties: { indicator: { enum: Object.keys(INDICATORS) }, region: { type: "string" } },
				additionalProperties: false,
			},
			execute: async ({ indicator = null, region = null } = {}) => ({
				outcome: applyView({ indicator, region }, meta, ui),
			}),
		},
		{
			name: "run_whatif",
			title: "Run a what-if scenario",
			description:
				"Changes how much of a product, made in one region, the given industries in another region use per unit of output (or households buy), then computes the result in this browser, which can take seconds, and shows it in the page's What if… view. Returns the changes as run and the map's headline with the numbers. Unknown names and changes out of range are errors; nothing is clamped. The engine computes every number.",
			inputSchema: {
				type: "object",
				properties: { levers: { type: "array", minItems: 1, maxItems: MAX_LEVERS, items: lever } },
				required: ["levers"],
				additionalProperties: false,
			},
			execute: async ({ levers } = {}, { signal: stop } = {}) => {
				const model_details = toModelDetails(levers, await catalog());
				if (stop?.aborted) throw new Error("cancelled");
				const before = drawn();
				const cancel = () => panel.cancelRun();
				stop?.addEventListener("abort", cancel);
				let run;
				try {
					run = await panel.runScenario({ label: "custom scenario", model_details });
				} finally {
					stop?.removeEventListener("abort", cancel);
				}
				if (run.cancelled) throw new Error("cancelled");
				if (!run.ok) throw new Error(run.text);
				const changes = levers.map(leverText);
				// a run the map could not draw leaves the last one on screen
				if (drawn() === before) return { changes, outcome: run.text, headline: null };
				await drawn();
				setMode("whatif");
				await tick();
				return { changes, outcome: run.text, headline: document.getElementById("headline")?.textContent.trim() ?? "" };
			},
		},
	];
	// a refused tool (the page not allowed the "tools" feature) leaves the page as it is
	for (const tool of tools) document.modelContext.registerTool(tool, { signal }).catch(() => {});
}
