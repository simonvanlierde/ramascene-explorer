// Float64 output from changes to technical coefficients or final demand.
// Matrix rows come from the data reader; this module has no network or DOM.

export function solve(matrix, rhs, n, columns) {
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
	const norm = a.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
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
		rows: indices(origins, products),
		columns: final ? destinations : indices(destinations, expand(catalog.consumers, step.consumedBy, meta.products)),
		final,
		factor: 1 + step.techChange[0] / 100,
	};
}

// X' = L' Y', country-major products by consuming country, as a flat array.
// For A' = A + U D Vᵀ: L'Y' = LY' + L[:,R](I-D L[C,R])⁻¹ D(LY')[C,:].
export async function scenarioOutput(data, steps) {
	if (!Array.isArray(steps) || !steps.length || steps.length > 10)
		throw new Error("a scenario needs 1 to 10 interventions");
	const { meta } = data;
	const C = meta.countries;
	const N = C * meta.products;
	const edits = steps.map((step) => selection(meta, step)).filter((s) => s.factor !== 1);
	const output = Float64Array.from(data.X.flatMap((row) => Array.from(row)));
	if (output.length !== N * C || !output.every(Number.isFinite)) throw new Error("invalid baseline output");
	const demand = new Map();
	for (const s of edits.filter((s) => s.final))
		for (const r of s.rows) {
			if (!demand.has(r)) demand.set(r, Float64Array.from(data.Y[r]));
			for (const c of s.columns) demand.get(r)[c] *= s.factor;
		}
	if (demand.size > 2000) throw new Error("select at most 2000 final-demand products across regions");
	for (const [r, values] of demand) {
		const column = await data.row("L", r);
		for (let i = 0; i < N; i++) for (let c = 0; c < C; c++) output[i * C + c] += column[i] * (values[c] - data.Y[r][c]);
	}
	const technical = edits.filter((s) => !s.final);
	const rows = [...new Set(technical.flatMap((s) => s.rows))].sort((a, b) => a - b);
	const columns = [...new Set(technical.flatMap((s) => s.columns))].sort((a, b) => a - b);
	const R = rows.length;
	if (R > 2000) throw new Error("select at most 2000 technical-coefficient rows");
	if (!R) {
		if (!output.every(Number.isFinite)) throw new Error("non-finite scenario output");
		return output;
	}
	const positions = new Map(rows.map((r, i) => [r, i]));
	const columnPositions = new Map(columns.map((c, i) => [c, i]));
	const original = await Promise.all(rows.map((r) => data.row("A", r)));
	const changed = original.map((row) => Float64Array.from(columns, (c) => row[c]));
	const leontief = await Promise.all(rows.map((r) => data.row("L", r)));
	for (const s of technical)
		for (const r of s.rows) for (const c of s.columns) changed[positions.get(r)][columnPositions.get(c)] *= s.factor;
	const D = changed.map((row, i) => row.map((v, j) => v - original[i][columns[j]]));
	const S = new Float64Array(R * R);
	const rhs = new Float64Array(R * C);
	for (let r = 0; r < R; r++) {
		S[r * R + r] = 1;
		for (let j = 0; j < columns.length; j++) {
			const v = D[r][j];
			if (!v) continue;
			const col = columns[j];
			for (let k = 0; k < R; k++) S[r * R + k] -= v * leontief[k][col];
			for (let c = 0; c < C; c++) rhs[r * C + c] += v * output[col * C + c];
		}
	}
	const correction = solve(S, rhs, R, C);
	for (let r = 0; r < R; r++)
		for (let i = 0; i < N; i++) for (let c = 0; c < C; c++) output[i * C + c] += leontief[r][i] * correction[r * C + c];
	if (!output.every(Number.isFinite)) throw new Error("non-finite scenario output");
	return output;
}
