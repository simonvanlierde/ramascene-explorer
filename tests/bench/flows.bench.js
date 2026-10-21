// Benchmarks of what the page computes on every selection: reading a run's
// embodied flows from Parquet, summing a selection, and drawing the map bands,
// the Sankey, the table and the CSV. Inputs are the synthetic fixtures.
// Run with `pnpm bench`; CodSpeed measures them in CI.

import { readFileSync } from "node:fs";
import { geoEqualEarth } from "d3-geo";
import { parquetReadObjects } from "hyparquet";
import { describe, test } from "vitest";
import { dense, openEmbodied, readRun } from "../../embodied.js";
import {
	arc,
	bandGeometry,
	continents,
	flowsCsv,
	SECTION_SHORT,
	sankeyLayout,
	summarise,
	tableRows,
} from "../../flows.js";

const path = (p) => new URL(p, import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(path("../fixture.json"), "utf8"));
// Held in memory, so the benchmarks measure the decoding and not the disk.
const bytes = readFileSync(path("../fixture-embodied.parquet"));
const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const src = await openEmbodied(file);
const { meta } = src;
const base = await readRun(src, "baseline");
const delta = await readRun(src, "steel-europe-50");
const [rowStart, rowEnd] = src.groups[0];
const baselineRows = (
	await parquetReadObjects({
		file,
		metadata: src.metadata,
		rowStart,
		rowEnd,
		columns: ["indicator", "producer", "section", "consumer", "value"],
	})
).map((r) => [r.indicator, r.producer, r.section, r.consumer, r.value]);

// One Vitest 5 benchmark per test, named alike.
const benchmark = (name, fn) =>
	test(name, async ({ bench }) => {
		await bench(name, fn).run();
	});

const ALL = new Set(SECTION_SHORT.keys());
const DE = meta.country_codes.indexOf("DE");
const sel = { ind: 0, id: 5, who: DE, dir: "in", on: ALL };
const sum = summarise(meta, base, delta, sel);

// The flat map's bands for the selection: one projected arc per partner.
const projection = geoEqualEarth().scale(130).translate([350, 200]);
const anchor = (k) => projection([((k * 37) % 340) - 170, ((k * 23) % 120) - 55]);
const B = anchor(DE);
const lines = sum.bands.map((k) => ({ k, v: sum.vals[k], P: arc(anchor(k), B) }));

describe("embodied flows", () => {
	benchmark("openEmbodied: read the Parquet footer", async () => {
		await openEmbodied(file);
	});
	benchmark("readRun: decode one run's row group to a dense array", async () => {
		await readRun(src, "steel-europe-50");
	});
	benchmark("dense: long rows to a dense array", () => {
		dense(meta, baselineRows);
	});
});

describe("selection", () => {
	benchmark("summarise: baseline only", () => {
		summarise(meta, base, null, sel);
	});
	benchmark("summarise: with a run's change, both directions", () => {
		summarise(meta, base, delta, sel);
		summarise(meta, base, delta, { ...sel, dir: "out" });
	});
	benchmark("continents", () => {
		continents(meta, sum);
	});
});

describe("drawing", () => {
	benchmark("bandGeometry: tapered map bands", () => {
		bandGeometry(lines, B, { k: 0.05, dir: "in" });
	});
	benchmark("sankeyLayout", () => {
		sankeyLayout(meta, sum, sel);
	});
	benchmark("tableRows", () => {
		tableRows(meta, sum, sel.on);
	});
	benchmark("flowsCsv", () => {
		flowsCsv(meta, sum, sel, { data: fixture, run: "steel-europe-50" });
	});
});
