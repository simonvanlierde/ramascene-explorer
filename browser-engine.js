// Float64 output from changes to technical coefficients or final demand.
// Matrix rows come from the data reader; this module has no network or DOM.

// Load both matrices together with at most 64 row decoders in total.
const ROW_BATCH = 32;

export function solve(matrix, rhs, n, columns, referenceScale = 0) {
	if (
		!Number.isInteger(n) ||
		n < 1 ||
		!Number.isInteger(columns) ||
		columns < 1 ||
		matrix.length !== n * n ||
		rhs.length !== n * columns
	)
		throw new Error("invalid solve dimensions");
	if (!matrix.every(Number.isFinite) || !rhs.every(Number.isFinite)) throw new Error("the solve needs finite numbers");
	const a = Float64Array.from(matrix);
	const x = Float64Array.from(rhs);
	const norm = a.reduce((max, v) => Math.max(max, Math.abs(v)), referenceScale);
	for (let k = 0; k < n; k++) {
		let pivot = k;
		for (let i = k + 1; i < n; i++) if (Math.abs(a[i * n + k]) > Math.abs(a[pivot * n + k])) pivot = i;
		if (Math.abs(a[pivot * n + k]) <= Number.EPSILON * norm * n)
			throw new Error("singular or ill-conditioned scenario");
		for (let j = k; j < n; j++) [a[k * n + j], a[pivot * n + j]] = [a[pivot * n + j], a[k * n + j]];
		for (let c = 0; c < columns; c++)
			[x[k * columns + c], x[pivot * columns + c]] = [x[pivot * columns + c], x[k * columns + c]];
		for (let i = k + 1; i < n; i++) {
			const factor = a[i * n + k] / a[k * n + k];
			for (let j = k + 1; j < n; j++) a[i * n + j] -= factor * a[k * n + j];
			for (let c = 0; c < columns; c++) x[i * columns + c] -= factor * x[k * columns + c];
		}
	}
	for (let i = n - 1; i >= 0; i--)
		for (let c = 0; c < columns; c++) {
			for (let j = i + 1; j < n; j++) x[i * columns + c] -= a[i * n + j] * x[j * columns + c];
			x[i * columns + c] /= a[i * n + i];
		}
	if (!x.every(Number.isFinite)) throw new Error("non-finite scenario solution");
	return x;
}

function expand(list, ids, bound) {
	if (!Array.isArray(ids) || !ids.length) throw new Error("select at least one id");
	const leaves = ids.flatMap((id) => {
		const item = list.find((v) => v.id === id);
		if (!item) throw new Error(`unknown id ${id}`);
		return item.leaves;
	});
	if (!leaves.every((v) => Number.isInteger(v) && v >= 0 && v < bound)) throw new Error("invalid catalog indices");
	return [...new Set(leaves)].sort((a, b) => a - b);
}

function selection(meta, step) {
	const catalog = meta.catalog;
	const products = expand(catalog.products, step.product, meta.products);
	const origins = expand(catalog.regions, step.originReg, meta.countries);
	const destinations = expand(catalog.regions, step.consumedReg, meta.countries);
	if (
		!Array.isArray(step.techChange) ||
		step.techChange.length !== 1 ||
		!Number.isFinite(step.techChange[0]) ||
		step.techChange[0] < -100 ||
		step.techChange[0] > 1000
	)
		throw new Error("change must be between -100 and 1000 percent");
	if (!Array.isArray(step.consumedBy) || !step.consumedBy.length) throw new Error("select a consumer");
	const consumers = step.consumedBy.map((id) => {
		const item = catalog.consumers.find((v) => v.id === id);
		if (!item) throw new Error(`unknown consumer ${id}`);
		return item;
	});
	const final = consumers[0].final === true;
	if (consumers.some((v) => (v.final === true) !== final))
		throw new Error("cannot mix final demand and intermediate consumers");
	const indices = (regions, products) => regions.flatMap((r) => products.map((p) => r * meta.products + p));
	return {
		products: products.length,
		origins: origins.length,
		rows: indices(origins, products),
		columns: final ? destinations : indices(destinations, expand(catalog.consumers, step.consumedBy, meta.products)),
		final,
		factor: 1 + step.techChange[0] / 100,
	};
}

