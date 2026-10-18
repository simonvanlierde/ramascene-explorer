import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import { flowsCsv, SECTION_SHORT, summarise, tableRows } from "../flows.js";

const path = (p) => new URL(p, import.meta.url).pathname;
const data = JSON.parse(readFileSync(path("./fixture.json"), "utf8"));
const src = await openEmbodied(await asyncBufferFromFile(path("./fixture-embodied.parquet")));
const { meta } = src;
const base = await readRun(src, "baseline");
const delta = await readRun(src, "cement-in-construction");
const ALL = new Set(SECTION_SHORT.keys());
const DE = meta.country_codes.indexOf("DE");
const sel = { ind: 0, id: 5, who: DE, dir: "in", on: ALL };
const parse = (text) =>
	text
		.trimEnd()
		.split("\r\n")
		.map((l) => l.split(","));

test("the CSV holds the table's rows in the display unit, with the basis in its name", () => {
	const sum = summarise(meta, base, null, sel);
	const { name, text } = flowsCsv(meta, sum, sel, { data });
	assert.equal(name, "ramascene-synthetic-2011-DE-ghg-consumption-all-sections.csv");
	assert.ok(text.endsWith("\r\n"));
	const [head, ...rows] = parse(text);
	assert.deepEqual(head, ["region_code", "region_name", "flow_mt_co2eq", "share_pct", "largest_section"]);
	assert.equal(rows.length, tableRows(meta, sum, ALL).length);
	const total = rows.reduce((a, r) => a + Number(r[2]), 0);
	// the table leaves out partners under a millionth of the total
	assert.ok(Math.abs(total - sum.total) <= sum.total * 1e-4);
	assert.ok(rows.every((r) => !/[\s,]/.test(r[2]) && Number.isFinite(Number(r[2]))));
	// largest first, as the table opens
	assert.ok(rows.every((r, i) => i === 0 || Number(rows[i - 1][2]) >= Number(r[2])));
});

test("What if… adds the change columns and the run to the name", () => {
	const sum = summarise(meta, base, delta, sel);
	const run = "cement-in-construction";
	const { name, text } = flowsCsv(meta, sum, sel, { data, run });
	assert.equal(name, `ramascene-synthetic-2011-DE-ghg-consumption-all-sections-whatif-${run}.csv`);
	const [head, ...rows] = parse(text);
	assert.deepEqual(head.slice(5), ["change_mt_co2eq", "change_pct"]);
	assert.ok(rows.every((r) => r.length === 7));
	const change = rows.reduce((a, r) => a + Number(r[5]), 0);
	assert.ok(Math.abs(change - sum.dTotal) <= Math.abs(sum.dTotal) * 1e-3 + 1e-12);
	// without a run the same sum gives no change columns
	assert.equal(parse(flowsCsv(meta, summarise(meta, base, null, sel), sel, { data }).text)[0].length, 5);
});

test("names with a comma are quoted, jobs scale to the table's unit, and sections and direction name the file", () => {
	const tiny = { countries: ["Korea, Republic of", 'The "Rest"'], country_codes: ["KR", "WX"] };
	const vals = new Float64Array([3e6, 1e6]);
	const sum = { vals, total: 4e6, dv: null, cell: (k, q) => (q === 3 ? vals[k] : 0) };
	const s = { id: 3, who: 0, dir: "out", on: new Set([3, 5]) };
	const { name, text } = flowsCsv(tiny, sum, s, { data: { data_kind: "exiobase-v3", base_year: 2011 } });
	assert.equal(name, "ramascene-2011-KR-employment-production-manufacturing-construction.csv");
	assert.equal(
		text,
		"region_code,region_name,flow_million_jobs,share_pct,largest_section\r\n" +
			'KR,"Korea, Republic of",3,75,Manufacturing\r\n' +
			'WX,"The ""Rest""",1,25,Manufacturing\r\n',
	);
});
