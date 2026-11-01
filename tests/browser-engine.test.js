import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { LIMITS, plan, readKey, scenarioFlows, startReads } from "../browser-engine.js";
import { correction } from "../engine/pkg/ramascene_engine.js";
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

// One product in two countries, so every index that steps by the country count is
// exercised; tiny() has one country. Y's rows are producers, its columns destination
// countries, and the flows are X itself, F = 2 rows by C = 2.
function twoCountries(a, b, c, d, arrays) {
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
	const Y = [
		[2, 1],
		[3, 4],
	];
	const X = L.map((row) => [0, 1].map((k) => row[0] * Y[0][k] + row[1] * Y[1][k]));
	const catalog = {
		products: [{ id: 10, leaves: [0] }],
		regions: [
			{ id: 1, leaves: [0] },
			{ id: 2, leaves: [1] },
			{ id: 3, leaves: [1, 0, 1] },
		],
		consumers: [
			{ id: 20, leaves: [0] },
			{ id: 30, final: true, leaves: [0] },
		],
	};
	return {
		meta: { products: 1, countries: 2, catalog, arrays },
		baseline: Float64Array.from(X.flat()),
		read: memory({ A, L, LC: LT, H: LT, X, Y }),
		Y,
	};
}

test("scenarios across two countries agree with a direct solve per destination country", async () => {
	const at = (over) => ({ product: [10], consumedBy: [20], techChange: [-30], ...over });
	const cut = at({ originReg: [3], consumedBy: [30], consumedReg: [2], techChange: [-50] });
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.double({ min: 0.01, max: 0.2, noNaN: true }), { minLength: 4, maxLength: 4 }),
			fc.constantFrom(viaRows, viaColumns),
			async ([a, b, c, d], arrays) => {
				const f = 0.7;
				const cases = [
					// country 0 buys less from itself for production in country 1, and country 1's final demand halves
					[
						[at({ originReg: [1], consumedReg: [2] }), cut],
						[
							[a, b * f],
							[c, d],
						],
						[1, 0.5],
					],
					// both countries' rows into country 0's column: the K × K form
					[
						[at({ originReg: [3], consumedReg: [1] })],
						[
							[a * f, b],
							[c * f, d],
						],
						[1, 1],
					],
					// country 1's row into both columns: the R × R form
					[
						[at({ originReg: [2], consumedReg: [3] })],
						[
							[a, b],
							[c * f, d * f],
						],
						[1, 1],
					],
				];
				for (const [steps, changed, scale] of cases) {
					const data = twoCountries(a, b, c, d, arrays);
					const got = await scenarioFlows(data, steps);
					for (const k of [0, 1]) {
						const want = direct(changed, [data.Y[0][k] * scale[k], data.Y[1][k] * scale[k]]);
						close(got[k], want[0]);
						close(got[2 + k], want[1]);
					}
				}
			},
		),
		{ numRuns: 30 },
	);
});

