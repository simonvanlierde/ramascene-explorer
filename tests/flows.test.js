import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import {
	amountShort,
	amountText,
	arc,
	bandGeometry,
	changeArm,
	continents,
	fitExtent,
	flowPct,
	fmt,
	niceUp,
	parseView,
	pct,
	runText,
	SECTION_SHORT,
	share,
	sankeyLayout,
	summarise,
	viewSearch,
} from "../flows.js";

const path = (p) => new URL(p, import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(path("./fixture.json"), "utf8"));
const src = await openEmbodied(await asyncBufferFromFile(path("./fixture-embodied.parquet")));
const { meta } = src;
const base = await readRun(src, "baseline");
const delta = await readRun(src, "steel-europe-50");
const mixedRun = await readRun(src, "cement-asia-pacific-20");
const ALL = new Set(SECTION_SHORT.keys());
const DE = meta.country_codes.indexOf("DE");
const sel = (over) => ({ ind: 0, id: 5, who: DE, dir: "in", on: ALL, ...over });
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test("numbers keep three figures, a true minus and no exponent", () => {
	assert.equal(fmt(1001.4), "1,001");
	assert.equal(fmt(42.37), "42.4");
	assert.equal(fmt(-7.834), "−7.83");
	assert.equal(fmt(0.0004), "0.0004");
	assert.equal(pct(-0.78), "−0.78%");
	assert.equal(pct(-0.012), "−0.012%");
	assert.equal(pct(12.4), "+12%");
	assert.equal(amountText(52_300_000, 3), "52.3 million jobs");
	assert.equal(amountText(1234, 3), "1.23 thousand jobs");
	assert.equal(amountText(104, 5), "104 Mt CO₂-eq");
});

test("the selection sums its partners and sections; the two directions read the matrix both ways", () => {
	const s = summarise(meta, base, null, sel());
	assert.ok(
		close(
			s.total,
			s.vals.reduce((a, b) => a + b, 0),
		),
	);
	assert.ok(
		close(
			s.total,
			s.sec.reduce((a, b) => a + b, 0),
		),
	);
	assert.equal(s.dv, null);
	// Germany's consumption drawing on France is France's release for Germany
	const fr = meta.country_codes.indexOf("FR");
	const out = summarise(meta, base, null, sel({ who: fr, dir: "out" }));
	assert.ok(close(s.vals[fr], out.vals[DE]));
	// one section: the total shrinks to that section's row of the rail
	const one = summarise(meta, base, null, sel({ on: new Set([3]) }));
	assert.ok(close(one.total, s.sec[3]));
	assert.deepEqual(one.sec, s.sec);
	// bands: partners only, largest first, at most 18
	assert.ok(!s.bands.includes(DE));
	assert.ok(s.bands.length <= 18);
	for (let i = 1; i < s.bands.length; i++) assert.ok(s.vals[s.bands[i - 1]] >= s.vals[s.bands[i]]);
});

test("a run's change follows the section filter too", () => {
	const all = summarise(meta, base, delta, sel());
	const some = summarise(meta, base, delta, sel({ on: new Set([0, 3]) }));
	assert.ok(all.dTotal < 0);
	assert.ok(some.dTotal > all.dTotal);
	assert.ok(
		close(
			all.dTotal,
			all.dv.reduce((a, b) => a + b, 0),
		),
	);
	assert.equal(all.changed, [...all.dv.keys()].sort((a, b) => all.dv[a] - all.dv[b])[0]);
	assert.notEqual(all.changedAbroad, DE);
	assert.ok(Math.abs(all.dv[all.changedAbroad]) <= Math.abs(all.dv[all.changed]));
});

test("the fitted extent rounds the largest change on screen up to a readable step", () => {
	assert.equal(niceUp(0.83), 1);
	assert.equal(niceUp(2.1), 3);
	assert.equal(niceUp(4), 5);
	assert.equal(niceUp(5), 5);
	assert.equal(niceUp(0.06), 0.075);
	const sum = summarise(meta, base, delta, sel());
	const m = fitExtent(sum);
	const shown = sum.others.filter((k) => sum.vals[k] >= sum.total * 1e-3).map((k) => Math.abs(flowPct(sum, k)));
	shown.sort((a, b) => a - b);
	assert.ok(m >= shown[Math.floor(0.9 * (shown.length - 1))] && m <= niceUp(shown.at(-1)));
});

