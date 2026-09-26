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
export const formatValue = (v, unit) =>
	(unit === "persons" ? grouped : compact).format(v);
export const signed = (v, unit) => (v > 0 ? "+" : "") + formatValue(v, unit);

const pct = new Intl.NumberFormat("en", {
	maximumSignificantDigits: 2,
	signDisplay: "exceptZero",
});
export const fmtPct = (p) => (p === null ? "—" : `${pct.format(p)}%`);

// indicator from displayIndicator; totals already in its display unit.
export function headline(indicator, deltaTotal, baseTotal) {
	const p = baseTotal ? (100 * deltaTotal) / baseTotal : null;
	return `Summed over all regions, ${indicator.name} changes by ${signed(deltaTotal, indicator.unit)} ${indicator.unit} (${fmtPct(p)}).`;
}
