import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, test } from "node:test";
import {
	ALL,
	applyView,
	ask as askReal,
	askSchema,
	askUrl,
	DETAIL,
	findNames,
	INDICATORS,
	leverText,
	systemPrompt,
	toModelDetails,
	toView,
} from "../src/lib/ask.js";
import { WORLD } from "../src/lib/flows.js";

// ask() uses the global fetch: each call here names the fake it runs against
const realFetch = globalThis.fetch;
after(() => {
	globalThis.fetch = realFetch;
});
const ask = ({ fetchFn, ...opts }) => {
	globalThis.fetch = fetchFn;
	return askReal(opts);
};

const consumers = [
	...Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `S: Section ${i + 1}`, final: false, leaves: [i] })),
	{ id: 198, name: "S: Manufacture of motor vehicles", final: false, leaves: [198] },
	{ id: 276, name: "Y: Final Consumption", final: true, leaves: [0] },
];
const catalog = {
	products: [
		{ id: 180, name: "Motor vehicles" },
		{ id: 7, name: "Steel" },
		{ id: 8, name: "Steel" },
	],
	regions: ["Total", "Europe", "Middle-East", "America", "Asia-Pacific", "Africa", "Austria", "China"].map(
		(name, i) => ({ id: i, name }),
	),
	consumers,
};
const lever = (over = {}) => ({
	product: "Motor vehicles",
	origin_region: "Europe",
	consumed_by: ["Y: Final Consumption"],
	consumed_region: "Austria",
	change_percent: -20,
	...over,
});

test("askUrl accepts https and loopback http, keeps the path, refuses the rest", () => {
	assert.equal(askUrl("?ask=https://models.example.org/v1/"), "https://models.example.org/v1");
	assert.equal(askUrl("?ask=http://localhost:11434/v1"), "http://localhost:11434/v1");
	assert.equal(askUrl("?ask=http://127.0.0.1:8000/v1"), "http://127.0.0.1:8000/v1");
	for (const bad of [
		"http://models.example.org/v1",
		"ftp://localhost",
		"https://u:p@x.org/v1",
		"https://x.org/v1?k=1",
		"https://x.org/#a",
		"https://x.org/v1?",
		"https://x.org/v1#",
		"nope",
	])
		assert.equal(askUrl(`?ask=${encodeURIComponent(bad)}`), null, bad);
	assert.equal(askUrl(""), null);
});

test("the schema's enums are the catalogue names, without repeats", () => {
	const s = askSchema(catalog);
	const l = s.properties.levers.items.properties;
	assert.deepEqual(l.product.enum, ["Motor vehicles", "Steel"]);
	assert.equal(l.consumed_by.items.enum[0], ALL);
	assert.ok(l.consumed_by.items.enum.includes("Y: Final Consumption"));
	assert.equal(s.properties.levers.maxItems, 10);
	assert.equal(l.consumed_by.minItems, 1);
	assert.deepEqual(s.properties.region.anyOf[0].enum, ["World", "Austria", "China"]);
	assert.deepEqual(s.properties.action.enum, ["view", "whatif", "none"]);
});

test("the prompt lists the catalogue and the examples", () => {
	const p = systemPrompt(catalog);
	assert.match(p, /Products: Motor vehicles; Steel\n/);
	assert.match(p, /Question: Aluminium input to all industries in Europe/);
	assert.match(p, /Regions: Total; Europe; Middle-East/);
	assert.match(p, /Industries \(consumed_by\): All industries; S: Section 1; /);
	assert.match(p, /"All industries" means every industry/);
});

test("names map to ids, and All industries is consumers 1 to 15", () => {
	const [a, b] = toModelDetails(
		[lever(), lever({ product: "Steel", consumed_by: [ALL], origin_region: "Total", change_percent: 1000 })],
		catalog,
	);
	assert.deepEqual(a, { product: [180], originReg: [1], consumedBy: [276], consumedReg: [6], techChange: [-20] });
	assert.deepEqual(
		b.consumedBy,
		Array.from({ length: 15 }, (_, i) => i + 1),
	);
	assert.deepEqual(b.product, [7]); // a repeated name keeps its first id
	// a consumer named twice, or inside All industries, is sent once
	const [c] = toModelDetails(
		[lever({ consumed_by: [ALL, "S: Section 2", "S: Manufacture of motor vehicles"] })],
		catalog,
	);
	assert.equal(c.consumedBy.length, 16);
	assert.deepEqual(b.originReg, [0]);
});

