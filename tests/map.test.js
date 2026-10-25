import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied } from "../embodied.js";
import { REST_OF, regionForIso, thinTopology } from "../map.js";

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

test("the thinned topology keeps every arc's ends and stays within the tolerance", () => {
	const tol = 0.2;
	const thin = thinTopology(topo, tol);
	const [sx, sy] = topo.transform.scale;
	const abs = (arc) => {
		const out = [];
		for (const [dx, dy] of arc) {
			const [x, y] = out.at(-1) ?? [0, 0];
			out.push([x + dx, y + dy]);
		}
		return out.map(([x, y]) => [x * sx, y * sy]);
	};
	const before = topo.arcs.reduce((n, a) => n + a.length, 0);
	const after = thin.arcs.reduce((n, a) => n + a.length, 0);
	// over a third of the points go, which is what makes a moving frame cheaper
	assert.ok(after < before * 0.7, `${after} of ${before} points kept`);
	assert.equal(thin.arcs.length, topo.arcs.length);
	assert.deepEqual(thin.objects, topo.objects);
	topo.arcs.forEach((arc, i) => {
		const full = abs(arc);
		const kept = abs(thin.arcs[i]);
		// shared borders still meet: the ends are where neighbouring arcs join
		assert.deepEqual(kept[0], full[0]);
		assert.deepEqual(kept.at(-1), full.at(-1));
		// every dropped point lies within tol of the segment that replaced it
		let k = 0;
		full.forEach((p, n) => {
			const [a, b] = [kept[k], kept[k + 1] ?? kept[k]];
			const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
			const d = L
				? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L
				: Math.hypot(p[0] - a[0], p[1] - a[1]);
			assert.ok(d <= tol + 1e-9, `arc ${i}: a point ${d.toFixed(3)}° off`);
			if (n && p[0] === b[0] && p[1] === b[1]) k++;
		});
	});
});