// The selected edits and their sizes. Throws before any matrix read when the
// dense update would exceed the browser's work budget, so the form can check a
// selection with the catalogue alone (meta: {catalog, products, countries}).
export function plan(meta, steps) {
	if (!Array.isArray(steps) || !steps.length || steps.length > 10)
		throw new Error("a scenario needs 1 to 10 interventions");
	const C = meta.countries;
	const N = C * meta.products;
	const edits = steps.map((step) => selection(meta, step)).filter((s) => s.factor !== 1);
	const technical = edits.filter((s) => !s.final);
	const rows = [...new Set(technical.flatMap((s) => s.rows))].sort((a, b) => a - b);
	const columns = [...new Set(technical.flatMap((s) => s.columns))].sort((a, b) => a - b);
	const R = rows.length;
	const K = columns.length;
	const finalSet = new Set(edits.filter((s) => s.final).flatMap((s) => s.rows));
	const finalRows = finalSet.size;
	// Bound dense arithmetic and scenario buffers.
	const work = R * R * K + R ** 3 / 3 + R * C * (N + K) + finalRows * N * C;
	const bytes = 8 * (R * N + 2 * R * K + 2 * R * R + 3 * R * C + N * C + 2 * ROW_BATCH * N);
	if (work > 100_000_000 || bytes > 64 * 1024 ** 2) {
		const one = steps.length === 1 && edits.length === 1;
		const size = one ? ` (${edits[0].products} products × ${edits[0].origins} producing countries)` : "";
		// a row edited both as an input and in final demand is one pair
		const pairs = new Set([...rows, ...finalSet]).size;
		throw new Error(
			`too broad to compute in the browser: it changes ${pairs.toLocaleString("en")} product–country pairs${size}. Choose a narrower product, fewer producing countries, or fewer industries or regions that use it.`,
		);
	}
	return { edits, technical, rows, columns, finalRows };
}

// X' = L' Y', country-major products by consuming country, as a flat array.
// For A' = A + U D Vᵀ: L'Y' = LY' + L[:,R](I-D L[C,R])⁻¹ D(LY')[C,:].
export async function scenarioOutput(data, steps) {
	const { meta } = data;
	const C = meta.countries;
	const N = C * meta.products;
	const { edits, technical, rows, columns } = plan(meta, steps);
	const R = rows.length;
	const K = columns.length;
	const output = new Float64Array(N * C);
	if (data.X.length !== N || data.X.some((row) => row.length !== C)) throw new Error("invalid baseline output");
	for (let i = 0; i < N; i++) output.set(data.X[i], i * C);
	if (!output.every(Number.isFinite)) throw new Error("invalid baseline output");
	const demand = new Map();
	for (const s of edits.filter((s) => s.final))
		for (const r of s.rows) {
			if (!demand.has(r)) demand.set(r, Float64Array.from(data.Y[r]));
			for (const c of s.columns) demand.get(r)[c] *= s.factor;
		}
	for (const [r, values] of demand) {
		const column = await data.row("L", r);
		for (let c = 0; c < C; c++) {
			const delta = values[c] - data.Y[r][c];
			if (delta) for (let i = 0; i < N; i++) output[i * C + c] += column[i] * delta;
		}
	}
	if (!R) {
		if (!output.every(Number.isFinite)) throw new Error("non-finite scenario output");
		return output;
	}
	const positions = new Map(rows.map((r, i) => [r, i]));
	const columnPositions = new Map(columns.map((c, i) => [c, i]));
	const original = [];
	const leontief = [];
	// Bound concurrent decoders; retain only the selected A columns.
	for (let offset = 0; offset < R; offset += ROW_BATCH) {
		const batch = rows.slice(offset, offset + ROW_BATCH);
		const [a, l] = await Promise.all([
			Promise.all(
				batch.map(async (r) => {
					const row = await data.row("A", r);
					return Float64Array.from(columns, (c) => row[c]);
				}),
			),
			Promise.all(batch.map((r) => data.row("L", r))),
		]);
		original.push(...a);
		leontief.push(...l);
	}
	const changed = original.map((row) => Float64Array.from(row));
	for (const s of technical)
		for (const r of s.rows) for (const c of s.columns) changed[positions.get(r)][columnPositions.get(c)] *= s.factor;
	for (let r = 0; r < R; r++) for (let j = 0; j < K; j++) changed[r][j] -= original[r][j];
	const S = new Float64Array(R * R);
	const rhs = new Float64Array(R * C);
	let referenceScale = 1;
	for (let r = 0; r < R; r++) {
		S[r * R + r] = 1;
		let rowScale = 1;
		for (let j = 0; j < columns.length; j++) {
			const v = changed[r][j];
			if (!v) continue;
			const col = columns[j];
			for (let k = 0; k < R; k++) {
				const term = v * leontief[k][col];
				S[r * R + k] -= term;
				rowScale += Math.abs(term);
			}
			for (let c = 0; c < C; c++) rhs[r * C + c] += v * output[col * C + c];
		}
		// Compare pivots with the scale before I - D L cancels, not just S.
		referenceScale = Math.max(referenceScale, rowScale);
	}
	const correction = solve(S, rhs, R, C, referenceScale);
	for (let r = 0; r < R; r++)
		for (let i = 0; i < N; i++) for (let c = 0; c < C; c++) output[i * C + c] += leontief[r][i] * correction[r * C + c];
	if (!output.every(Number.isFinite)) throw new Error("non-finite scenario output");
	return output;
}
