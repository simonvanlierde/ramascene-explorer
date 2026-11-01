import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { plan, scenarioOutput, solve } from "../browser-engine.js";

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

test("identity cancellation is refused while nearby and uniformly small solves remain valid", async () => {
	const data = tiny(0.092, 0, 0, 0.1);
	await assert.rejects(
		scenarioOutput(data, [step({ consumedBy: [20], techChange: [986.9565217391305] })]),
		/singular or ill-conditioned/,
	);
	const got = await scenarioOutput(data, [step({ consumedBy: [20], techChange: [980] })]);
	close(got[0], 2 / (1 - 0.092 * 10.8));
	close(solve([1e-30], [2e-30], 1, 1)[0], 2);
});

test("broad and mixed scenarios are refused before reading any matrix", async () => {
	// Use the shipped catalog: Manufacturing has 85 leaves, not all products.
	const meta = {
		countries: 49,
		products: 200,
		catalog: {
			products: [
				{ id: 1, leaves: Array.from({ length: 200 }, (_, i) => i) },
				{ id: 82, leaves: [5] },
			],
			regions: [
				{ id: 1, leaves: Array.from({ length: 49 }, (_, i) => i) },
				{ id: 5, leaves: [29, 30, 32, 34, 37, 40, 42, 44] },
			],
			consumers: [
				{ id: 4, leaves: Array.from({ length: 85 }, (_, i) => i + 42) },
				{ id: 276, final: true, leaves: [0] },
			],
		},
	};
	let reads = 0;
	const data = {
		meta,
		X: Array.from({ length: 9800 }, () => new Float64Array(49)),
		Y: Array.from({ length: 9800 }, () => new Float64Array(49)),
		row: async () => {
			reads++;
			throw new Error("matrix read before budget check");
		},
	};
	const broad = { product: [1], originReg: [5], consumedBy: [4], consumedReg: [1], techChange: [-20] };
	const final = meta.catalog.consumers.find((c) => c.final);
	await assert.rejects(
		scenarioOutput(data, [broad]),
		/too broad to compute in the browser: it changes 1,600 product–country pairs \(200 products × 8 producing countries\), and the browser handles about 200\./,
	);
	// several interventions: the total only, no single product × country count; product 82's
	// 8 rows are inside the broad selection, changed as an input and in final demand: counted once
	await assert.rejects(
		scenarioOutput(data, [{ ...broad, product: [82], consumedBy: [final.id] }, broad]),
		/1,600 product–country pairs, and/,
	);
	// the form runs the same check on the catalogue alone
	assert.throws(() => plan(meta, [broad]), /too broad/);
	assert.equal(plan(meta, [{ ...broad, product: [82] }]).rows.length, 8);
	assert.equal(reads, 0);
});

test("matrix reads stay bounded and grow linearly across selection sizes", async () => {
	for (const size of [20, 200]) {
		let active = 0;
		let peak = 0;
		let reads = 0;
		const data = {
			meta: {
				products: size,
				countries: 1,
				catalog: {
					products: [{ id: 10, leaves: Array.from({ length: size }, (_, i) => i) }],
					regions: [{ id: 1, leaves: [0] }],
					consumers: [{ id: 21, leaves: [0] }],
				},
			},
			X: Array.from({ length: size }, () => [0]),
			Y: Array.from({ length: size }, () => [0]),
			row: async (name, index) => {
				reads++;
				peak = Math.max(peak, ++active);
				await new Promise((resolve) => setImmediate(resolve));
				active--;
				const row = new Float64Array(size);
				if (name === "L") row[index] = 1;
				return row;
			},
		};
		assert.deepEqual(await scenarioOutput(data, [step()]), new Float64Array(size));
		assert.equal(reads, 2 * size);
		assert.ok(peak <= 64, `started ${peak} matrix reads at once`);
	}
});

test("technical scenarios start both matrices before waiting for either", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const read = data.row;
	const first = Promise.withResolvers();
	const release = Promise.withResolvers();
	const started = new Set();
	data.row = async (name, index) => {
		started.add(name);
		first.resolve();
		await release.promise;
		return read(name, index);
	};
	const output = scenarioOutput(data, [step()]);
	await first.promise;
	const overlapped = started.has("A") && started.has("L");
	release.resolve();
	await output;
	assert.ok(overlapped, "one matrix waited for the other matrix's network reads");
});
