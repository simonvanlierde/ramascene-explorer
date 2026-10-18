import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied } from "../embodied.js";
import { REST_OF, regionForIso } from "../map.js";

const path = (p) => new URL(p, import.meta.url).pathname;
const topo = JSON.parse(readFileSync(path("../geo/countries-110m.topo.json"), "utf8"));
const features = topo.objects.countries.geometries.map((g) => g.properties);
// the region codes as the page reads them, from the Parquet footer
const { meta } = await openEmbodied(await asyncBufferFromFile(path("./fixture-embodied.parquet")));
const codes = meta.country_codes;

test("the footer has the 49 EXIOBASE regions over the five aggregates", () => {
	assert.equal(codes.length, 49);
	assert.equal(new Set(codes).size, 49);
	const counts = Object.fromEntries(Object.entries(meta.aggregates).map(([a, list]) => [a, list.length]));
	// as db.sqlite3 leaf_children_local lists them
	assert.deepEqual(counts, {
		Europe: 32,
		"Middle-East": 2,
		America: 5,
		"Asia-Pacific": 8,
		Africa: 2,
	});
});

test("every drawn country maps to a region, except the one it names as unassigned", () => {
	const unassigned = features.filter((f) => regionForIso(f.iso, codes) === null).map((f) => f.name);
	assert.deepEqual(unassigned, ["N. Cyprus"]);
	// every region but Malta (too small for 1:110m) is drawn
	const drawn = new Set(features.map((f) => regionForIso(f.iso, codes)));
	assert.deepEqual(
		codes.filter((c) => !drawn.has(c)),
		["MT"],
	);
});

test("a named country is itself, a rest-of country its aggregate", () => {
	assert.equal(regionForIso("DE", codes), "DE");
	assert.equal(regionForIso("GB", codes), "GB");
	assert.equal(regionForIso("UA", codes), "WE");
	assert.equal(regionForIso("IR", codes), "WM");
	assert.equal(regionForIso("NZ", codes), "WA");
	assert.equal(regionForIso(null, codes), null);
	// no country is in two rest-of lists, and none is a named region
	const listed = Object.values(REST_OF).flatMap((l) => l.split(" "));
	assert.equal(new Set(listed).size, listed.length);
	assert.ok(listed.every((iso) => !codes.includes(iso)));
	// the five rest-of aggregates are the footer's
	assert.ok(Object.keys(REST_OF).every((c) => codes.includes(c)));
});