test("unknown names and out-of-range changes are errors naming the change", () => {
	assert.throws(
		() => toModelDetails([lever(), lever({ product: "Gold" })], catalog),
		/change 2: "Gold" is not in the catalogue/,
	);
	assert.throws(() => toModelDetails([lever({ consumed_by: ["Nobody"] })], catalog), /Nobody/);
	assert.throws(() => toModelDetails([lever({ change_percent: -100.5 })], catalog), /change 1: .*outside/);
	assert.throws(() => toModelDetails([lever({ change_percent: 1001 })], catalog), /outside/);
	assert.throws(() => toModelDetails([lever({ change_percent: "20" })], catalog), /must be a number/);
	assert.throws(() => toModelDetails([], catalog), /no changes/);
	for (const bad of [null, "Steel", 3])
		assert.throws(() => toModelDetails([lever(), bad], catalog), /change 2 is not a change/);
	assert.throws(() => toModelDetails(Array(11).fill(lever()), catalog), /more than 10/);
	assert.equal(toModelDetails([lever({ change_percent: -100 })], catalog)[0].techChange[0], -100);
});

test("a lever reads in plain words", () => {
	assert.equal(
		leverText(lever({ origin_region: "Total" })),
		"Motor vehicles, made in all regions, used by Y: Final Consumption in Austria: −20%",
	);
	assert.match(leverText(lever({ change_percent: 10 })), /: \+10%$/);
});

const meta = {
	indicators: [{ id: 5 }, { id: 3 }],
	countries: ["Austria", "China"],
	country_codes: ["AT", "CN"],
};

test("a view answer maps indicator and region, and leaves the rest unset", () => {
	assert.deepEqual(toView({ indicator: "jobs", region: "China" }, meta), { indicator: 3, who: 1 });
	assert.deepEqual(toView({ indicator: null, region: "World" }, meta), { who: WORLD });
	assert.deepEqual(toView({ indicator: "ghg", region: null }, meta), { indicator: 5 });
	assert.throws(() => toView({ indicator: "metal_ores", region: null }, meta), /no indicator/);
	assert.throws(() => toView({ indicator: null, region: "Atlantis" }, meta), /no country/);
});

test("findNames matches every word, ignoring case; industries include All industries", () => {
	assert.deepEqual(findNames(catalog, "products", "steel"), ["Steel"]);
	assert.deepEqual(findNames(catalog, "consumers", "MOTOR manufacture"), ["S: Manufacture of motor vehicles"]);
	assert.ok(findNames(catalog, "consumers", "all").includes(ALL));
	assert.deepEqual(findNames(catalog, "products", "steel zzz"), []);
	assert.deepEqual(findNames(catalog, "regions", "atlantis"), []);
});

test("applyView sets the ui and says what the map shows", () => {
	const ui = { indicator: 5, who: 0 };
	assert.equal(applyView({ indicator: "jobs", region: "China" }, meta, ui), "The map now shows jobs for China.");
	assert.deepEqual(ui, { indicator: 3, who: 1 });
	assert.equal(applyView({ indicator: null, region: "World" }, meta, ui), "The map now shows the world.");
	assert.throws(() => applyView({ indicator: null, region: null }, meta, ui), /changes nothing/);
	assert.throws(() => applyView({ indicator: "jobs" }, undefined, ui), /did not load/);
});

test("ask posts one chat request with the schema, and reads the model name from /models", async () => {
	const calls = [];
	const schema = askSchema(catalog);
	const fetchFn = async (url, init) => {
		calls.push([url, init]);
		if (url.endsWith("/models")) return Response.json({ data: [{ id: "qwen" }] });
		return Response.json({ choices: [{ message: { content: JSON.stringify({ action: "none", reply: "ok" }) } }] });
	};
	const got = await ask({ base: "http://localhost:1/v1", system: "S", schema, question: "Q?", fetchFn });
	assert.equal(got.reply, "ok");
	assert.equal(calls[0][0], "http://localhost:1/v1/models");
	assert.equal(calls[1][0], "http://localhost:1/v1/chat/completions");
	const body = JSON.parse(calls[1][1].body);
	assert.equal(body.model, "qwen");
	assert.equal(body.temperature, 0);
	assert.equal(body.max_tokens, 1500);
	assert.ok(calls[1][1].signal instanceof AbortSignal);
	assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
	assert.equal(body.response_format.type, "json_schema");
	assert.equal(body.response_format.json_schema.name, "action");
	assert.deepEqual(body.response_format.json_schema.schema, schema);
	assert.deepEqual(
		body.messages.map((m) => m.role),
		["system", "user"],
	);
	// a named model skips /models
	calls.length = 0;
	await ask({ base: "http://localhost:1/v1", model: "m", system: "S", schema, question: "Q?", fetchFn });
	assert.equal(calls.length, 1);
});

