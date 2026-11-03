// Pure logic for the page: data location, banner, run matching, the grid
// pickers, and the comparison the live panel uses. Units and number formats
// live in flows.js.

const DEFAULT_DATA = "data/results.json";
// Relative path segments of word characters, dots and dashes, ending in .json.
const SAFE_DATA = /^[\w-]+(\/[\w.-]+)*\.json$/;

export function dataUrl(search) {
	const path = new URLSearchParams(search).get("data");
	return path && SAFE_DATA.test(path) && !path.split("/").includes("..") ? path : DEFAULT_DATA;
}

// The ?data= value dataUrl refused, for the status line; null if none was refused.
export function ignoredData(search) {
	const path = new URLSearchParams(search).get("data");
	return path !== null && dataUrl(search) !== path ? path : null;
}

// Fail safe: only an explicit "exiobase-v3" escapes the synthetic banner.
export function banner(data) {
	return data.data_kind === "exiobase-v3"
		? { synthetic: false, text: "EXIOBASE v3 · engine output" }
		: { synthetic: true, text: "SYNTHETIC TEST DATA: NOT A RESULT" };
}

// The embodied flows (their Parquet footer) belong next to results.json only if
// one precompute run wrote both: same dataset files, engine commit and
// timestamp. A results.json regenerated without --out-embodied leaves the old
// Parquet behind; it must not be shown as this run's breakdown.
export function sameRun(doc, data) {
	const key = (d) =>
		JSON.stringify([
			d.data_kind,
			d.provenance?.dataset?.sha256,
			d.provenance?.engine?.commit,
			d.provenance?.generated_at,
		]);
	return Boolean(doc) && key(doc) === key(data);
}

// factor converts to the display unit (wording(id).factor in flows.js); percentages are unaffected.
export function compare(data, state, factor = 1) {
	const base = data.results.baseline[state.indicator];
	const scen = data.results[state.scenario][state.indicator];
	return data.regions
		.map((region) => {
			const delta = scen[region] - base[region];
			return {
				region,
				baseline: factor * base[region],
				scenario: factor * scen[region],
				delta: factor * delta,
				percent: base[region] ? (100 * delta) / base[region] : null,
			};
		})
		.sort((a, b) => a.delta - b.delta);
}

// --- material-efficiency grid --------------------------------------------------

export const gridScenarioId = (product, region, cut) => `${product}-${region}-${Math.abs(cut)}`;

// The picker values that show a scenario: a grid cell gives its product,
// region and cut; anything else gives the scenario itself and the first grid
// region and cut as defaults, so switching to the grid lands somewhere.
export function pickerState(data, scenarioId) {
	const scenario = data.scenarios.find((s) => s.id === scenarioId);
	const first = data.scenarios.find((s) => s.grid)?.grid;
	if (scenario?.grid) {
		return {
			scenario: `grid:${scenario.grid.product}`,
			region: scenario.grid.region,
			cut: String(scenario.grid.cut),
		};
	}
	return {
		scenario: scenarioId,
		region: first?.region ?? "",
		cut: first ? String(first.cut) : "",
	};
}

// What the pickers point at: {id} for a published scenario, {failed} with the
// recorded reason for an excluded one, {missing: true} for a cell never run.
export function lookupGrid(data, picker) {
	if (!picker.scenario.startsWith("grid:")) return { id: picker.scenario };
	const id = gridScenarioId(picker.scenario.slice(5), picker.region, Number(picker.cut));
	if (data.results[id]) return { id };
	const failed = (data.failed ?? []).find((f) => f.id === id);
	return failed ? { id, failed: failed.reason } : { id, missing: true };
}

const fmtSeconds = (s) => `${s.toFixed(1)} s`;
const fmtGiB = (b) => `${(b / 2 ** 30).toFixed(2)} GiB`;

// One line on the run: counts, wall and peak RSS, from provenance.run.
export function runSummary(run) {
	if (!run) return "";
	const parts = [
		`${run.scenarios_run} scenarios run, ${run.passed} passed every check, ${run.failed} failed (excluded)`,
	];
	if (run.wall_s)
		parts.push(`wall time per scenario job median ${fmtSeconds(run.wall_s.median)}, max ${fmtSeconds(run.wall_s.max)}`);
	if (run.peak_rss_bytes)
		parts.push(
			`peak RSS per worker median ${fmtGiB(run.peak_rss_bytes.median)}, max ${fmtGiB(run.peak_rss_bytes.max)}`,
		);
	return parts.join(" · ");
}

// A full 40-character commit hash shortened to 12; anything else as recorded.
export const shortCommit = (commit) => (/^[0-9a-f]{40}$/.test(String(commit)) ? commit.slice(0, 12) : String(commit));
