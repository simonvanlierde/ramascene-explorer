import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { plan, scenarioFlows } from "../browser-engine.js";
import "./engine-wasm.js";

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

// Reads rows (and some columns) of in-memory matrices, as the store reader does.
function memory(matrices, log = []) {
	return async (name, rows, columns) => {
		log.push([name, rows.length]);
		const m = matrices[name];
		const cols = columns ?? m[0].map((_, j) => j);
		const out = new Float64Array(rows.length * cols.length);
		rows.forEach((r, i) => {
			cols.forEach((c, j) => {
				out[i * cols.length + j] = m[r][c];
			});
		});
		return out;
	};
}

// Two products in one country, with a known inverse. H = Lᵀ and the baseline
// flows are X, so the flows are X' itself. The oracle solves I − A' directly.
function tiny(a, b, c, d, arrays) {
	const det = (1 - a) * (1 - d) - b * c;
	const A = [
		[a, b],
		[c, d],
	];
	const L = [
		[(1 - d) / det, b / det],
		[c / det, (1 - a) / det],
	];
	const LT = [
		[L[0][0], L[1][0]],
		[L[0][1], L[1][1]],
	];
	const X = L.map((row) => [row[0] * 2 + row[1] * 3]);
	const catalog = {
		products: [
			{ id: 10, leaves: [0] },
			{ id: 11, leaves: [1] },
			{ id: 12, leaves: [0, 1] },
		],
		regions: [{ id: 1, leaves: [0] }],
		consumers: [
			{ id: 20, leaves: [0] },
			{ id: 21, leaves: [1] },
			{ id: 22, leaves: [0, 1] },
			{ id: 30, final: true, leaves: [0] },
		],
	};
	const log = [];
	return {
		log,
		meta: { products: 2, countries: 1, catalog, arrays },
		baseline: Float64Array.from(X.flat()),
		read: memory({ A, L, LC: LT, H: LT, X, Y: [[2], [3]] }, log),
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
// Planner byte costs that send L[K, J] through rows of L or through its columns.
const viaRows = undefined;
const viaColumns = { A: { chunk_bytes: 1 }, L: { chunk_bytes: 100 }, LC: { chunk_bytes: 1 }, H: { chunk_bytes: 1 } };

// Solves (I − A') X' = Y' for the 2 × 2 economy.
function direct([[a, b], [c, d]], y = [2, 3]) {
	const det = (1 - a) * (1 - d) - b * c;
	return [((1 - d) * y[0] + b * y[1]) / det, (c * y[0] + (1 - a) * y[1]) / det];
}

test("Woodbury and final demand changes agree with a direct solve, in both forms and both L layouts", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.double({ min: 0.01, max: 0.2, noNaN: true }), { minLength: 4, maxLength: 4 }),
			fc.double({ min: -100, max: 100, noNaN: true }),
			fc.constantFrom(viaRows, viaColumns),
			async ([a, b, c, d], change, arrays) => {
				const f = 1 + change / 100;
				const final = step({ consumedBy: [30], techChange: [-50] });
				const cases = [
					// one row, one column
					[
						[step({ techChange: [change] }), final],
						[
							[a, b * f],
							[c, d],
						],
						[1, 3],
					],
					// two rows into one column: the K × K form
					[
						[step({ product: [12], techChange: [change] })],
						[
							[a, b * f],
							[c, d * f],
						],
						[2, 3],
					],
					// one row into two columns: the R × R form
					[
						[step({ consumedBy: [22], techChange: [change] })],
						[
							[a * f, b * f],
							[c, d],
						],
						[2, 3],
					],
					// final demand on row 0, a technical change on row 1: L's columns follow J, not R
					[
						[step({ product: [11], consumedBy: [20], techChange: [change] }), final],
						[
							[a, b],
							[c * f, d],
						],
						[1, 3],
					],
				];
				for (const [steps, changed, y] of cases) {
					const data = tiny(a, b, c, d, arrays);
					const got = await scenarioFlows(data, steps);
					const want = direct(changed, y);
					got.forEach((v, i) => {
						close(v, want[i]);
					});
				}
			},
		),
		{ numRuns: 100 },
	);
});

test("overlapping edits compose, zero changes return the baseline, and inputs are validated", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	assert.deepEqual(await scenarioFlows(data, [step({ techChange: [0] })]), data.baseline);
	const got = await scenarioFlows(data, [step(), step()]);
	const want = direct([
		[0.1, 0.2 * 0.8 ** 2],
		[0.1, 0.1],
	]);
	got.forEach((v, i) => {
		close(v, want[i]);
	});
	for (const over of [{ product: [999] }, { techChange: [NaN] }, { techChange: [-101] }, { consumedBy: [20, 30] }])
		await assert.rejects(scenarioFlows(data, [step(over)]));
});

test("a change to more than one row uses the full Woodbury system", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const got = await scenarioFlows(data, [step(), step({ product: [11], consumedBy: [20], techChange: [-50] })]);
	const want = direct([
		[0.1, 0.16],
		[0.05, 0.1],
	]);
	got.forEach((v, i) => {
		close(v, want[i]);
	});
});

