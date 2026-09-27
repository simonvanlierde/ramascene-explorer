// Pure logic for the optional "run a custom scenario" panel. The panel exists
// only when the page is opened with ?api=<job API origin>; without it the page
// never contacts anything but its own data file, so the static build stays static.

export const LIVE_STATUS = "computed live by the job API — not precomputed";

// Loopback (a local run, or an SSH tunnel) over http, anything else over https.
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
	const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	const scheme = url.protocol === "https:" || (loopback && url.protocol === "http:");
	const bare = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
	return scheme && bare && (url.pathname === "/" || url.pathname === "") ? url.origin : null;
}

// The ?api= value apiUrl refused, for the status line; null if none was refused.
export function ignoredApi(search) {
	const raw = new URLSearchParams(search).get("api");
	return raw !== null && apiUrl(search) === null ? raw : null;
}

// Form values (strings from <select>/<input>) to a POST /jobs body in the
// explorer's model_details format. Throws on a change that is not a finite number.
export function scenarioBody({ product, originReg, consumedBy, consumedReg, techChange, label }) {
	const change = Number(techChange);
	if (techChange === "" || !Number.isFinite(change)) throw new Error("the change must be a finite number (percent)");
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
