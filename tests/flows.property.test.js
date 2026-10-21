import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import { continents, flowsCsv, niceUp, parseView, SECTION_SHORT, summarise, viewSearch } from "../flows.js";

// Stryker pins the seed so a mutant is killed or not the same way on every run
if (process.env.FC_SEED) fc.configureGlobal({ seed: Number(process.env.FC_SEED) });

const path = (p) => new URL(p, import.meta.url).pathname;
const src = await openEmbodied(await asyncBufferFromFile(path("./fixture-embodied.parquet")));
const { meta } = src;
const base = await readRun(src, "baseline");
const delta = await readRun(src, "steel-europe-50");
const codes = meta.country_codes;
const named = meta.runs.filter((r) => r !== "baseline");
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// String(-0) is "0", so a -0 coordinate cannot survive a link
const noNegZero = (x) => x + 0;

const sections = fc.subarray([...SECTION_SHORT.keys()], { minLength: 1 }).map((s) => new Set(s));
const zoom = fc.oneof(
	fc.constant(null),
	fc.double({ min: 1.01, max: 8, noNaN: true }).map((k) => [k]),
	fc.tuple(
		fc.double({ min: 1.01, max: 8, noNaN: true }),
		fc.double({ min: -180, max: 180, noNaN: true }).map(noNegZero),
		fc.double({ min: -90, max: 90, noNaN: true }).map(noNegZero),
	),
);
const view = fc.record({
	mode: fc.constantFrom("flows", "whatif"),
	run: fc.constantFrom(...named),
	// the indicator ids are the data's, so any positive ints, with the default 5 among them
	indicator: fc.oneof(fc.constant(5), fc.integer({ min: 1, max: 40 })),
	who: fc.integer({ min: 0, max: codes.length - 1 }),
	dir: fc.constantFrom("in", "out"),
	on: sections,
	globe: fc.boolean(),
	zoom,
	panel: fc.constantFrom(null, "sankey", "table", "method"),
});
// viewSearch leaves indicator 5 out as the default and parseView falls back to the
// first listed indicator, so the page needs 5 first, as the data lists it.
const indicatorsFor = (v) =>
	fc
		.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 8 })
		.map((l) =>
			[5, ...l.filter((x) => x !== 5 && x !== v.indicator), v.indicator].filter((x, i, a) => a.indexOf(x) === i),
		);

test("parseView reads back what viewSearch wrote", () => {
	fc.assert(
		fc.property(
			view.chain((v) => indicatorsFor(v).map((indicators) => [v, indicators])),
			([v, indicators]) => {
				const got = parseView(viewSearch(v, codes), { runs: meta.runs, indicators, codes });
				// a flows view does not name its run, so it reads back as the default one
				assert.deepEqual(got, { ...v, run: v.mode === "whatif" ? v.run : named[0] });
			},
		),
	);
});

test("parseView never throws and stays in range on any query string", () => {
	const opts = { runs: meta.runs, indicators: [5, 3, 7], codes };
	fc.assert(
		fc.property(fc.oneof(fc.string(), fc.webQueryParameters()), (s) => {
			const v = parseView(s, opts);
			assert.ok(["flows", "whatif"].includes(v.mode));
			assert.ok(named.includes(v.run));
			assert.ok(opts.indicators.includes(v.indicator));
			assert.ok(v.who >= 0 && v.who < codes.length);
			assert.ok(v.on.size > 0 && [...v.on].every((q) => q >= 0 && q < SECTION_SHORT.length));
			assert.ok(v.zoom === null || (v.zoom[0] > 1 && v.zoom[0] <= 8));
			assert.ok([null, "sankey", "table", "method"].includes(v.panel));
		}),
	);
});

test("flowsCsv rows split back into their fields, whatever the names hold", () => {
	// RFC 4180 reader for one record per line
	const split = (line) => {
		const out = [];
		let f = "";
		let quoted = false;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (quoted) {
				if (c === '"' && line[i + 1] === '"') {
					f += '"';
					i++;
				} else if (c === '"') quoted = false;
				else f += c;
			} else if (c === '"') quoted = true;
			else if (c === ",") {
				out.push(f);
				f = "";
			} else f += c;
		}
		return [...out, f];
	};
	const name = fc.string({ unit: fc.constantFrom("a", "Z", " ", ",", '"', "é", "-"), minLength: 1, maxLength: 12 });
	fc.assert(
		fc.property(
			fc.uniqueArray(name, { minLength: 1, maxLength: 6 }),
			fc.array(fc.integer({ min: 1, max: 1e6 }), { minLength: 6, maxLength: 6 }),
			(names, v) => {
				const vals = Float64Array.from(names, (_, k) => v[k]);
				const total = vals.reduce((a, b) => a + b, 0);
				const m = { countries: names, country_codes: names.map((_, k) => `C${k}`) };
				const sum = { vals, total, dv: null, cell: (k, q) => (q === 3 ? vals[k] : 0) };
				const { text } = flowsCsv(
					m,
					sum,
					{ id: 3, who: 0, dir: "in", on: new Set([3]) },
					{ data: { data_kind: "exiobase-v3", base_year: 2011 } },
				);
				const [, ...rows] = text.trimEnd().split("\r\n").map(split);
				// a quoted field holds no line break here, so splitting on CRLF is safe
				// the table leaves out partners under a millionth of the total
				assert.deepEqual(rows.map((r) => r[1]).sort(), names.filter((_, k) => vals[k] > total * 1e-6).sort());
				assert.ok(rows.every((r) => r.length === 5));
			},
		),
	);
});

test("niceUp never rounds down", () => {
	fc.assert(fc.property(fc.double({ min: 1e-12, max: 1e12, noNaN: true }), (m) => niceUp(m) >= m * (1 - 1e-12)));
});

test("continent changes add up to the selection's change", () => {
	const ALL = new Set(SECTION_SHORT.keys());
	fc.assert(
		fc.property(
			fc.integer({ min: 0, max: codes.length - 1 }),
			fc.constantFrom("in", "out"),
			sections,
			(who, dir, on) => {
				const sum = summarise(meta, base, delta, { ind: 0, id: 5, who, dir, on: on ?? ALL });
				const rows = continents(meta, sum);
				assert.ok(
					close(
						rows.reduce((a, r) => a + r.change, 0),
						sum.dTotal,
					),
				);
			},
		),
	);
});
