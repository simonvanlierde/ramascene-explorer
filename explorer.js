// Pure logic for the page: data location, banner, run matching, units and
// number formats, the grid pickers, and the comparison the live panel uses.

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

// A sidecar (regions.json, flows.json) belongs next to results.json only if one
// precompute run wrote both: same dataset files, engine commit and timestamp.
// A results.json regenerated without --out-regions/--out-flows leaves the old
// sidecars behind; they must not be shown as this run's breakdown.
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

// factor converts to the display unit (displayIndicator); percentages are unaffected.
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

// Display units: EXIOBASE reports GHG in kg CO2 eq, metal ores in kt and
// employment in thousands of persons. GHG and ores are shown in megatonnes,
// the unit the literature uses at this scale, and employment in persons, so a
// compact "K" never stacks on "1000 p" and reads as a millionfold.
const DISPLAY = {
	"kg CO2 eq": { unit: "Mt CO\u2082-eq", factor: 1e-9 },
	kt: { unit: "Mt", factor: 1e-3 },
	"1000 p": { unit: "persons", factor: 1000 },
};
// Short names for the three indicators of the engine database.
const SHORT = {
	"GHG emissions: Total": "GHG emissions",
	"Employment: Total": "Employment",
	"Domestic Extraction Used - Metal Ores - Total": "Metal ore extraction",
};
export function displayIndicator(indicator) {
	return {
		...indicator,
		short: SHORT[indicator.name] ?? indicator.name,
		...(DISPLAY[indicator.unit] ?? { factor: 1 }),
	};
}

// A display unit is written out in full, grouped (18,800; 6,660; 0.0616).
// Any other unit takes compact notation (3.2B, 450K). Neither ever falls
// back to exponent notation.
const SCALED = new Set(Object.values(DISPLAY).map((d) => d.unit));
const compact = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumSignificantDigits: 3,
});
const grouped = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });
// Negative values take a true minus sign (U+2212), as the legend and the cut
// picker do; Intl writes a hyphen-minus.
const minus = (text) => text.replace("-", "\u2212");
export const formatValue = (v, unit) => minus((SCALED.has(unit) ? grouped : compact).format(v));
export const signed = (v, unit) => (v > 0 ? "+" : "") + formatValue(v, unit);

const pct = new Intl.NumberFormat("en", {
	maximumSignificantDigits: 2,
	signDisplay: "exceptZero",
});
export const fmtPct = (p) => (p === null ? "—" : minus(`${pct.format(p)}%`));

// indicator from displayIndicator; totals already in its display unit.
export function headline(indicator, deltaTotal, baseTotal) {
	const p = baseTotal ? (100 * deltaTotal) / baseTotal : null;
	const short = indicator.short ?? indicator.name;
	// "Employment" reads "employment" mid-sentence; an acronym (GHG) keeps its case
	const name = /^.[a-z]/.test(short) ? short[0].toLowerCase() + short.slice(1) : short;
	return `Summed over all regions, the change in ${name} is ${signed(deltaTotal, indicator.unit)} ${indicator.unit}: ${fmtPct(p)} of the baseline total of ${formatValue(baseTotal, indicator.unit)} ${indicator.unit}.`;
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
		parts.push(`wall per scenario job median ${fmtSeconds(run.wall_s.median)}, max ${fmtSeconds(run.wall_s.max)}`);
	if (run.peak_rss_bytes)
		parts.push(
			`peak RSS per worker median ${fmtGiB(run.peak_rss_bytes.median)}, max ${fmtGiB(run.peak_rss_bytes.max)}`,
		);
	return parts.join(" · ");
}

// A full 40-character commit hash shortened to 12; anything else as recorded.
export const shortCommit = (commit) => (/^[0-9a-f]{40}$/.test(String(commit)) ? commit.slice(0, 12) : String(commit));
