import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import {
	amountText,
	arc,
	bandGeometry,
	fitExtent,
	fmt,
	niceUp,
	parseView,
	pct,
	runText,
	SECTION_SHORT,
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
});

test("the fitted extent rounds the 98th percentile up to a readable step", () => {
	assert.equal(niceUp(0.83), 1);
	assert.equal(niceUp(2.1), 3);
	assert.equal(niceUp(4), 5);
	assert.equal(niceUp(5), 5);
	assert.equal(niceUp(0.06), 0.075);
	const m = fitExtent(meta, base, delta, 0, ALL);
	assert.ok(m > 0 && m <= 100);
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
