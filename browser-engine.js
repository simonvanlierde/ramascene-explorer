// Float64 flows from changes to technical coefficients or final demand.
// Matrix rows come from the data reader; this module has no network or DOM.
// The dense products and the small solve run in engine/ (Rust, built to wasm);
// the caller loads that module before the first scenario.
import { correction, fold } from "./engine/pkg/ramascene_engine.js";

// The export stores float32, so a pivot this close to zero, relative to the
// system's scale, cannot be told apart from a singular system.
const STORED_EPSILON = 2 ** -23;
// H rows read and folded into the flows at once.
const H_BATCH = 256;

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

function transpose(m, rows, columns) {
	const out = new Float64Array(m.length);
	for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) out[j * rows + i] = m[i * columns + j];
	return out;
}

// Browser budgets: bytes downloaded, float64 values held, and multiply-adds.
export const LIMITS = { download: 160 * 1024 ** 2, memory: 256 * 1024 ** 2, work: 1e10 };

// The selected edits and what they cost. Throws before any matrix read when a
// scenario exceeds the browser budgets, so the form can check a selection with
// the catalogue alone (meta: {catalog, products, countries, arrays?}).
export function plan(meta, steps) {
	if (!Array.isArray(steps) || !steps.length || steps.length > 10)
		throw new Error("a scenario needs 1 to 10 interventions");
	const C = meta.countries;
	const F = 2205; // flow totals: 3 indicators × 49 producers × 15 sections
	const edits = steps.map((step) => selection(meta, step)).filter((s) => s.factor !== 1);
	const technical = edits.filter((s) => !s.final);
	const sorted = (list) => [...new Set(list)].sort((a, b) => a - b);
	const rows = sorted(technical.flatMap((s) => s.rows));
	const columns = sorted(technical.flatMap((s) => s.columns));
	const finals = sorted(edits.filter((s) => s.final).flatMap((s) => s.rows));
	const J = sorted([...rows, ...finals]);
	const R = rows.length;
	const K = columns.length;
	const n = Math.min(R, K);
	const work = R * K * n + n ** 3 / 3 + n * n * C + R * K * C + K * finals.length * C + J.length * F * C;
	// Mean stored bytes per row; without them, count rows.
	const size = (name) => meta.arrays?.[name]?.chunk_bytes ?? 1;
	// L[K, J] from K rows of L or J columns, whichever is less to fetch.
	const byRows = !R || K * size("L") <= J.length * size("LC");
	const download = R * size("A") + (R ? (byRows ? K * size("L") : J.length * size("LC")) : 0) + J.length * size("H");
	// Reserve all working copies: ΔA and T, each also copied into the kernel, with S
	// and its LU there; X₀[K,:] and its kernel copy; the solve's right side, solution,
	// row-swap scratch and W, with W's copy back to JavaScript; final demand; the L
	// transpose; and the first H batch while later batches load.
	const memory =
		8 *
		(4 * R * K +
			(byRows ? 1 : 2) * K * J.length +
			2 * n * n +
			2 * K * C +
			(R <= K ? 4 * R : 2 * K + 3 * R) * C +
			Math.max(R, K) +
			2 * finals.length * C +
			J.length * C +
			F * C +
			Math.min(J.length, 2 * H_BATCH) * F);
	if (work > LIMITS.work || memory > LIMITS.memory || (meta.arrays && download > LIMITS.download)) {
		const one = steps.length === 1 && edits.length === 1;
		const detail = one ? ` (${edits[0].products} products × ${edits[0].origins} producing countries)` : "";
		throw new Error(
			`too broad to compute in the browser: it changes ${J.length.toLocaleString("en")} product–country pairs${detail}. Choose a narrower product, fewer producing countries, or fewer industries or regions that use it.`,
		);
	}
	return { edits, technical, rows, columns, finals, J, byRows, download };
}