test("bands taper along the flow: thin where it leaves, wide where it arrives", () => {
	const B = [400, 200];
	const lines = [
		{ k: 1, v: 10, P: arc([100, 300], B) },
		{ k: 2, v: 5, P: arc([700, 260], B) },
	];
	for (const dir of ["in", "out"]) {
		const { R, bands } = bandGeometry(lines, B, { k: 1, dir });
		assert.ok(R >= 6);
		for (const b of bands) {
			const [partnerEnd, collarEnd] = [b.widths[0], b.widths.at(-1)];
			// in: the partner releases, the selected country consumes
			if (dir === "in") assert.ok(partnerEnd < collarEnd / 3, `${dir}: ${partnerEnd} vs ${collarEnd}`);
			else assert.ok(collarEnd < partnerEnd / 3, `${dir}: ${partnerEnd} vs ${collarEnd}`);
			assert.ok(Math.max(...b.widths) <= b.v + 1e-9);
			assert.match(b.d, /^M[\d.,L-]+Z$/);
		}
	}
	// a partner inside the collar gets no band; its fill shows it
	const { bands } = bandGeometry([{ k: 3, v: 50, P: arc([405, 205], B) }, ...lines], B, { k: 1, dir: "in" });
	assert.deepEqual(bands.map((b) => b.k).sort(), [1, 2]);
});

test("the Sankey carries the whole selection through each column", () => {
	for (const dir of ["in", "out"]) {
		const s = sel({ dir, on: new Set([0, 3, 4, 8]) });
		const sum = summarise(meta, base, null, s);
		const lay = sankeyLayout(meta, sum, s);
		const first = lay.links.filter((l) => lay.left.some((n) => n.name === l.from));
		const second = lay.links.filter((l) => lay.right.some((n) => n.name === l.to));
		assert.ok(
			close(
				first.reduce((a, l) => a + l.v, 0),
				sum.total,
			),
			dir,
		);
		assert.ok(
			close(
				second.reduce((a, l) => a + l.v, 0),
				sum.total,
			),
			dir,
		);
		assert.ok(lay.mid.every((m) => s.on.has(m.q)));
		assert.ok(lay.left.length + lay.right.length <= 11);
	}
});

test("plain-language run text, named and grid", () => {
	assert.equal(runText(fixture, "cement-in-construction"), "builders everywhere used 20% less cement");
	assert.match(runText(fixture, "steel-europe-50"), /^every industry in Europe used 50% less /);
});

test("the view round-trips through the query string, old links included", () => {
	const opts = { runs: meta.runs, indicators: [5, 3, 7], codes: meta.country_codes };
	const v = parseView("", opts);
	assert.equal(v.mode, "flows");
	assert.equal(meta.country_codes[v.who], "DE");
	assert.equal(v.on.size, 15);
	assert.equal(viewSearch(v, meta.country_codes), "");
	const w = {
		...v,
		mode: "whatif",
		run: "steel-europe-50",
		indicator: 3,
		who: 30,
		dir: "out",
		on: new Set([4, 3]),
		globe: true,
		panel: "table",
	};
	const q = viewSearch(w, meta.country_codes, "?data=tests/fixture.json");
	assert.match(q, /sections=3,4/);
	assert.match(q, /data=tests/);
	assert.deepEqual(parseView(q, opts), w);
	// the first version's links: ?scenario=&indicator=&region=
	const old = parseView("?scenario=cement-in-construction&indicator=7&region=FR", opts);
	assert.equal(old.run, "cement-in-construction");
	assert.equal(old.indicator, 7);
	assert.equal(meta.country_codes[old.who], "FR");
	// anything unknown falls back
	const bad = parseView("?scenario=nope&indicator=99&region=XX&sections=99,a&panel=x", opts);
	assert.equal(bad.run, meta.runs[1]);
	assert.equal(bad.indicator, 5);
	assert.equal(bad.on.size, 15);
	assert.equal(bad.panel, null);
});

test("the five continents split the selection, so their changes add up to the sentence's", () => {
	for (const dir of ["in", "out"]) {
		const sum = summarise(meta, base, delta, sel({ dir, on: new Set([0, 3]) }));
		const rows = continents(meta, sum);
		assert.ok(
			close(
				rows.reduce((a, r) => a + r.base, 0),
				sum.total,
			),
			dir,
		);
		assert.ok(
			close(
				rows.reduce((a, r) => a + r.change, 0),
				sum.dTotal,
			),
			dir,
		);
	}
});

