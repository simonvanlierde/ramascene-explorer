// The agreement table's 1 M EUR of Dutch cement through the browser reader.
// Run: node brightway-check/browser_check.js data/browser-engine [results/browser.json]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { openEngine } from "../src/lib/browser-engine/browser-data.js";
import { localRange } from "../tests/local-range.js";
import "../tests/engine-wasm.js";

const directory = process.argv[2];
if (!directory) throw new Error("pass the exported browser data directory");
const meta = JSON.parse(readFileSync(`${directory}/manifest-v3.json`, "utf8"));
const data = openEngine(meta, localRange(directory, meta));
// H's first indicator (GHG) over every producer and section: B₀ · L[:, cement]
const totals = await data.read("H", [4100]);
const width = meta.countries * meta.sections.length;
const score = totals.subarray(0, width).reduce((sum, v) => sum + v, 0);
const expected = JSON.parse(readFileSync(new URL("results/lca.json", import.meta.url), "utf8")).brightway;
// The export stores float32; the parity tests hold the browser to relative 1e-6.
assert.ok(Math.abs(score - expected) <= 1e-6 * Math.abs(expected));
const out = `${JSON.stringify(
	{ score, unit: "kg CO2 eq", relative_difference_vs_brightway: Math.abs(score - expected) / Math.abs(expected) },
	null,
	2,
)}\n`;
if (process.argv[3]) writeFileSync(process.argv[3], out);
else process.stdout.write(out);