test("identity cancellation is refused while a nearby change remains valid", async () => {
	const data = tiny(0.092, 0, 0, 0.1);
	await assert.rejects(
		scenarioFlows(data, [step({ consumedBy: [20], techChange: [986.9565217391305] })]),
		/singular or ill-conditioned/,
	);
	const got = await scenarioFlows(data, [step({ consumedBy: [20], techChange: [980] })]);
	close(got[0], 2 / (1 - 0.092 * 10.8));
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
				{ id: 83, leaves: [5, 6] },
				{ id: 17, leaves: Array.from({ length: 17 }, (_, i) => i) },
			],
			regions: [
				{ id: 1, leaves: Array.from({ length: 49 }, (_, i) => i) },
				{ id: 5, leaves: [29, 30, 32, 34, 37, 40, 42, 44] },
				{ id: 2, leaves: Array.from({ length: 32 }, (_, i) => i) },
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
		baseline: new Float64Array(2205 * 49),
		read: async () => {
			reads++;
			throw new Error("matrix read before budget check");
		},
	};
	const broad = { product: [1], originReg: [5], consumedBy: [4], consumedReg: [1], techChange: [-20] };
	const final = meta.catalog.consumers.find((c) => c.final);
	await assert.rejects(
		scenarioFlows(data, [broad]),
		/too broad to compute in the browser: it changes 1,600 product–country pairs \(200 products × 8 producing countries\)\. Choose a narrower product, fewer producing countries, or fewer industries or regions that use it\./,
	);
	// several interventions: the total only, no single product × country count; product 82's
	// 8 rows are inside the broad selection, changed as an input and in final demand: counted once
	await assert.rejects(
		scenarioFlows(data, [{ ...broad, product: [82], consumedBy: [final.id] }, broad]),
		/1,600 product–country pairs\. Choose/,
	);
	// final demand for product 82 from every country: 41 pairs outside the broad selection
	await assert.rejects(
		scenarioFlows(data, [{ ...broad, product: [82], originReg: [1], consumedBy: [final.id] }, broad]),
		/1,641 product–country pairs\. Choose/,
	);
	// the form runs the same check on the catalogue alone
	assert.throws(() => plan(meta, [broad]), /too broad/);
	assert.equal(plan(meta, [{ ...broad, product: [82] }]).rows.length, 8);
	// with byte costs, a selection that fits the arithmetic can exceed the download
	const heavy = { A: { chunk_bytes: 1e8 }, L: { chunk_bytes: 1 }, LC: { chunk_bytes: 1 }, H: { chunk_bytes: 1 } };
	assert.throws(() => plan({ ...meta, arrays: heavy }, [{ ...broad, product: [82] }]), /too broad/);
	// Each edit fits alone. Together, 833 technical rows into 2,720 columns plus
	// 9,800 final-demand rows exceed memory once T and the solver copies are counted.
	const mixed = [
		{ ...broad, product: [17], originReg: [1], consumedReg: [2] },
		{ ...broad, originReg: [1], consumedBy: [final.id] },
	];
	for (const edit of mixed) assert.doesNotThrow(() => plan(meta, [edit]));
	assert.throws(() => plan(meta, mixed), /too broad/);
	await assert.rejects(scenarioFlows(data, mixed), /too broad/);
	assert.equal(reads, 0);
});

test("L comes from whichever layout is smaller, and H is folded in bounded batches", async () => {
	const size = 600;
	const log = [];
	const zeros = Array.from({ length: size }, () => new Array(size).fill(0));
	const identity = zeros.map((row, i) => row.map((_, j) => Number(i === j)));
	const column = Array.from({ length: size }, () => [0]);
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
		baseline: new Float64Array(size),
		read: memory({ A: zeros, L: identity, LC: identity, H: identity, X: column, Y: column }, log),
	};
	assert.deepEqual(await scenarioFlows(data, [step()]), new Float64Array(size));
	// 600 changed rows into one column: one row of L, not 600 columns
	assert.deepEqual(
		log.filter(([name]) => name === "L" || name === "LC"),
		[["L", 1]],
	);
	const batches = log.filter(([name]) => name === "H").map(([, rows]) => rows);
	assert.deepEqual(batches, [256, 256, 88]);
});

test("technical scenarios start A, L and X reads before waiting for any", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const read = data.read;
	const first = Promise.withResolvers();
	const release = Promise.withResolvers();
	const started = new Set();
	data.read = async (name, ...rest) => {
		started.add(name);
		if (name === "A") first.resolve();
		if (name !== "Y") await release.promise;
		return read(name, ...rest);
	};
	const output = scenarioFlows(data, [step()]);
	await first.promise;
	const overlapped = ["A", "L", "X"].every((name) => started.has(name));
	release.resolve();
	await output;
	assert.ok(overlapped, "one matrix waited for another matrix's network reads");
});
