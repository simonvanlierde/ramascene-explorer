import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EXIOBASE_REGIONS, REST_OF, regionForIso } from "../map.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const topo = read("../geo/countries-110m.topo.json");
const features = topo.objects.countries.geometries.map((g) => g.properties);

test("the region table has the 49 EXIOBASE regions over the five aggregates", () => {
	assert.equal(EXIOBASE_REGIONS.length, 49);
	assert.equal(new Set(EXIOBASE_REGIONS.map((r) => r.code)).size, 49);
	const counts = {};
	for (const r of EXIOBASE_REGIONS) counts[r.aggregate] = (counts[r.aggregate] ?? 0) + 1;
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
	const unassigned = features.filter((f) => regionForIso(f.iso) === null).map((f) => f.name);
	assert.deepEqual(unassigned, ["N. Cyprus"]);
	// every named region but Malta (too small for 1:110m) is drawn
	const drawn = new Set(features.map((f) => regionForIso(f.iso)));
	const missing = EXIOBASE_REGIONS.filter((r) => !drawn.has(r.code)).map((r) => r.code);
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
	assert.ok(listed.every((iso) => !EXIOBASE_REGIONS.some((r) => r.code === iso)));
});