test("ask turns failures into readable errors", async () => {
	const base = "http://localhost:1/v1";
	const args = { base, model: "m", system: "S", schema: {}, question: "Q?" };
	await assert.rejects(ask({ ...args, fetchFn: async () => Response.json({}, { status: 503 }) }), /answered 503/);
	// the server's own words for an error are kept, cut short
	await assert.rejects(
		ask({ ...args, fetchFn: async () => new Response(`context too long ${"x".repeat(500)}`, { status: 400 }) }),
		(e) => e.message.startsWith("the model server answered 400: context too long") && e.message.length < 300,
	);
	await assert.rejects(
		ask({
			...args,
			fetchFn: async () =>
				Response.json({ choices: [{ message: { content: '{"action":' }, finish_reason: "length" }] }),
		}),
		/cut off/,
	);
	// Cancel is the reader's own act, not an error to word
	const stop = new AbortController();
	stop.abort();
	await assert.rejects(
		ask({ ...args, cancel: stop.signal, fetchFn: async (_, init) => init.signal.throwIfAborted() }),
		{ name: "AbortError" },
	);
	await assert.rejects(
		ask({
			...args,
			fetchFn: async () => {
				throw new TypeError("Failed to fetch");
			},
		}),
		/could not reach the model/,
	);
	await assert.rejects(
		ask({
			...args,
			fetchFn: async () => {
				throw Object.assign(new Error("t"), { name: "TimeoutError" });
			},
		}),
		/did not answer within/,
	);
	for (const content of ["no json", null, "42", '"a string"', "[1]", "null"])
		await assert.rejects(
			ask({ ...args, fetchFn: async () => Response.json({ choices: [{ message: { content } }] }) }),
			/not valid JSON/,
			String(content),
		);
	await assert.rejects(ask({ ...args, fetchFn: async () => Response.json({}) }), /not valid JSON/);
	// a 200 whose body is not JSON (a proxy's HTML page)
	await assert.rejects(
		ask({ ...args, fetchFn: async () => new Response("<html>login</html>") }),
		/reply to \/chat\/completions was not JSON/,
	);
	// the body read can time out too
	await assert.rejects(
		ask({
			...args,
			fetchFn: async () => ({
				ok: true,
				json: async () => {
					throw Object.assign(new Error("t"), { name: "TimeoutError" });
				},
			}),
		}),
		/did not answer within/,
	);
});

test("ask refuses redirects", async () => {
	const inits = [];
	const fetchFn = async (_, init) => {
		inits.push(init);
		return Response.json({ data: [{ id: "m" }], choices: [{ message: { content: "{}" } }] });
	};
	await ask({ base: "http://localhost:1/v1", system: "S", schema: {}, question: "Q?", fetchFn });
	assert.equal(inits.length, 2);
	for (const init of inits) assert.equal(init.redirect, "error");
});

test("a repeated name with other leaves gets its own name; one with the same leaves collapses", () => {
	const c = {
		...catalog,
		products: [
			{ id: 16, name: "Other services", leaves: [1, 2, 3] },
			{ id: 50, name: "Construction", leaves: [9] },
			{ id: 51, name: "Construction", leaves: [9] },
			{ id: 74, name: "Other services", leaves: [3] },
		],
	};
	const s = askSchema(c);
	assert.deepEqual(s.properties.levers.items.properties.product.enum, [
		"Other services",
		"Construction",
		`Other services${DETAIL}`,
	]);
	const ids = (product) => toModelDetails([lever({ product })], c)[0].product;
	assert.deepEqual(ids("Other services"), [16]);
	assert.deepEqual(ids(`Other services${DETAIL}`), [74]);
	assert.deepEqual(ids("Construction"), [50]);
	assert.match(systemPrompt(c), /Products: Other services; Construction; Other services \(detail\)\n/);
});

