import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	classify,
	decodeTopology,
	divergingExtent,
	EXIOBASE_REGIONS,
	equalEarth,
	legendClasses,
	project,
	REST_OF,
	regionForIso,
	regionValues,
} from "../map.js";

const read = (path) =>
	JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const topo = read("../geo/countries-110m.topo.json");
const features = decodeTopology(topo, "countries");
const fixture = read("./fixture.json");

test("the region table has the 49 EXIOBASE regions over the five aggregates", () => {
	assert.equal(EXIOBASE_REGIONS.length, 49);
	assert.equal(new Set(EXIOBASE_REGIONS.map((r) => r.code)).size, 49);
	const counts = {};
	for (const r of EXIOBASE_REGIONS)
		counts[r.aggregate] = (counts[r.aggregate] ?? 0) + 1;
	// as db.sqlite3 leaf_children_local lists them
	assert.deepEqual(counts, {
		Europe: 32,
		America: 5,
		"Asia-Pacific": 8,
		"Middle-East": 2,
		Africa: 2,
	});
});

test("every drawn country maps to a region, except the one it names as unassigned", () => {
	const unassigned = features
		.filter((f) => regionForIso(f.iso) === null)
		.map((f) => f.name);
	assert.deepEqual(unassigned, ["N. Cyprus"]);
	// every named region but Malta (too small for 1:110m) is drawn
	const drawn = new Set(features.map((f) => regionForIso(f.iso)));
	const missing = EXIOBASE_REGIONS.filter((r) => !drawn.has(r.code)).map(
		(r) => r.code,
	);
	assert.deepEqual(missing, ["MT"]);
});

test("a named country is itself, a rest-of country its aggregate", () => {
	assert.equal(regionForIso("DE"), "DE");
	assert.equal(regionForIso("GB"), "GB");
	assert.equal(regionForIso("UA"), "WE");
	assert.equal(regionForIso("IR"), "WM");
	assert.equal(regionForIso("NZ"), "WA");
	assert.equal(regionForIso(null), null);
	// no country is in two rest-of lists, and none is a named region
	const listed = Object.values(REST_OF).flatMap((l) => l.split(" "));
	assert.equal(new Set(listed).size, listed.length);
	assert.ok(
		listed.every((iso) => !EXIOBASE_REGIONS.some((r) => r.code === iso)),
	);
});

test("Equal Earth puts the origin at 0 and is symmetric", () => {
	assert.deepEqual(equalEarth([0, 0]), [0, 0]);
	const [x, y] = equalEarth([180, 45]);
	const [mx, my] = equalEarth([-180, -45]);
	assert.ok(Math.abs(x + mx) < 1e-12 && Math.abs(y + my) < 1e-12);
	assert.ok(Math.abs(equalEarth([180, 0])[0] - 2.7064) < 1e-3);
});

test("projected paths fit the width and keep the map's aspect", () => {
	const { height, paths } = project(features, 1000);
	assert.equal(paths.length, features.length);
	const xs = paths
		.join("")
		.match(/-?[\d.]+(?=,)/g)
		.map(Number);
	assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 1000);
	assert.ok(height > 400 && height < 520, `height ${height}`);
});

test("five-aggregate results colour every code by its aggregate", () => {
	const state = { scenario: "steel-in-vehicles-europe", indicator: "5" };
	const out = regionValues(fixture, state);
	assert.equal(out.level, "aggregate");
	assert.equal(Object.keys(out.values).length, 49);
	const europe =
		fixture.results[state.scenario]["5"].Europe -
		fixture.results.baseline["5"].Europe;
	assert.equal(out.values.DE.delta, europe);
	assert.equal(out.values.WE.delta, europe);
	assert.equal(out.values.DE.name, "Europe (aggregate)");
});

test("49-region results are read per region, and a missing scenario gives null", () => {
	const names = EXIOBASE_REGIONS.map((r) => r.name);
	const values = (k) =>
		Object.fromEntries(names.map((n, i) => [n, k * (i + 1)]));
	const data = {
		regions: names,
		results: { baseline: { 5: values(10) }, s: { 5: values(9) } },
	};
	const out = regionValues(data, { scenario: "s", indicator: "5" }, 1000);
	assert.equal(out.level, "region");
	assert.equal(out.values.AT.delta, -1000);
	assert.equal(out.values.WM.percent, -10);
	assert.equal(regionValues(data, { scenario: "other", indicator: "5" }), null);
});

test("classes are symmetric around a neutral band and cover the extent", () => {
	assert.equal(divergingExtent([-3.2, 0.4]), 5);
	assert.equal(divergingExtent([-0.013]), 0.02);
	assert.equal(divergingExtent([]), 1);
	assert.equal(classify(0.1, 5), 0);
	assert.equal(classify(-0.3, 5), -1);
	assert.equal(classify(-5, 5), -4);
	assert.equal(classify(2.6, 5), 3);
	assert.equal(classify(null, 5), null);
	const rows = legendClasses(5);
	assert.deepEqual(
		rows.map((r) => r.cls),
		[-4, -3, -2, -1, 0, 1, 2, 3, 4],
	);
	assert.equal(rows[0].from, -5);
	assert.equal(rows.at(-1).to, 5);
	for (const r of rows) assert.equal(classify((r.from + r.to) / 2, 5), r.cls);
});

test("the selected region round-trips through the URL and bad codes are dropped", async () => {
	const { regionParam, withRegion } = await import("../map.js");
	const search = withRegion("?scenario=a&indicator=5", "WF");
	assert.equal(search, "?scenario=a&indicator=5&region=WF");
	assert.equal(regionParam(search), "WF");
	assert.equal(regionParam("?region=XX"), null);
	assert.equal(withRegion(search, null), "?scenario=a&indicator=5");
	assert.equal(withRegion("?region=DE", null), "");
});
