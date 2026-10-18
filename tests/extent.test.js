import assert from "node:assert/strict";
import { test } from "node:test";
import { fitExtent } from "../flows.js";

// A selection with one flow per entry: `pct` is each flow's % change on a
// 2011 flow of `val` (default 100); `total` is the sum, as summarise() makes it.
function selection(pcts, val = 100) {
	const vals = Float64Array.from(pcts, (p) => (Array.isArray(p) ? p[1] : val));
	const dv = Float64Array.from(pcts, (p, k) => ((Array.isArray(p) ? p[0] : p) / 100) * vals[k]);
	return { vals, dv, total: vals.reduce((a, b) => a + b, 0) };
}

const steps = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

test("the extent is the 90th percentile of |% change|, rounded up to a nice number", () => {
	assert.equal(fitExtent(selection(steps)), 5); // p90 = 4.5
	assert.equal(fitExtent(selection(steps.map((p) => p * 2))), 10); // p90 = 9
	assert.equal(fitExtent(selection(steps.map((p) => p / 10))), 0.5); // p90 = 0.45
	assert.equal(fitExtent(selection([3, 3, 3, 3])), 3); // exactly a step stays
});

test("increases and decreases count by size alone", () => {
	assert.equal(fitExtent(selection(steps.map((p, i) => (i % 2 ? -p : p)))), 5);
});

test("one outlier does not set the extent", () => {
	assert.equal(fitExtent(selection([...steps, 1000])), 5);
	assert.equal(fitExtent(selection([...steps, -1000])), 5);
});

test("a tiny flow with a huge % change does not move the extent", () => {
	// three flows of 0.4, each under 0.1% of the total (about 1,001)
	const tiny = [1e6, -1e6, 5e5].map((p) => [p, 0.4]);
	const sum = selection([...steps.map((p) => [p, 100]), ...tiny]);
	assert.ok(sum.vals[10] < sum.total * 1e-3);
	assert.equal(fitExtent(sum), 5);
});

test("nothing to colour gives the unit extent", () => {
	assert.equal(fitExtent(selection([])), 1);
	assert.equal(fitExtent(selection([0, 0, 0])), 1);
	assert.equal(fitExtent({ vals: new Float64Array([5, 5]), dv: null, total: 10 }), 1);
});
