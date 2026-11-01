// The agreement table's 1 M EUR of Dutch cement through the browser reader.
// Run: node brightway-check/browser_check.js data/browser-engine [results/browser.json]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { asyncBufferFromFile } from "hyparquet";
import { openEngine } from "../browser-data.js";

const directory = process.argv[2];
if (!directory) throw new Error("pass the exported browser data directory");
const meta = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
const data = await openEngine(meta, (name) =>
	asyncBufferFromFile(`${directory}/${name}-${meta.files[name].sha256}.parquet`),
);
const column = await data.row("L", 4100);
const score = column.reduce((sum, v, i) => sum + data.B[0][i] * v, 0);
const multiplier = await data.row("M", 4);
assert.ok(Math.abs(score - multiplier[4100]) <= 1e-10 * Math.abs(score));
const expected = JSON.parse(readFileSync(new URL("results/lca.json", import.meta.url), "utf8")).brightway;
assert.ok(Math.abs(score - expected) <= 1e-9 * Math.abs(expected));
const out = `${JSON.stringify(
	{ score, unit: "kg CO2 eq", relative_difference_vs_brightway: Math.abs(score - expected) / Math.abs(expected) },
	null,
	2,
)}\n`;
if (process.argv[3]) writeFileSync(process.argv[3], out);
else process.stdout.write(out);