test("overlapping edits compose, zero changes return the baseline, and inputs are validated", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	assert.deepEqual(await scenarioFlows(data, [step({ techChange: [0] })]), data.baseline);
	// a 0% step asks for no rows of any matrix
	assert.ok(
		data.log.every(([, rows]) => rows === 0),
		JSON.stringify(data.log),
	);
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

// The smallest LIMITS[name] that plans the steps, with the other limits off. Each
// cost is a whole number here (n³/3 aside, which cancels in the differences below).
function need(name, meta, steps) {
	const saved = { ...LIMITS };
	try {
		Object.assign(LIMITS, { work: Infinity, memory: Infinity, download: Infinity });
		let lo = 0;
		let hi = 2 ** 40;
		while (hi - lo > 1) {
			LIMITS[name] = Math.floor((lo + hi) / 2);
			try {
				plan(meta, steps);
				hi = LIMITS[name];
			} catch {
				lo = LIMITS[name];
			}
		}
		// just over the limit is refused, the limit itself is not
		LIMITS[name] = hi - 1;
		assert.throws(() => plan(meta, steps), /too broad/);
		return hi;
	} finally {
		Object.assign(LIMITS, saved);
	}
}

test("each planner cost term moves its limit by exactly its own size", () => {
	const C = 49;
	const F = 2205;
	const catalog = {
		products: [
			{ id: 82, leaves: [5] },
			{ id: 84, leaves: [7] },
		],
		regions: [
			{ id: 5, leaves: [29, 30, 32, 34, 37, 40, 42, 44] },
			{ id: 9, leaves: [0] },
		],
		consumers: [
			{ id: 4, leaves: Array.from({ length: 85 }, (_, i) => i + 42) },
			{ id: 276, final: true, leaves: [0] },
		],
	};
	const sized = (L, LC, H) => ({
		countries: C,
		products: 200,
		catalog,
		arrays: { A: { chunk_bytes: 10 }, L: { chunk_bytes: L }, LC: { chunk_bytes: LC }, H: { chunk_bytes: H } },
	});
	// 8 rows (one product in 8 countries) into 85 columns (one country's manufacturing)
	const technical = { product: [82], originReg: [5], consumedBy: [4], consumedReg: [9], techChange: [-20] };
	const [R, K, J] = [8, 85, 8];
	// download: R rows of A, K rows of L, and J rows of H
	assert.equal(need("download", sized(1, 1000, 3), [technical]), R * 10 + K * 1 + J * 3);
	// memory: L[K, J] through its columns holds a second copy while it transposes
	assert.equal(
		need("memory", sized(1000, 1, 1), [technical]) - need("memory", sized(1, 1000, 1), [technical]),
		8 * K * J,
	);
	// work: final demand for another 8 rows adds its X₀ update and its H fold
	const demand = { ...technical, product: [84], consumedBy: [276] };
	const f = 8;
	assert.equal(
		need("work", sized(1, 1000, 1), [technical, demand]) - need("work", sized(1, 1000, 1), [technical]),
		K * f * C + f * F * C,
	);
});

test("the whole work and memory estimates, for R below, equal to and above K", () => {
	const catalog = {
		products: [
			{ id: 82, leaves: [5] },
			{ id: 84, leaves: [7] },
			{ id: 85, leaves: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
		],
		regions: [
			{ id: 5, leaves: [29, 30, 32, 34, 37, 40, 42, 44] },
			{ id: 9, leaves: [0] },
		],
		consumers: [
			{ id: 4, leaves: Array.from({ length: 85 }, (_, i) => i + 42) },
			{ id: 3, leaves: [42, 43] },
			{ id: 2, leaves: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49] },
			{ id: 276, final: true, leaves: [0] },
		],
	};
	const meta = { countries: 49, products: 200, catalog };
	const t = { product: [82], originReg: [5], consumedBy: [4], consumedReg: [9], techChange: [-20] };
	// Pinned so a change to the estimate is a deliberate one. The first, by hand
	// (R 8, K 85, J 8, n 8, C 49, F 2,205, L by columns): memory 8 × (2,720 + 1,360 +
	// 128 + 8,330 + 1,568 + 85 + 392 + 108,045 + 17,640) and work 5,440 + 512/3 +
	// 3,136 + 33,320 + 864,360, rounded up.
	const cases = [
		[[t], 906427, 1122144],
		[[{ ...t, product: [85], originReg: [9], consumedBy: [2] }], 1091584, 1073880],
		[[{ ...t, product: [85], consumedBy: [3] }], 8651959, 2411240],
		[[t, { ...t, product: [84], consumedBy: [276] }], 1804107, 1283552],
	];
	for (const [steps, work, bytes] of cases) {
		assert.equal(need("work", meta, steps), work);
		assert.equal(need("memory", meta, steps), bytes);
	}
});

test("invalid selections are refused with a message that names the problem", () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const meta = data.meta;
	const refused = [
		[{ product: [] }, /select at least one id/],
		[{ product: 10 }, /select at least one id/],
		[{ product: [999] }, /unknown id 999/],
		[{ techChange: -20 }, /change must be between -100 and 1000 percent/],
		[{ techChange: [-20, 5] }, /change must be between/],
		[{ techChange: [Infinity] }, /change must be between/],
		[{ techChange: [-100.001] }, /change must be between/],
		[{ techChange: [1000.001] }, /change must be between/],
		[{ consumedBy: [] }, /select a consumer/],
		[{ consumedBy: 21 }, /select a consumer/],
		[{ consumedBy: [999] }, /unknown consumer 999/],
		[{ consumedBy: [30, 20] }, /cannot mix final demand and intermediate consumers/],
	];
	for (const [over, message] of refused) assert.throws(() => plan(meta, [step(over)]), message, JSON.stringify(over));
	for (const change of [-100, 1000]) assert.doesNotThrow(() => plan(meta, [step({ techChange: [change] })]));
	for (const steps of [[], step(), Array(11).fill(step())])
		assert.throws(() => plan(meta, steps), /a scenario needs 1 to 10 interventions/);
	assert.doesNotThrow(() => plan(meta, Array(10).fill(step())));
	// a catalogue leaf must be a whole index below the bound
	for (const leaf of [-1, 0.5, 2])
		assert.throws(
			() => plan({ ...meta, catalog: { ...meta.catalog, products: [{ id: 10, leaves: [leaf] }] } }, [step()]),
			/invalid catalog indices/,
		);
	// repeated and unsorted leaves count once, in order
	const twice = { ...meta, catalog: { ...meta.catalog, products: [{ id: 10, leaves: [1, 0, 1] }] } };
	assert.deepEqual(plan(twice, [step()]).rows, [0, 1]);
	assert.equal(plan(twice, [step()]).edits[0].products, 2);
	// with a second, unchanged step, a refusal gives only the total, not one edit's size
	const saved = LIMITS.work;
	try {
		LIMITS.work = 0;
		assert.throws(() => plan(meta, [step()]), /\(1 products × 1 producing countries\)/);
		assert.throws(() => plan(meta, [step(), step({ techChange: [0] })]), /pairs\. Choose/);
	} finally {
		LIMITS.work = saved;
	}
});