// The real catalogue is a fetched release asset (docs/browser-engine.md), so these skip without it.
const MANIFEST = "data/browser-engine/manifest-v3.json";
// CI fetches the data, so there a missing file fails the test instead of skipping it
const noResults = !existsSync("data/results.json") && !process.env.CI && "data/results.json is missing";
const noManifest =
	!existsSync(MANIFEST) && !process.env.CI && `${MANIFEST} is missing: fetch the browser store to run this test`;

test("the real catalogue matches what ask.js assumes", { skip: noManifest }, () => {
	const real = JSON.parse(readFileSync(MANIFEST, "utf8")).catalog;
	const sections = real.consumers.filter((c) => c.id <= 15);
	assert.equal(sections.length, 15);
	for (const c of sections) assert.match(c.name, /^S: /, `consumer ${c.id}`);
	// sections cover every industry between them, so All industries is consumers 1 to 15
	const leaves = sections.flatMap((c) => c.leaves);
	assert.equal(new Set(leaves).size, leaves.length);
	assert.deepEqual(
		real.consumers.filter((c) => c.final).map((c) => c.id),
		[276],
	);
	assert.deepEqual(
		real.regions.slice(0, 6).map((r) => [r.id, r.name]),
		[
			[1, "Total"],
			[2, "Europe"],
			[3, "Middle-East"],
			[4, "America"],
			[5, "Asia-Pacific"],
			[6, "Africa"],
		],
	);
	// every name in the schema maps back to an id, and the narrow repeated selections stay reachable
	const product = askSchema(real).properties.levers.items.properties.product.enum;
	assert.ok(product.includes(`Other service activities${DETAIL}`));
	assert.equal(new Set(product).size, product.length);
});

test("the indicator ids ask.js names are the published ones", { skip: noResults }, () => {
	const names = Object.fromEntries(
		JSON.parse(readFileSync("data/results.json", "utf8")).indicators.map((i) => [i.id, i.name]),
	);
	assert.match(names[INDICATORS.ghg], /^GHG emissions/);
	assert.match(names[INDICATORS.jobs], /^Employment/);
	assert.match(names[INDICATORS.metal_ores], /Metal Ores/);
});

const noPython = spawnSync("python3", ["-I", "-c", ""]).error && "python3 is not installed";

test("the eval sends the page's prompt and schema, byte for byte", {
	skip: noManifest || noResults || noPython,
}, () => {
	const real = JSON.parse(readFileSync(MANIFEST, "utf8")).catalog;
	const code = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("e", "evals/ask/ask_eval.py")
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
names, scen, _ = e.load(sys.argv[1], "data/results.json")
print(json.dumps([e.system_prompt(names, scen), e.schema(names)], ensure_ascii=False))`;
	const out = spawnSync("python3", ["-I", "-B", "-c", code, MANIFEST], { encoding: "utf8" });
	assert.equal(out.status, 0, out.stderr);
	const [prompt, schema] = JSON.parse(out.stdout);
	assert.equal(prompt, systemPrompt(real));
	assert.deepEqual(schema, askSchema(real));
});

// The Python test of the same check skips in CI's precompute job, which has no store; this job has one
test("the eval's items name only catalogue entries and scenarios", {
	skip: noManifest || noResults || noPython,
}, () => {
	const code = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("e", "evals/ask/ask_eval.py")
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
names, scen, leaves = e.load(sys.argv[1], "data/results.json")
items = e.load_items(e.ITEMS, names, scen, leaves)
print(json.dumps([k for k, *_ in items]))`;
	// load_items raises on a view answer the schema does not allow, an accept lever with a name
	// outside the catalogue, a paraphrase of no scored scenario, or a repeated question
	const out = spawnSync("python3", ["-I", "-B", "-c", code, MANIFEST], { encoding: "utf8" });
	assert.equal(out.status, 0, out.stderr);
	const kinds = JSON.parse(out.stdout);
	const file = JSON.parse(readFileSync("evals/ask/items.json", "utf8"));
	for (const kind of ["paraphrase", "view", "none"])
		assert.equal(kinds.filter((k) => k === kind).length, file[kind].length, kind);
});
