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

export function compare(data, state) {
	const base = data.results.baseline[state.indicator];
	const scen = data.results[state.scenario][state.indicator];
	return data.regions
		.map((region) => {
			const delta = scen[region] - base[region];
			return {
				region,
				baseline: base[region],
				scenario: scen[region],
				delta,
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

// Compact notation (3.2B, 450K) never falls back to exponent notation.
const compact = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumSignificantDigits: 3,
});
export const formatValue = (v) => compact.format(v);
