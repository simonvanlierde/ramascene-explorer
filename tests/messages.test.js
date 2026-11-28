import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { msg } from "../src/lib/messages.js";

// Every msg.a.b the page's code reads. A key read by index (msg.runs[id]) counts as
// reading msg.runs whole; msg.newTab.trim resolves through the string's own method.
const files = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : /\.(js|svelte)$/.test(e.name) ? [join(dir, e.name)] : [],
	);
const used = new Set(
	files("src").flatMap((f) =>
		[...readFileSync(f, "utf8").matchAll(/(?<![\w.$])msg((?:\.[A-Za-z_$][\w$]*)+)/g)].map((m) => m[1].slice(1)),
	),
);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

test("every message the code reads exists", () => {
	assert.ok(used.size > 200, `found only ${used.size} msg.… reads`);
	const missing = [...used].filter((path) => path.split(".").reduce((o, k) => o?.[k], msg) === undefined);
	assert.deepEqual(missing, []);
});

test("every message in the catalogue is read somewhere", () => {
	const unused = [];
	const walk = (o, path) => {
		for (const [k, v] of Object.entries(o)) {
			const p = path ? `${path}.${k}` : k;
			if (used.has(p)) continue;
			if (plain(v)) walk(v, p);
			else unused.push(p);
		}
	};
	walk(msg, "");
	assert.deepEqual(unused, []);
});
