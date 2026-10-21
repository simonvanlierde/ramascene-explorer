import assert from "node:assert/strict";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import {
	amountText,
	capitalise,
	changeArm,
	flowPct,
	flowsCsv,
	fmt,
	niceUp,
	parseView,
	pct,
	possessive,
	runText,
	SECTION_SHORT,
	share,
	summarise,
	tableRows,
} from "../flows.js";

const opts = { runs: ["baseline", "a"], indicators: [5], codes: ["DE", "FR"] };
const zoom = (z) => parseView(`?zoom=${z}`, opts).zoom;

test("fmt switches step exactly where rounding would move a value up", () => {
	assert.equal(fmt(99.95), "100");
	assert.equal(fmt(99.94), "99.9");
	assert.equal(fmt(9.995), "10.0");
	assert.equal(fmt(9.99), "9.99");
	assert.equal(fmt(0.00995), "0.01");
	assert.equal(fmt(0.004), "0.004");
	assert.equal(fmt(-1234.5), "−1,235");
	assert.equal(fmt(-1e-9), "−0.000000001");
});

test("pct and share keep their step edges and never read a real change as zero", () => {
	assert.equal(pct(0), "0.000%");
	assert.equal(pct(10), "+10%");
	assert.equal(pct(-9.9), "−9.9%");
	assert.equal(pct(1), "+1.0%");
	assert.equal(pct(0.1), "+0.10%");
	assert.equal(pct(0.05), "+0.050%");
	assert.equal(share(1, 200), "1%");
	assert.equal(share(1, 201), "<1%");
	assert.equal(share(0, 5), "0%");
	assert.equal(share(1, 0), "0%");
});

test("amounts step up to thousand and million jobs at the exact edge", () => {
	assert.equal(amountText(999, 3), "999 jobs");
	assert.equal(amountText(1e3, 3), "1.00 thousand jobs");
	assert.equal(amountText(1e6, 3), "1.00 million jobs");
	assert.equal(amountText(-1e6, 3), "−1.00 million jobs");
});

test("small text helpers", () => {
	assert.equal(possessive("Netherlands"), "’");
	assert.equal(possessive("Germany"), "’s");
	assert.equal(capitalise("steel use"), "Steel use");
	assert.equal(capitalise(""), "");
	assert.equal(niceUp(1), 1);
	assert.equal(niceUp(7.5), 7.5);
	assert.equal(niceUp(0), 1);
	assert.equal(niceUp(-3), 1);
});

test("flowPct needs a run and a flow above a millionth of the total", () => {
	const sum = { vals: [2e-6, 1e-6, 4], total: 1, dv: [1e-6, 1e-6, -1] };
	assert.equal(flowPct(sum, 0), 50);
	assert.equal(flowPct(sum, 1), null);
	assert.equal(flowPct({ ...sum, dv: null }, 0), null);
});

test("changeArm: zero change counts for either arm", () => {
	const arm = (dv) => changeArm({ others: [0, 1], vals: [1, 1], total: 2, dv });
	assert.equal(arm([0, 0]), -1);
	assert.equal(arm([0, -1]), -1);
	assert.equal(arm([0, 1]), 1);
	assert.equal(arm([1, -1]), 0);
});

test("the zoom link accepts exactly the documented range", () => {
	assert.equal(zoom("1"), null);
	assert.deepEqual(zoom("8"), [8]);
	assert.equal(zoom("8.1"), null);
	assert.deepEqual(zoom("2,180,90"), [2, 180, 90]);
	assert.deepEqual(zoom("2,-180,-90"), [2, -180, -90]);
	assert.equal(zoom("2,181,0"), null);
	assert.equal(zoom("2,0,91"), null);
	assert.equal(zoom("2,3"), null);
	assert.equal(zoom(""), null);
});

test("the sections link keeps whole numbers below the section count and nothing else", () => {
	const on = (s) => [...parseView(`?sections=${s}`, opts).on];
	const last = SECTION_SHORT.length - 1;
	assert.deepEqual(on(`${last}`), [last]);
	assert.equal(on(`${last + 1}`).length, SECTION_SHORT.length);
	assert.equal(on("1x").length, SECTION_SHORT.length);
	assert.equal(on("x1").length, SECTION_SHORT.length);
	assert.equal(on("-1").length, SECTION_SHORT.length);
	assert.deepEqual(on(",3,"), [3]);
});