// Flows for the changed economy, indicator × producer × section × consumer, flat.
// X' = X₀ + L[:,R] W with W = (I − ΔA L[K,R])⁻¹ ΔA X₀[K,:] = ΔA (I − L[K,R] ΔA)⁻¹ X₀[K,:],
// solved in whichever form is smaller. X₀ = X + L[:,F] ΔY for final-demand rows F.
// The flows are G X' for the page's grouping G, and H[j] = (G L[:,j])ᵀ, so
// flows' = flows + Σⱼ H[j] ⊗ Z[j] with Z = ΔY on F plus W on R.
// ΔA = A' − A on the selected rows and columns, in place, so no copy of A stays
// alive. Each step scales a block of rows × columns; masks find the steps per cell.
function change(a, technical, rows, columns) {
	const K = columns.length;
	const rowAt = new Map(rows.map((r, i) => [r, i]));
	const columnAt = new Map(columns.map((c, i) => [c, i]));
	const masks = technical.map((s) => {
		const inRow = new Uint8Array(rows.length);
		const inColumn = new Uint8Array(K);
		for (const r of s.rows) inRow[rowAt.get(r)] = 1;
		for (const c of s.columns) inColumn[columnAt.get(c)] = 1;
		return { factor: s.factor, inRow, inColumn };
	});
	for (let r = 0; r < rows.length; r++)
		for (let k = 0; k < K; k++) {
			let f = 1;
			for (const m of masks) if (m.inRow[r] && m.inColumn[k]) f *= m.factor;
			a[r * K + k] *= f - 1;
		}
	return a;
}

export async function scenarioFlows(data, steps) {
	const { meta, baseline, read } = data;
	const C = meta.countries;
	const { edits, technical, rows, columns, finals, J, byRows } = plan(meta, steps);
	const R = rows.length;
	const K = columns.length;
	const out = Float64Array.from(baseline);
	const F = out.length / C;
	const position = new Map(J.map((j, i) => [j, i]));
	const Z = new Float64Array(J.length * C);
	// Every read starts now, so their round trips overlap.
	const W = J.length;
	const technicalReads = R
		? Promise.all([
				read("A", rows, columns),
				byRows ? read("L", columns, J) : read("LC", J, columns).then((lc) => transpose(lc, W, K)),
				read("X", columns),
			])
		: null;
	const firstH = read("H", J.slice(0, H_BATCH));
	// A failure surfaces where each read is awaited, not as an unhandled rejection.
	for (const pending of [technicalReads, firstH]) pending?.catch(() => {});
	const demand = await read("Y", finals);
	const before = Float64Array.from(demand);
	const finalAt = new Map(finals.map((r, i) => [r, i]));
	for (const s of edits.filter((s) => s.final))
		for (const r of s.rows) for (const c of s.columns) demand[finalAt.get(r) * C + c] *= s.factor;
	for (const [r, i] of finalAt)
		for (let c = 0; c < C; c++) Z[position.get(r) * C + c] = demand[i * C + c] - before[i * C + c];
	if (R) {
		const [original, l, x] = await technicalReads;
		const delta = change(original, technical, rows, columns);
		// X₀[K,:] includes the final-demand changes.
		for (const r of finals) {
			const j = position.get(r);
			for (let k = 0; k < K; k++) {
				const v = l[k * W + j];
				if (v) for (let c = 0; c < C; c++) x[k * C + c] += v * Z[j * C + c];
			}
		}
		// T = L[K,R], K × R
		const T = new Float64Array(K * R);
		for (let k = 0; k < K; k++) for (let r = 0; r < R; r++) T[k * R + r] = l[k * W + position.get(rows[r])];
		const w = correction(delta, T, x, R, K, C, STORED_EPSILON);
		for (let r = 0; r < R; r++) {
			const j = position.get(rows[r]);
			for (let c = 0; c < C; c++) Z[j * C + c] += w[r * C + c];
		}
	}
	for (let start = 0; start < J.length; start += H_BATCH) {
		const batch = J.slice(start, start + H_BATCH);
		const h = await (start ? read("H", batch) : firstH);
		fold(out, h, Z.subarray(start * C, (start + batch.length) * C), F, C);
	}
	if (!out.every(Number.isFinite)) throw new Error("non-finite scenario output");
	return out;
}
