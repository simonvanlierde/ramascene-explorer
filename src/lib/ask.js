// The Ask panel's logic: question in, JSON action out, names mapped to catalogue ids.
// The model only picks names from enums; the engine computes every number. Kept in step with
// evals/ask/ask_eval.py (same schema shape and prompt), so that eval scores what the page sends.

import { placeName, WORLD } from "./flows.js";
import { CHANGE_RANGE, minus, serverUrl } from "./live.js";

export const ALL = "All industries";
// the section consumers (ids 1 to 15) that "All industries" stands for
const ALL_IDS = Array.from({ length: 15 }, (_, i) => i + 1);
export const INDICATORS = { ghg: 5, jobs: 3, metal_ores: 7 };
export const MAX_LEVERS = 10;
const TIMEOUT_MS = 60_000;

// Like apiUrl, but a base URL keeps its path (Ollama and vLLM serve at .../v1).
export function askUrl(search) {
	const url = serverUrl(search, "ask");
	return url && url.origin + url.pathname.replace(/\/+$/, "");
}

export const askModel = (search) => new URLSearchParams(search).get("askmodel") || null;

export const DETAIL = " (detail)";
// Name to id. A repeated name with the same leaves as its first entry is the same selection and
// keeps the first id; one with other leaves (the EXIOBASE product under a section of the same
// name) gets its own name, so the model can still pick it. Same rule as ask_eval.py.
// NOTE: one suffix, so a third differing entry of a name collapses into the second.
function namesOf(catalog) {
	const out = {};
	for (const kind of ["products", "regions", "consumers"]) {
		const ids = new Map();
		const leaves = new Map();
		for (const item of catalog[kind]) {
			const key = JSON.stringify(item.leaves);
			const name = !leaves.has(item.name) || leaves.get(item.name) === key ? item.name : item.name + DETAIL;
			if (ids.has(name)) continue;
			ids.set(name, item.id);
			leaves.set(name, key);
		}
		out[kind] = ids;
	}
	return out;
}

export function askSchema(catalog) {
	const names = namesOf(catalog);
	const regions = { enum: [...names.regions.keys()] };
	const lever = {
		type: "object",
		properties: {
			product: { enum: [...names.products.keys()] },
			origin_region: regions,
			consumed_by: { type: "array", minItems: 1, items: { enum: [ALL, ...names.consumers.keys()] } },
			consumed_region: regions,
			change_percent: { type: "number" },
		},
		required: ["product", "origin_region", "consumed_by", "consumed_region", "change_percent"],
	};
	// the first six regions are Total and the five world regions, which the map cannot select
	const viewRegion = { anyOf: [{ enum: ["World", ...[...names.regions.keys()].slice(6)] }, { type: "null" }] };
	return {
		type: "object",
		properties: {
			action: { enum: ["view", "whatif", "none"] },
			indicator: { anyOf: [{ enum: Object.keys(INDICATORS) }, { type: "null" }] },
			region: viewRegion,
			levers: { type: "array", maxItems: MAX_LEVERS, items: lever },
			reply: { type: "string" },
		},
		required: ["action", "indicator", "region", "levers", "reply"],
	};
}

// A published scenario as the model's own answer: the few-shot examples.
export const EXAMPLES = [
	{
		question: "Final demand for European motor vehicles in Europe −20%",
		levers: [
			{
				product: "Motor vehicles, trailers and semi-trailers",
				origin_region: "Europe",
				consumed_by: ["Y: Final Consumption"],
				consumed_region: "Europe",
				change_percent: -20,
			},
		],
	},
	{
		question: "Aluminium input to all industries in Europe −10%",
		levers: [
			{
				product: "Aluminium and aluminium products",
				origin_region: "Total",
				consumed_by: [ALL],
				consumed_region: "Europe",
				change_percent: -10,
			},
		],
	},
];

export function systemPrompt(catalog) {
	const names = namesOf(catalog);
	const shots = EXAMPLES.map(
		(e) =>
			`Question: ${e.question}\nAnswer: ${JSON.stringify({ action: "whatif", indicator: null, region: null, levers: e.levers, reply: e.question })}`,
	);
	return `You control the RaMa-Scene Explorer, a map of where a country's consumption causes
greenhouse-gas emissions (ghg), jobs and metal-ore extraction (metal_ores), from EXIOBASE for 2011.
You never compute numbers yourself: you only choose an action, and the page's engine calculates.

- action "view": change what the map shows. Set indicator and/or region; leave the other null.
  region is a country, or "World".
- action "whatif": define a scenario as levers. A lever changes how much of one product, made in
  origin_region, is used by consumed_by in consumed_region, by change_percent (-20 = 20% less).
  consumed_by "Y: Final Consumption" changes final demand (households buying less); any industry
  changes the input per unit of that industry's output. "All industries" means every industry.
  Use region "Total" for all regions.
- action "none": the question is not about the map; explain briefly in reply.
reply: one short sentence saying what you did.

Products: ${[...names.products.keys()].join("; ")}
Regions: ${[...names.regions.keys()].join("; ")}
Industries (consumed_by): ${[ALL, ...names.consumers.keys()].join("; ")}

Examples:
${shots.join("\n\n")}`;
}

