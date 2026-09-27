// Pure logic for index.html: data location, URL state, banner, comparison, axis.

const DEFAULT_DATA = "data/results.json";
// Relative path segments of word characters, dots and dashes, ending in .json.
const SAFE_DATA = /^[\w-]+(\/[\w.-]+)*\.json$/;

export function dataUrl(search) {
	const path = new URLSearchParams(search).get("data");
	return path && SAFE_DATA.test(path) && !path.split("/").includes("..")
		? path
		: DEFAULT_DATA;
}

// The ?data= value dataUrl refused, for the status line; null if none was refused.
export function ignoredData(search) {
	const path = new URLSearchParams(search).get("data");
	return path !== null && dataUrl(search) !== path ? path : null;
}

export function parseState(search, data) {
	const params = new URLSearchParams(search);
	const interventions = data.scenarios
		.map((s) => s.id)
		.filter((id) => id !== "baseline");
	const indicators = data.indicators.map((i) => String(i.id));
	const scenario = params.get("scenario");
	const indicator = params.get("indicator");
	return {
		scenario: interventions.includes(scenario) ? scenario : interventions[0],
		indicator: indicators.includes(indicator) ? indicator : indicators[0],
	};
}

export function stateToSearch(state, search) {
	const params = new URLSearchParams(search);
	for (const [k, v] of Object.entries(state)) params.set(k, v);
	return `?${params}`;
}

// Fail safe: only an explicit "exiobase-v3" escapes the synthetic banner.
export function banner(data) {
	return data.data_kind === "exiobase-v3"
		? { synthetic: false, text: "EXIOBASE v3 · engine output" }
		: { synthetic: true, text: "SYNTHETIC TEST DATA — NOT A RESULT" };
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

// Round ticks (1, 2 or 5 x 10^k) spanning [min, max] and always 0.
export function niceTicks(min, max, target = 4) {
	const lo = Math.min(0, min);
	const hi = Math.max(0, max);
	if (lo === hi) return [0, 1];
	const raw = (hi - lo) / target;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].find((m) => m * power >= raw) * power;
	const ticks = [];
	for (let i = Math.floor(lo / step); i <= Math.ceil(hi / step); i++) {
		ticks.push(Number((i * step).toPrecision(12)) || 0);
	}
	return ticks;
}

// EXIOBASE employment is in thousands of persons. Shown in persons, so a
// compact "K" never stacks on "1000 p" and reads as a millionfold.
export function displayIndicator(indicator) {
	return indicator.unit === "1000 p"
		? { ...indicator, unit: "persons", factor: 1000 }
		: { ...indicator, factor: 1 };
}

// Compact notation (3.2B, 450K) never falls back to exponent notation.
// Persons are written out in full (18,800), never scaled.
const compact = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumSignificantDigits: 3,
});
const grouped = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });
// Negative values take a true minus sign (U+2212), as the legend and the cut
// picker do; Intl writes a hyphen-minus.
const minus = (text) => text.replace("-", "\u2212");
export const formatValue = (v, unit) =>
	minus((unit === "persons" ? grouped : compact).format(v));
export const signed = (v, unit) => (v > 0 ? "+" : "") + formatValue(v, unit);

const pct = new Intl.NumberFormat("en", {
	maximumSignificantDigits: 2,
	signDisplay: "exceptZero",
});
export const fmtPct = (p) => (p === null ? "—" : minus(`${pct.format(p)}%`));

// indicator from displayIndicator; totals already in its display unit.
export function headline(indicator, deltaTotal, baseTotal) {
	const p = baseTotal ? (100 * deltaTotal) / baseTotal : null;
	return `Summed over all regions, ${indicator.name} changes by ${signed(deltaTotal, indicator.unit)} ${indicator.unit} (${fmtPct(p)}).`;
}

// --- material-efficiency grid --------------------------------------------------

export const gridScenarioId = (product, region, cut) =>
	`${product}-${region}-${Math.abs(cut)}`;

// The scenario picker: the non-grid interventions, then one entry per grid
// product (value "grid:<slug>"); region and cut are chosen separately.
export function scenarioMenu(data) {
	const published = data.scenarios.filter((s) => s.id !== "baseline");
	return {
		interventions: published
			.filter((s) => !s.grid)
			.map((s) => ({ value: s.id, label: s.label })),
		grid: (data.grid?.products ?? [])
			.filter((p) => published.some((s) => s.grid?.product === p.slug))
			.map((p) => ({ value: `grid:${p.slug}`, label: p.short })),
	};
}

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
	const id = gridScenarioId(
		picker.scenario.slice(5),
		picker.region,
		Number(picker.cut),
	);
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
		parts.push(
			`wall per scenario job median ${fmtSeconds(run.wall_s.median)}, max ${fmtSeconds(run.wall_s.max)}`,
		);
	if (run.peak_rss_bytes)
		parts.push(
			`peak RSS per worker median ${fmtGiB(run.peak_rss_bytes.median)}, max ${fmtGiB(run.peak_rss_bytes.max)}`,
		);
	return parts.join(" · ");
}