test("the CSV unit follows the indicator: Mt, jobs and thousand jobs", () => {
	const m = { countries: ["A", "B"], country_codes: ["A", "B"] };
	const data = { data_kind: "exiobase-v3", base_year: 2011 };
	const csv = (id, v) => {
		const vals = Float64Array.from(v);
		const sum = { vals, total: v[0] + v[1], dv: null, cell: (k, q) => (q === 3 ? vals[k] : 0) };
		return flowsCsv(m, sum, { id, who: 0, dir: "in", on: new Set([3]) }, { data }).text.split("\r\n");
	};
	assert.equal(csv(7, [3, 1])[0], "region_code,region_name,flow_mt,share_pct,largest_section");
	assert.equal(csv(7, [3, 1])[1], "A,A,3,75,Manufacturing");
	assert.equal(csv(3, [300, 100])[0], "region_code,region_name,flow_jobs,share_pct,largest_section");
	assert.equal(csv(3, [3e3, 1e3])[0], "region_code,region_name,flow_thousand_jobs,share_pct,largest_section");
	assert.equal(csv(3, [3e3, 1e3])[1], "A,A,3,75,Manufacturing");
});

test("runText falls back to the label, then the id, and names the grid's product and region", () => {
	const data = {
		scenarios: [
			{ id: "plain", label: "A plain run" },
			{ id: "g1", grid: { product: "steel", region: "middle-east", cut: -30 } },
			{ id: "g2", grid: { product: "cement", region: "america", cut: 10 } },
			{ id: "g3", grid: { product: "glass", region: "xx", cut: -5 } },
		],
		grid: {
			products: [
				{ slug: "steel", short: "Steel" },
				{ slug: "cement", short: "Cement" },
			],
			regions: [
				{ slug: "middle-east", name: "Middle-East" },
				{ slug: "america", name: "America" },
			],
		},
	};
	assert.equal(runText(data, "missing"), "missing");
	assert.equal(runText(data, "plain"), "A plain run");
	assert.equal(runText(data, "g1"), "every industry in the Middle East used 30% less steel");
	assert.equal(runText(data, "g2"), "every industry in the Americas used 10% less cement");
	assert.equal(runText(data, "g3"), "every industry in xx used 5% less glass");
});

test("a run adds the change and its percentage to each CSV row", () => {
	const m = { countries: ["A", "B"], country_codes: ["A", "B"] };
	const vals = Float64Array.from([300, 100]);
	const dv = Float64Array.from([-30, 20]);
	const sum = { vals, dv, total: 400, cell: (k, q) => (q === 3 ? vals[k] : 0) };
	const s = { id: 3, who: 0, dir: "in", on: new Set([3]) };
	const data = { data_kind: "exiobase-v3", base_year: 2011 };
	const rows = flowsCsv(m, sum, s, { data, run: "r" }).text.trimEnd().split("\r\n");
	assert.equal(rows[0], "region_code,region_name,flow_jobs,share_pct,largest_section,change_jobs,change_pct");
	assert.equal(rows[1], "A,A,300,75,Manufacturing,-30,-10");
	assert.equal(rows[2], "B,B,100,25,Manufacturing,20,20");
	// a run id without a change in the sum gives no change columns
	assert.equal(
		flowsCsv(m, { ...sum, dv: null }, s, { data, run: "r" })
			.text.split("\r\n")[0]
			.split(",").length,
		5,
	);
});

test("the table names each partner's largest section among those shown", () => {
	const m = { countries: ["A", "B"] };
	const cells = { "0,1": 5, "0,2": 7, "0,3": 9, "1,1": 4, "1,2": 2 };
	const sum = { vals: [21, 6], total: 27, dv: null, cell: (k, q) => cells[`${k},${q}`] ?? 0 };
	const rows = tableRows(m, sum, new Set([1, 2, 3]));
	assert.deepEqual(
		rows.map((r) => r.ts),
		[3, 1],
	);
	assert.deepEqual(
		tableRows(m, sum, new Set([1, 2])).map((r) => r.ts),
		[2, 1],
	);
});

test("summarise keeps every section's total, drops tiny bands and lists partners largest first", async () => {
	const src = await openEmbodied(
		await asyncBufferFromFile(new URL("./fixture-embodied.parquet", import.meta.url).pathname),
	);
	const base = await readRun(src, "baseline");
	const who = src.meta.country_codes.indexOf("DE");
	const sel = { ind: 0, id: 5, who, dir: "in", on: new Set([3]) };
	const sum = summarise(src.meta, base, null, sel);
	const all = summarise(src.meta, base, null, { ...sel, on: new Set(SECTION_SHORT.keys()) });
	assert.deepEqual([...sum.sec], [...all.sec]);
	assert.ok(sum.sec[0] > 0 && sum.total < sum.sec.reduce((a, b) => a + b, 0));
	assert.ok(!sum.others.includes(who));
	assert.ok(sum.others.every((k, i) => i === 0 || sum.vals[sum.others[i - 1]] >= sum.vals[k]));
	const floor = (sum.total - sum.home) * 0.008;
	assert.ok(sum.bands.length <= 18 && sum.bands.every((k) => sum.vals[k] >= floor));
	assert.deepEqual(sum.bands, sum.others.filter((k) => sum.vals[k] >= floor).slice(0, 18));
	assert.equal(sum.dv, null);
	assert.equal(sum.dTotal, 0);
	assert.deepEqual(sum.changed, null);
});
