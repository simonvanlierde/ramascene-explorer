import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { scenarioOutput, solve } from "../browser-engine.js";

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test("the small solve pivots and leaves its inputs unchanged", () => {
	const a = [0, 2, 1, 3];
	assert.deepEqual([...solve(a, [4, 7], 2, 1)], [1, 2]);
	assert.deepEqual(a, [0, 2, 1, 3]);
	assert.throws(() => solve([1, 2, 2, 4], [1, 2], 2, 1), /singular/);
	assert.throws(() => solve([NaN], [1], 1, 1), /finite/);
});

// Two products in one country, with a known inverse. The test's oracle solves
// I - A directly; the browser path must update the supplied baseline inverse.
function tiny(a, b, c, d) {
	const det = (1 - a) * (1 - d) - b * c;
	const A = [
		[a, b],
		[c, d],
	];
	const L = [
		[(1 - d) / det, b / det],
		[c / det, (1 - a) / det],
	];
	const X = L.map((row) => [row[0] * 2 + row[1] * 3]);
	const catalog = {
		products: [
			{ id: 10, leaves: [0] },
			{ id: 11, leaves: [1] },
		],
		regions: [{ id: 1, leaves: [0] }],
		consumers: [
			{ id: 20, leaves: [0] },
			{ id: 21, leaves: [1] },
			{ id: 30, final: true, leaves: [0] },
		],
	};
	return {
		meta: { products: 2, countries: 1, catalog },
		B: [[4, 5]],
		Y: [[2], [3]],
		X,
		row: async (matrix, index) => Float64Array.from(matrix === "A" ? A[index] : L.map((row) => row[index])),
	};
}
const step = (over = {}) => ({
	product: [10],
	originReg: [1],
	consumedBy: [21],
	consumedReg: [1],
	techChange: [-20],
	...over,
});

test("Woodbury and final demand changes agree with a direct solve", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.double({ min: 0.01, max: 0.2, noNaN: true }), { minLength: 4, maxLength: 4 }),
			fc.double({ min: -100, max: 100, noNaN: true }),
			async ([a, b, c, d], change) => {
				const data = tiny(a, b, c, d);
				const interventions = [step({ techChange: [change] }), step({ consumedBy: [30], techChange: [-50] })];
				const got = await scenarioOutput(data, interventions);
				const want = solve([1 - a, -b * (1 + change / 100), -c, 1 - d], [1, 3], 2, 1);
				got.forEach((v, i) => {
					close(v, want[i]);
				});
				assert.deepEqual(data.Y, [[2], [3]]);
			},
		),
		{ numRuns: 100 },
	);
});

test("overlapping edits compose, zero changes return the baseline, and inputs are validated", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	assert.deepEqual([...(await scenarioOutput(data, [step({ techChange: [0] })]))], data.X.flat());
	const got = await scenarioOutput(data, [step(), step()]);
	const want = solve([0.9, -0.2 * 0.8 ** 2, -0.1, 0.9], [2, 3], 2, 1);
	got.forEach((v, i) => {
		close(v, want[i]);
	});
	for (const over of [{ product: [999] }, { techChange: [NaN] }, { techChange: [-101] }, { consumedBy: [20, 30] }])
		await assert.rejects(scenarioOutput(data, [step(over)]));
});

test("a change to more than one row uses the full Woodbury system", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const got = await scenarioOutput(data, [step(), step({ product: [11], consumedBy: [20], techChange: [-50] })]);
	const want = solve([0.9, -0.16, -0.05, 0.9], [2, 3], 2, 1);
	got.forEach((v, i) => {
		close(v, want[i]);
	});
});