// Released in each continent, over every consumer: the run's continental
// totals in results.json, from the same embodied flows.
const REAL = path("../data/embodied.parquet");
test("the shipped flows reproduce the run's continental results", {
	skip: !existsSync(REAL) && !process.env.CI && "no data/embodied.parquet",
}, async () => {
	const results = JSON.parse(readFileSync(path("../data/results.json"), "utf8"));
	const real = await openEmbodied(await asyncBufferFromFile(REAL));
	const b = await readRun(real, "baseline");
	const d = await readRun(real, "cement-in-construction");
	real.meta.indicators.forEach((ind, i) => {
		for (const [name, members] of Object.entries(real.meta.aggregates)) {
			let got = 0;
			let gotBase = 0;
			for (const country of members) {
				const who = real.meta.countries.indexOf(country);
				const sum = summarise(real.meta, b, d, { ind: i, id: ind.id, who, dir: "out", on: ALL });
				gotBase += sum.total;
				got += sum.dTotal;
			}
			const f = { 5: 1e-9, 3: 1e3, 7: 1e-3 }[ind.id];
			const want = results.results.baseline[String(ind.id)][name] * f;
			const change = results.results["cement-in-construction"][String(ind.id)][name] * f - want;
			assert.ok(Math.abs(gotBase - want) <= Math.abs(want) * 1e-5, `${ind.id} ${name} base`);
			// float32 changes: relative to the baseline they are about 1e-7 exact
			assert.ok(Math.abs(got - change) <= Math.abs(want) * 1e-6 + 1e-9, `${ind.id} ${name}: ${got} vs ${change}`);
		}
	});
});

test("a share that is not zero never reads as 0%", () => {
	assert.equal(share(0.34, 100), "<1%");
	assert.equal(share(0, 100), "0%");
	assert.equal(share(12.4, 100), "12%");
});

test("short units fit the legend and the map labels", () => {
	assert.equal(amountShort(42.37, 5), "42.4 Mt");
	assert.equal(amountShort(7_660_000, 3), "7.66M jobs");
	assert.equal(amountShort(965_000, 3), "965k jobs");
	assert.equal(amountShort(12, 7), "12.0 Mt");
});

test("the matrix is read the right way round: a consumer draws on itself and three producers", () => {
	// the fixture generator gives each consumer exactly four producers
	const into = summarise(meta, base, null, sel({ dir: "in" }));
	assert.equal([...into.vals].filter((v) => v > 0).length, 4);
	// read the other way, a producer serves however many consumers drew on it
	const counts = meta.country_codes.map(
		(_, k) => [...summarise(meta, base, null, sel({ who: k, dir: "out" })).vals].filter((v) => v > 0).length,
	);
	assert.ok(counts.some((c) => c !== 4));
});

test("the legend arm follows the sign of the changes on screen", () => {
	assert.equal(changeArm(summarise(meta, base, delta, sel())), -1);
	// in the mixed run, flows released in Asia-Pacific rise and the rest fall
	const arms = meta.country_codes.map((_, k) => changeArm(summarise(meta, base, mixedRun, sel({ who: k }))));
	assert.ok(arms.includes(0));
	assert.ok(arms.includes(-1));
	const up = Float64Array.from(delta, (v) => -v);
	assert.equal(changeArm(summarise(meta, base, up, sel())), 1);
});

test("a run that leaves the selection unchanged names no largest change", () => {
	const none = summarise(meta, base, new Float64Array(base.length), sel());
	assert.equal(none.changed, null);
	assert.equal(none.changedAbroad, null);
	assert.equal(none.dTotal, 0);
	// a steel cut in Europe leaves flows released elsewhere for Europe alone
	const local = summarise(meta, base, delta, sel({ who: meta.country_codes.indexOf("US"), dir: "out" }));
	assert.equal(local.changed, null);
});

test("numbers never take exponent notation or float noise", () => {
	assert.equal(fmt(6e-7), "0.0000006");
	assert.equal(fmt(99.96), "100");
	assert.equal(fmt(9.996), "10.0");
	assert.equal(niceUp(0.29), 0.3);
	assert.equal(niceUp(0.13), 0.15);
	assert.equal(niceUp(6e-6), 7.5e-6);
});

test("a link from the first version opens its run in What if…", () => {
	const opts = { runs: meta.runs, indicators: [5, 3, 7], codes: meta.country_codes };
	assert.equal(parseView("?scenario=steel-europe-50", opts).mode, "whatif");
	assert.equal(parseView("?scenario=steel-europe-50&mode=flows", opts).mode, "flows");
	assert.equal(parseView("?scenario=nope", opts).mode, "flows");
});