// The answer's levers as the engine's model_details. Throws, naming the change, on a name the
// catalogue does not have or a change outside the engine's range; nothing is clamped.
export function toModelDetails(levers, catalog) {
	if (!Array.isArray(levers) || !levers.length) throw new Error("the answer has no changes to run");
	if (levers.length > MAX_LEVERS) throw new Error(`the answer has more than ${MAX_LEVERS} changes`);
	const names = namesOf(catalog);
	return levers.map((l, n) => {
		if (l === null || typeof l !== "object") throw new Error(`change ${n + 1} is not a change`);
		const id = (kind, name) => {
			const v = names[kind].get(name);
			if (v === undefined) throw new Error(`change ${n + 1}: "${name}" is not in the catalogue`);
			return v;
		};
		const by = Array.isArray(l.consumed_by) ? l.consumed_by : [];
		if (!by.length) throw new Error(`change ${n + 1}: no industry given`);
		const consumers = [...new Set(by.flatMap((name) => (name === ALL ? ALL_IDS : [id("consumers", name)])))];
		const change = l.change_percent;
		if (typeof change !== "number" || !Number.isFinite(change))
			throw new Error(`change ${n + 1}: the change must be a number (percent)`);
		if (change < CHANGE_RANGE.min || change > CHANGE_RANGE.max)
			throw new Error(
				`change ${n + 1}: ${minus(change)}% is outside the allowed ${minus(CHANGE_RANGE.min)} to ${CHANGE_RANGE.max} percent`,
			);
		return {
			product: [id("products", l.product)],
			originReg: [id("regions", l.origin_region)],
			consumedBy: consumers,
			consumedReg: [id("regions", l.consumed_region)],
			techChange: [change],
		};
	});
}

// One lever in plain words, from the names the model chose.
export function leverText(l) {
	const where = (r) => (r === "Total" ? "all regions" : r);
	const sign = l.change_percent > 0 ? "+" : "";
	return `${l.product}, made in ${where(l.origin_region)}, used by ${l.consumed_by.join(", ")} in ${where(l.consumed_region)}: ${sign}${minus(l.change_percent)}%`;
}

// Catalogue names of one kind (products, regions or consumers) that contain every word of the
// query, ignoring case. For an agent that has no enums to read the names from.
export function findNames(catalog, kind, query) {
	const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
	const all = [...namesOf(catalog)[kind].keys(), ...(kind === "consumers" ? [ALL] : [])];
	return all.filter((n) => words.every((w) => n.toLowerCase().includes(w)));
}

const SAYS = { ghg: "greenhouse-gas emissions", jobs: "jobs", metal_ores: "metal-ore extraction" };
// Applies a view answer to ui; the sentence saying what the map now shows. Throws as toView does,
// and when the answer changes nothing.
export function applyView(answer, meta, ui) {
	if (!meta) throw new Error("the map did not load, so it cannot change");
	const view = toView(answer, meta);
	if (!Object.keys(view).length)
		throw new Error("the view changes nothing on the map: it needs an indicator or a region");
	Object.assign(ui, view);
	const shows = [SAYS[answer.indicator], answer.region === "World" ? "the world" : answer.region].filter(Boolean);
	return `The map now shows ${shows.join(" for ")}.`;
}

// A view answer as ui fields; only what the answer sets is returned. meta is the page's
// (indicators with ids, countries). Throws when the page has no such indicator or country.
export function toView(answer, meta) {
	const out = {};
	if (answer.indicator != null) {
		const id = INDICATORS[answer.indicator];
		if (id === undefined || !meta.indicators.some((i) => i.id === id))
			throw new Error(`this data has no indicator "${answer.indicator}"`);
		out.indicator = id;
	}
	if (answer.region != null) {
		if (answer.region === "World") out.who = WORLD;
		else {
			const k = meta.countries.findIndex(
				(_, i) => placeName(meta, i) === answer.region || meta.countries[i] === answer.region,
			);
			if (k < 0) throw new Error(`this data has no country "${answer.region}"`);
			out.who = k;
		}
	}
	return out;
}

// One chat call: the parsed answer. Errors (timeout, HTTP, unparsable) are thrown as readable
// text; `cancel`, an AbortSignal, stops it with an AbortError.
export async function ask({ base, model, system, schema, question, cancel }) {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
	const post = async (path, init) => {
		let r;
		try {
			// a redirect could carry the question to another host than the one the panel names
			r = await fetch(`${base}${path}`, { ...init, signal, redirect: "error" });
			if (r.ok) return await r.json();
		} catch (e) {
			if (e.name === "AbortError") throw e;
			if (e.name === "TimeoutError")
				throw new Error(
					`the model did not answer within ${TIMEOUT_MS / 1000} s. Check that the model server is running, then ask again.`,
				);
			if (e.name === "SyntaxError")
				throw new Error(
					`the model server's reply to ${path} was not JSON. Check that ?ask= names a chat-completions server.`,
				);
			throw new Error(
				`could not reach the model at ${base} (${e.message}). Check that the server is running, then ask again.`,
			);
		}
		// the body usually names the cause (context too long, model still loading)
		const why = (await r.text().catch(() => "")).trim().slice(0, 200);
		throw new Error(`the model server answered ${r.status}${why ? `: ${why}` : ""}. Check the server, then ask again.`);
	};
	const name = model ?? (await post("/models", {})).data?.[0]?.id;
	if (!name) throw new Error("the model server lists no model. Name one with ?askmodel=.");
	const body = {
		model: name,
		temperature: 0,
		max_tokens: 1500,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: question },
		],
		response_format: { type: "json_schema", json_schema: { name: "action", schema } },
		chat_template_kwargs: { enable_thinking: false },
	};
	const data = await post("/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (data.choices?.[0]?.finish_reason === "length")
		throw new Error("the model's answer was cut off before it finished. Ask again with a shorter question.");
	let got;
	try {
		got = JSON.parse(data.choices[0].message.content);
	} catch {
		got = null;
	}
	if (got === null || typeof got !== "object" || Array.isArray(got))
		throw new Error("the model's answer was not valid JSON. Ask again.");
	return got;
}
