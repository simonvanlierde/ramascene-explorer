// Pure logic for the optional "run a custom scenario" panel. The panel exists
// only when the page is opened with ?api=<job API origin>; without it the page
// never contacts anything but its own data file, so the static build stays static.

import { at, cells } from "./embodied.js";

export const LIVE_STATUS = "computed live by the job API, not precomputed";
// The change the job API accepts, in percent. GET /catalog states it as
// tech_change_percent; these are its values, for a job API that does not.
export const CHANGE_RANGE = { min: -100, max: 1000 };
export const minus = (n) => String(n).replace("-", "−");

// Loopback (a local run, or an SSH tunnel) over http, anything else over https.
// Not [::1]: the job API only allows the 127.0.0.1 and localhost hosts.
// A bare origin: no path, query, fragment or credentials.
export function apiUrl(search) {
	const raw = new URLSearchParams(search).get("api");
	if (!raw) return null;
	let url;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
	const scheme = url.protocol === "https:" || (loopback && url.protocol === "http:");
	const bare = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
	return scheme && bare && (url.pathname === "/" || url.pathname === "") ? url.origin : null;
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
		return `Live job API not reachable (offline): nothing answers at ${api}. The precomputed runs are unaffected.`;
	}
	return `Job API at ${api} answered with an error: ${error.message}`;
}

// Form values (strings from <select>/<input>) to a POST /jobs body in the
// explorer's model_details format. Throws on a change that is not a finite number,
// or outside range ({min, max} in percent, the job API's).
export function scenarioBody({ product, originReg, consumedBy, consumedReg, techChange, label }, range = CHANGE_RANGE) {
	const change = Number(techChange);
	if (techChange === "" || !Number.isFinite(change)) throw new Error("the change must be a finite number (percent)");
	if (change < range.min || change > range.max)
		throw new Error(`the change must be between ${minus(range.min)} and ${minus(range.max)} percent`);
	const id = (v) => {
		const n = Number(v);
		if (!Number.isInteger(n)) throw new Error(`not an id: ${v}`);
		return [n];
	};
	return {
		label: label || "custom scenario",
		model_details: [
			{
				product: id(product),
				originReg: id(originReg),
				consumedBy: id(consumedBy),
				consumedReg: id(consumedReg),
				techChange: [change],
			},
		],
	};
}

// A succeeded job, reshaped like data/results.json so compare() and the rest
// of explorer.js work on it unchanged. Its own baseline, computed in the same
// job, is the reference: never the precomputed one.
export function liveData(job) {
	const r = job.result;
	return {
		data_kind: "exiobase-v3",
		status: LIVE_STATUS,
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
		["Status", LIVE_STATUS],
		["Job API", `${apiOrigin} · job ${job.id}`],
		["Engine", `${e.branch ?? "(detached)"} · ${e.commit ?? "(unknown)"}${e.dirty ? " · uncommitted changes" : ""}`],
		["Dataset", `${d.name} · doi:${d.doi} · EXIOBASE year ${d.year}, files *_${d.file_suffix}.npy`],
		[
			"Reference check",
			v
				? `Octave reference, on this job's matrices: ${v.passed ? "passed" : "not passed"} (${v.values} values, ${v.tolerance})`
				: "not requested for this job (it reproduces only for a 0% change)",
		],
		["Scenario parameters", job.scenario.model_details.map((s) => JSON.stringify(s)).join("\n")],
		["Computed", `${job.started_at} → ${job.finished_at} (${job.duration_s.toFixed(1)} s)`],
		["Runtime", `Python ${p.python} · numpy ${p.numpy} · Django ${p.django} · peak RSS ${gib(job.peak_rss_bytes)}`],
	];
}

// The "if …" clause for a job's first step, in the words of the precomputed runs:
// "Manufacture of motor vehicles in Africa used 20% less motor vehicles from Europe".
// Names come from GET /catalog, without the engine's "S: " sector prefix; the
// region "Total" (everywhere) is left out; an id it does not list is shown as the id.
export function liveText(job, catalog) {
	const step = job.scenario.model_details[0];
	const name = (list, [id]) => (catalog?.[list]?.find((x) => x.id === id)?.name ?? `#${id}`).replace(/^[A-Z]: /, "");
	const where = (prefix, ids) => (name("regions", ids) === "Total" ? "" : `${prefix}${name("regions", ids)}`);
	const change = step.techChange[0];
	const product = name("products", step.product).toLowerCase();
	return `${name("consumers", step.consumedBy)}${where(" in ", step.consumedReg)} used ${Math.abs(change)}% ${change < 0 ? "less" : "more"} ${product}${where(" from ", step.originReg)}`;
}

// A job's flows as the page's {base, delta}: dense arrays in meta's layout, the
// job's own baseline and its scenario minus that baseline. The job sends both
// absolute, row-major (indicator, producer, section, consumer), indicators in
// result.indicators order. null when the job has no flows (an older job API);
// throws when they do not fit meta's countries, sections or indicators.
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
					base[to] = f.baseline[from];
					delta[to] = f.scenario[from] - f.baseline[from];
				}
	});
	return { base, delta };
}

// The page's words for a run from the job API: the status line, and the heading
// and note above its provenance rows.
const JOB_SOURCE = {
	status: LIVE_STATUS,
	// the trust pill: the page's checks cover the precomputed runs only
	pill: "Live job: not checked",
	heading: "This run: computed live",
	note: "The map shows a job the job API computed while you waited, against the baseline from the same job. The checks below cover the precomputed runs, not this one.",
};

// A finished job as a run the page shows: {run, base, delta, live: {source, text,
// rows}}, text being its "if …" clause. null when the job has no flows; throws
// as liveFlows does.
export function jobRun(job, meta, apiOrigin, text) {
	const flows = liveFlows(job, meta);
	if (!flows) return null;
	return { run: `live-${job.id}`, ...flows, live: { source: JOB_SOURCE, text, rows: liveProvenance(job, apiOrigin) } };
}

// Poll GET /jobs/{id} until it leaves queued/running. fetchJson is injected for tests.
export async function waitForJob(fetchJson, url, { interval = 2000, timeout = 30 * 60 * 1000, onUpdate } = {}) {
	const deadline = Date.now() + timeout;
	for (;;) {
		const job = await fetchJson(url);
		onUpdate?.(job);
		if (job.status === "succeeded" || job.status === "failed") return job;
		if (Date.now() > deadline) throw new Error(`job still ${job.status} after ${timeout / 1000} s`);
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
}
