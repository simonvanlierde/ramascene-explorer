// Shared custom-scenario logic for the browser worker and optional job API.

import { at, cells } from "./embodied.js";
import { LOCALE, msg } from "./messages.js";

export const LIVE_STATUS = msg.live.status;
// The change the job API accepts, in percent. GET /catalog states it as
// tech_change_percent; these are its values, for a job API that does not.
export const CHANGE_RANGE = { min: -100, max: 1000 };
export const minus = (n) => String(n).replace("-", "−");

// The URL in ?<key>=, or null unless it is loopback (a local run, or an SSH tunnel) over http or
// anything else over https, with no query, fragment or credentials. Not [::1]: the job API only
// allows the 127.0.0.1 and localhost hosts. A trailing "?" or "#" counts as a query or fragment.
export function serverUrl(search, key) {
	const raw = new URLSearchParams(search).get(key);
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
	const scheme = url.protocol === "https:" || (loopback && url.protocol === "http:");
	const bare = url.username === "" && url.password === "" && !/[?#]/.test(raw);
	return scheme && bare ? url : null;
}

// The job API's origin: a bare origin, no path.
export function apiUrl(search) {
	const url = serverUrl(search, "api");
	return url && (url.pathname === "/" || url.pathname === "") ? url.origin : null;
}

// The ?api= value apiUrl refused, for the status line; null if none was refused.
export function ignoredApi(search) {
	const raw = new URLSearchParams(search).get("api");
	return raw !== null && apiUrl(search) === null ? raw : null;
}

// Status line when GET /catalog fails. fetch rejects with a TypeError when nothing
// answers (no tunnel, laptop offline); anything else is the API's own error.
export function unreachableMessage(api, error) {
	if (error instanceof TypeError) {
		return msg.live.offline(api);
	}
	return msg.live.apiError(api, error.message);
}

// Form levers (strings from <select>/<input>) to a POST /jobs body in the
// explorer's model_details format, one entry per lever. Throws on no lever, or a change
// that is not a finite number or is outside range ({min, max} in percent, the job API's).
export function scenarioBody(levers, range = CHANGE_RANGE) {
	if (!levers.length) throw new Error(msg.live.noChange);
	const id = (v) => {
		const n = Number(v);
		if (!Number.isInteger(n)) throw new Error(`not an id: ${v}`);
		return [n];
	};
	const step = ({ product, originReg, consumedBy, consumedReg, techChange }) => {
		const change = Number(techChange);
		if (techChange === "" || !Number.isFinite(change)) throw new Error(msg.live.notFinite);
		if (change < range.min || change > range.max)
			throw new Error(msg.live.outOfRange(minus(range.min), minus(range.max)));
		return {
			product: id(product),
			originReg: id(originReg),
			consumedBy: id(consumedBy),
			consumedReg: id(consumedReg),
			techChange: [change],
		};
	};
	return {
		label: "custom scenario",
		model_details: levers.map((lever, n) => {
			try {
				return step(lever);
			} catch (e) {
				// the form's 1-based number, so the message names the change to fix
				throw new Error(msg.live.inChange(n + 1, e.message));
			}
		}),
	};
}

// A succeeded job, reshaped like data/results.json so compare() and the rest
// of explorer.js work on it unchanged. Its own baseline, computed in the same
// job, is the reference: never the precomputed one.
export function liveData(job, status = LIVE_STATUS) {
	const r = job.result;
	return {
		data_kind: "exiobase-v3",
		status,
		base_year: r.provenance.dataset.year,
		regions: r.regions,
		indicators: r.indicators,
		scenarios: [
			{ id: "baseline", label: "Baseline", model_details: null },
			{ id: "live", label: job.scenario.label, model_details: job.scenario.model_details },
		],
		results: { baseline: r.results.baseline, live: r.results.scenario },
	};
}

// [term, description] rows for the provenance list, as the precomputed panel
// lists them, plus what only a live job has: duration and the job id.
export function liveProvenance(job, apiOrigin) {
	const p = job.result.provenance;
	const e = p.engine;
	const d = p.dataset;
	const v = job.result.reference_validation;
	const gib = (b) => `${(b / 2 ** 30).toFixed(2)} GiB`;
	return [
		[msg.terms.status, LIVE_STATUS],
		[msg.terms.jobApi, msg.live.jobApi(apiOrigin, job.id)],
		[
			msg.terms.engine,
			`${e.branch ?? msg.detached} · ${e.commit ?? msg.live.unknown}${e.dirty ? msg.uncommitted : ""}`,
		],
		[msg.terms.dataset, msg.live.dataset(d)],
		[msg.terms.referenceCheck, v ? msg.live.reference(v) : msg.live.noReference],
		[msg.terms.parameters, job.scenario.model_details.map((s) => JSON.stringify(s)).join("\n")],
		[msg.terms.computed, `${job.started_at} → ${job.finished_at} (${job.duration_s.toFixed(1)} s)`],
		[msg.terms.runtime, msg.runtime({ ...p, rss: gib(job.peak_rss_bytes) })],
	];
}

// Keep the catalogue names in the form; hide the engine's category prefixes.
export function catalogName(item) {
	if (item?.final || item?.name === "Y: Final Consumption") return msg.live.finalDemand;
	const name = item?.name.replace(/^[A-Z]: /, "");
	return msg.live.shortNames[name] ?? name;
}

// The catalogue lists each level in turn (sections, divisions, then products;
// world, continents, then countries). Nest each item under the smallest earlier
// item holding all its leaves (on a tie, the later, deeper one) and sort
// siblings by name, Final demand first. Without leaves (the job API's
// catalogue), keep its order, flat.
export function catalogTree(items = []) {
	if (!items.every((v) => Array.isArray(v.leaves))) return items.map((item) => ({ item, depth: 0, parent: null }));
	const sets = items.map((v) => new Set(v.leaves));
	const parent = items.map((v, i) => {
		let best = -1;
		if (!v.final)
			for (let j = 0; j < i; j++)
				if (
					!items[j].final &&
					sets[j].size >= v.leaves.length &&
					(best < 0 || sets[j].size <= sets[best].size) &&
					v.leaves.every((l) => sets[j].has(l))
				)
					best = j;
		return best;
	});
	const children = items.map(() => []);
	const roots = [];
	for (const [i, p] of parent.entries()) (p < 0 ? roots : children[p]).push(i);
	const order = (a, b) =>
		Number(items[b].final === true) - Number(items[a].final === true) ||
		catalogName(items[a]).localeCompare(catalogName(items[b]), LOCALE);
	const out = [];
	const walk = (i, depth) => {
		out.push({ item: items[i], depth, parent: parent[i] < 0 ? null : items[parent[i]].id });
		for (const c of children[i].sort(order)) walk(c, depth + 1);
	};
	for (const r of roots.sort(order)) walk(r, 0);
	return out;
}

// The items whose short or full name contains the query, with their ancestors
// for context; match marks the items that matched themselves.
// The product and region catalogs both call their root "Total"; the pickers name what it holds.
// liveText still reads the catalog itself, where "Total" means no regional scope.
export const rootNamed = (items = [], name) => items.map((v) => (v.name === "Total" ? { ...v, name } : v));

export function filterTree(tree, query) {
	const q = query.trim().toLowerCase();
	if (!q) return tree;
	const byId = new Map(tree.map((n) => [n.item.id, n]));
	const matched = new Set(
		tree.filter((n) => `${catalogName(n.item)} ${n.item.name}`.toLowerCase().includes(q)).map((n) => n.item.id),
	);
	const keep = new Set();
	for (const id of matched)
		for (let n = byId.get(id); n && !keep.has(n.item.id); n = byId.get(n.parent)) keep.add(n.item.id);
	return tree.filter((n) => keep.has(n.item.id)).map((n) => ({ ...n, match: matched.has(n.item.id) }));
}

// One clause per lever, each retaining both regional scopes.
export const liveClauses = (job, catalog) => job.scenario.model_details.map((step) => leverText(step, catalog));

// The "if …" clause of the headline: the changes' own words for one or two, a count for more,
// so ten changes do not fill a phone's first screen. liveClauses lists them in full.
export function liveText(job, catalog) {
	const clauses = liveClauses(job, catalog);
	return clauses.length <= 2
		? new Intl.ListFormat(LOCALE, { type: "conjunction" }).format(clauses)
		: msg.live.manyChanges(clauses.length);
}

// The job API's 422 text names a change as model_details.3 or model_details[3] (0-based); the form says "change 4".
export const formChange = (text) =>
	text.replace(/model_details(?:\.(\d+)|\[(\d+)\])/g, (_, a, b) => msg.live.change(Number(a ?? b) + 1));

function leverText(step, catalog) {
	const item = (list, [id]) => catalog?.[list]?.find((x) => x.id === id);
	const name = (list, ids) => catalogName(item(list, ids)) ?? `#${ids[0]}`;
	const where = (prefix, ids) => (name("regions", ids) === "Total" ? "" : `${prefix}${name("regions", ids)}`);
	const change = step.techChange[0];
	const product = name("products", step.product).toLowerCase();
	const origin = where(msg.live.from, step.originReg);
	const by = step.consumedBy;
	if (by.length === 1 && catalogName(item("consumers", by)) === msg.live.finalDemand)
		return msg.live.demandClause(where(msg.live.in, step.consumedReg), product, origin, change);
	// sections 1 to 15 are every industry (the Ask panel's "All industries"); else each one by name
	const all = by.length === 15 && by.every((id, i) => id === i + 1);
	const users = all
		? msg.live.allIndustries
		: new Intl.ListFormat(LOCALE).format(by.map((id) => name("consumers", [id])));
	return msg.live.inputClause(users, where(msg.live.in, step.consumedReg), product, origin, change);
}

// A job's flows as the page's {base, delta}: dense arrays in meta's layout, the
// job's own baseline and its scenario minus that baseline. The job sends both
// absolute, row-major (indicator, producer, section, consumer), indicators in
// result.indicators order, already in each indicator's unit: unlike the Parquet
// that dense() reads, there is no `scale` to apply. null when the job has no flows
// (an older job API); throws when they do not fit meta's countries, sections or
// indicators, or a value is not a finite number.
export function liveFlows(job, meta) {
	const f = job.result.flows;
	if (!f) return null;
	const N = meta.countries.length;
	const S = meta.sections.length;
	const ids = job.result.indicators.map((i) => i.id);
	const [I, P, Q, C] = f.shape;
	if (
		P !== N ||
		Q !== S ||
		C !== N ||
		I !== ids.length ||
		f.baseline.length !== I * P * Q * C ||
		f.scenario.length !== I * P * Q * C
	)
		throw new Error(`the job's flows are ${f.shape.join(" × ")}, the page's ${ids.length} × ${N} × ${S} × ${N}`);
	const base = new Float64Array(cells(meta, meta.indicators.length));
	const delta = new Float64Array(base.length);
	meta.indicators.forEach((ind, k) => {
		const j = ids.indexOf(ind.id);
		if (j < 0) throw new Error(`the job has no flows for indicator ${ind.id}`);
		for (let p = 0; p < P; p++)
			for (let s = 0; s < Q; s++)
				for (let c = 0; c < C; c++) {
					// the job API's wire layout, read from its own shape; the page's through at()
					const from = ((j * P + p) * Q + s) * C + c;
					const to = at(meta, k, p, s, c);
					const [b, x] = [f.baseline[from], f.scenario[from]];
					if (!Number.isFinite(b) || !Number.isFinite(x))
						throw new Error(`the job's flows hold a value that is not a number: ${b}, ${x}`);
					base[to] = b;
					delta[to] = x - b;
				}
	});
	return { base, delta };
}

// The page's words for a run from the job API: the status line, and the heading
// and note above its provenance rows.
const JOB_SOURCE = {
	status: LIVE_STATUS,
	// the trust pill: the page's checks cover the precomputed runs only
	pill: msg.live.pill,
	heading: msg.live.heading,
	note: msg.live.note,
};

// A finished job as a run the page shows: {run, base, delta, live: {source, text,
// rows}}, text being its "if …" clause. null when the job has no flows; throws
// as liveFlows does.
export function jobRun(job, meta, apiOrigin, text) {
	const flows = liveFlows(job, meta);
	if (!flows) return null;
	return {
		run: `live-${job.id}`,
		...flows,
		live: { source: JOB_SOURCE, text, rows: liveProvenance(job, apiOrigin), job },
	};
}

// Poll GET /jobs/{id} until it leaves queued/running. One failed poll (a tunnel blip) does not
// abandon a job that is still running: only `retries` failures in a row, or the signal, stop it.
// fetchJson is injected for tests.
export async function waitForJob(
	fetchJson,
	url,
	{ interval = 2000, timeout = 30 * 60 * 1000, retries = 3, signal, onUpdate } = {},
) {
	const deadline = Date.now() + timeout;
	let failures = 0;
	for (;;) {
		signal?.throwIfAborted();
		let job;
		try {
			job = await fetchJson(url);
			failures = 0;
		} catch (e) {
			if (signal?.aborted || ++failures >= retries) throw e;
		}
		if (job) {
			onUpdate?.(job);
			if (job.status === "succeeded" || job.status === "failed") return job;
			if (Date.now() > deadline) throw new Error(msg.live.stillRunning(job.status, timeout / 1000));
		}
		// the wait ends early on abort, so Cancel takes effect at once
		await new Promise((resolve) => {
			const abort = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(() => {
				signal?.removeEventListener("abort", abort);
				resolve();
			}, interval);
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
}
