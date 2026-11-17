import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL, ask, askSchema, askUrl, leverText, systemPrompt, toModelDetails, toView } from "../src/lib/ask.js";
import { WORLD } from "../src/lib/flows.js";

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
	assert.deepEqual(s.properties.region.anyOf[0].enum, ["World", "Austria", "China"]);
	assert.deepEqual(s.properties.action.enum, ["view", "whatif", "none"]);
});

test("the prompt lists the catalogue and the examples", () => {
	const p = systemPrompt(catalog);
	assert.match(p, /Products: Motor vehicles; Steel\n/);
	assert.match(p, /Question: Aluminium input to all industries in Europe/);
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
	assert.throws(() => toModelDetails(Array(11).fill(lever()), catalog), /more than 10/);
	assert.equal(toModelDetails([lever({ change_percent: -100 })], catalog)[0].techChange[0], -100);
});

test("a lever reads in plain words", () => {
	assert.equal(
		leverText(lever({ origin_region: "Total" })),
		"Motor vehicles, made in all regions, used by Y: Final Consumption in Austria: −20%",
	);
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
	await assert.rejects(
		ask({ ...args, fetchFn: async () => Response.json({ choices: [{ message: { content: "no json" } }] }) }),
		/not valid JSON/,
	);
});