// Shapes off the kernel's 4 × 4 tiles and across its 256-long blocks, in both
// forms and both builds of the small system. Checks (I − ΔA T) W = ΔA X.
test("the wasm correction solves its system at awkward shapes", () => {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647 - 0.5;
	};
	for (const [r, k, c, density] of [
		[1, 1, 1, 1],
		[5, 7, 3, 1],
		[6, 301, 9, 1],
		[6, 301, 9, 0.1],
		[302, 7, 5, 1],
		[301, 263, 6, 1],
	]) {
		const delta = Float64Array.from({ length: r * k }, () => (Math.abs(random()) < density / 2 ? random() / k : 0));
		const t = Float64Array.from({ length: k * r }, () => random() / r);
		const x = Float64Array.from({ length: k * c }, random);
		const w = correction(delta, t, x, r, k, c, 1e-7);
		const dot = (i, j, m, width) => {
			let sum = 0;
			for (let q = 0; q < k; q++) sum += delta[i * k + q] * m[q * width + j];
			return sum;
		};
		const dt = Array.from({ length: r * r }, (_, iq) => dot(Math.floor(iq / r), iq % r, t, r));
		for (let i = 0; i < r; i++)
			for (let j = 0; j < c; j++) {
				let lhs = w[i * c + j];
				for (let q = 0; q < r; q++) lhs -= dt[i * r + q] * w[q * c + j];
				close(lhs, dot(i, j, x, c));
			}
	}
});

test("reads started before Run serve a run with the same slices, and only that run", async () => {
	const data = tiny(0.1, 0.2, 0.1, 0.1);
	const want = await scenarioFlows(data, [step()]);
	// another percentage of the same selection reads the same slices
	const ahead = {
		key: readKey(plan(data.meta, [step({ techChange: [-50] })])),
		reads: startReads(data, plan(data.meta, [step()])),
	};
	const before = data.log.length;
	assert.deepEqual(await scenarioFlows(data, [step()], ahead), want);
	assert.equal(data.log.length, before, "the run read nothing more");
	// a different selection ignores them and reads its own
	const other = await scenarioFlows(data, [step({ consumedBy: [20] })], ahead);
	assert.ok(data.log.length > before);
	assert.ok(other.every(Number.isFinite));
});
