// Pure logic for the world map: TopoJSON decoding, the Equal Earth projection,
// EXIOBASE regions ↔ ISO 3166-1 alpha-2 codes, and the diverging classes.
// No DOM here, so node --test covers it.

// The 49 EXIOBASE v3 regions as the RaMa-Scene database (db.sqlite3,
// ramascene_country) names and codes them, with their continental aggregate.
// Codes are ISO alpha-2 (GB for the United Kingdom, GR for Greece) except
// the five rest-of-world aggregates, which EXIOBASE codes WA, WL, WE, WF, WM.
const AGG = {
	E: "Europe",
	M: "Middle-East",
	A: "America",
	P: "Asia-Pacific",
	F: "Africa",
};
const ROWS = `AT Austria E|BE Belgium E|BG Bulgaria E|CY Cyprus E|CZ Czech Republic E|DE Germany E|DK Denmark E|EE Estonia E|ES Spain E|FI Finland E|FR France E|GR Greece E|HR Croatia E|HU Hungary E|IE Ireland E|IT Italy E|LT Lithuania E|LU Luxembourg E|LV Latvia E|MT Malta E|NL Netherlands E|PL Poland E|PT Portugal E|RO Romania E|SE Sweden E|SI Slovenia E|SK Slovakia E|GB United Kingdom E|US United States A|JP Japan P|CN China P|CA Canada A|KR South Korea P|BR Brazil A|IN India P|MX Mexico A|RU Russia E|AU Australia P|CH Switzerland E|TR Turkey M|TW Taiwan P|NO Norway E|ID Indonesia P|ZA South Africa F|WA Rest of Asia and Pacific P|WL Rest of America A|WE Rest of Europe E|WF Rest of Africa F|WM Rest of Middle East M`;
export const EXIOBASE_REGIONS = ROWS.split("|").map((row) => {
	const [code, ...rest] = row.split(" ");
	return {
		code,
		name: rest.slice(0, -1).join(" "),
		aggregate: AGG[rest.at(-1)],
	};
});

// Which Natural Earth countries each rest-of-world aggregate stands for.
// Rule: remaining Europe → WE, the Americas → WL, Africa → WF, Iran and
// Western Asia except the Caucasus → WM, everything else in Asia and Oceania
// → WA. EXIOBASE's own concordance may differ at the edges (Greenland, the
// Caucasus, Central Asia); the page says so.
export const REST_OF = {
	WE: "AL BA BY IS MD ME MK RS UA XK",
	WL: "AR BO BS BZ CL CO CR CU DO EC FK GL GT GY HN HT JM NI PA PE PR PY SR SV TT UY VE",
	WF: "AO BF BI BJ BW CD CF CG CI CM DJ DZ EG EH ER ET GA GH GM GN GQ GW KE LR LS LY MA MG ML MR MW MZ NA NE NG RW SD SL SN SO SS SZ TD TG TN TZ UG ZM ZW",
	WM: "AE IL IQ IR JO KW LB OM PS QA SA SY YE",
	WA: "AF AM AZ BD BN BT FJ GE KG KH KP KZ LA LK MM MN MY NC NP NZ PG PH PK SB TH TJ TL TM UZ VN VU",
};
const ISO_TO_REST = Object.fromEntries(
	Object.entries(REST_OF).flatMap(([code, list]) => list.split(" ").map((iso) => [iso, code])),
);
const BY_CODE = Object.fromEntries(EXIOBASE_REGIONS.map((r) => [r.code, r]));
const BY_NAME = Object.fromEntries(EXIOBASE_REGIONS.map((r) => [r.name, r]));

// EXIOBASE region code for a Natural Earth country, or null (N. Cyprus: not assigned).
export function regionForIso(iso) {
	if (!iso) return null;
	return BY_CODE[iso] && !REST_OF[iso] ? iso : (ISO_TO_REST[iso] ?? null);
}

export const isRestOf = (code) => code in REST_OF;

// --- TopoJSON -----------------------------------------------------------------

// [{iso, name, polygons: [[ring of [lon, lat]]]}] from a quantized topology.
export function decodeTopology(topo, object) {
	const { scale, translate } = topo.transform;
	const arcs = topo.arcs.map((arc) => {
		let x = 0;
		let y = 0;
		return arc.map(([dx, dy]) => {
			x += dx;
			y += dy;
			return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
		});
	});
	const ring = (indexes) =>
		indexes.flatMap((i, k) => {
			const points = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
			return k ? points.slice(1) : points;
		});
	return topo.objects[object].geometries.map((g) => ({
		...g.properties,
		polygons: (g.type === "Polygon" ? [g.arcs] : g.arcs).map((p) => p.map(ring)),
	}));
}

// Equal Earth (Šavrič, Patterson, Jenny 2018): equal-area, so a region's
// share of the picture is its share of land. Radians in, unit plane out, y up.
const [A1, A2, A3, A4] = [1.340264, -0.081106, 0.000893, 0.003796];
const M = Math.sqrt(3) / 2;
export function equalEarth([lon, lat]) {
	const l = Math.asin(M * Math.sin((lat * Math.PI) / 180));
	const l2 = l * l;
	const l6 = l2 * l2 * l2;
	return [
		(((lon * Math.PI) / 180) * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))),
		l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)),
	];
}

// SVG path data for every feature, fitted to width; returns {height, paths}.
export function project(features, width) {
	const projected = features.map((f) => f.polygons.map((p) => p.map((r) => r.map(equalEarth))));
	const all = projected.flat(3);
	const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
	const [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
	const k = width / (x1 - x0);
	const fmt = (v) => Math.round(v * 10) / 10;
	return {
		height: Math.ceil((y1 - y0) * k),
		paths: projected.map((polys) =>
			polys
				.flat()
				.map((r) => `M${r.map(([x, y]) => `${fmt((x - x0) * k)},${fmt((y1 - y) * k)}`).join("L")}Z`)
				.join(""),
		),
	};
}

// --- values -------------------------------------------------------------------

// Per EXIOBASE code {baseline, scenario, delta, percent, name, level}, from a
// results document at either level: the 49 regions (region names as in
// EXIOBASE_REGIONS) or the five continental aggregates, where every code takes
// its aggregate's value. factor converts to the display unit.
export function regionValues(data, state, factor = 1) {
	const base = data.results.baseline?.[state.indicator];
	const scen = data.results[state.scenario]?.[state.indicator];
	if (!base || !scen) return null;
	const detailed = data.regions.every((name) => name in BY_NAME);
	const out = {};
	for (const r of EXIOBASE_REGIONS) {
		const key = detailed ? r.name : r.aggregate;
		if (!(key in base) || !(key in scen)) continue;
		const delta = scen[key] - base[key];
		out[r.code] = {
			name: detailed ? r.name : `${r.aggregate} (aggregate)`,
			level: detailed ? "region" : "aggregate",
			baseline: factor * base[key],
			scenario: factor * scen[key],
			delta: factor * delta,
			percent: base[key] ? (100 * delta) / base[key] : null,
		};
	}
	return { level: detailed ? "region" : "aggregate", values: out };
}

// Diverging classes on the percentage change: a symmetric extent E (a round
// number ≥ the largest |%|), four classes per arm and a neutral class for
// |%| below E/20. Class -4..4; 0 is neutral.
const ROUND = [1, 2, 5];
export function divergingExtent(percents) {
	const max = Math.max(0, ...percents.filter(Number.isFinite).map(Math.abs));
	if (max === 0) return 1;
	const power = 10 ** Math.floor(Math.log10(max));
	return (ROUND.find((m) => m * power >= max) ?? 10) * power;
}

export const EDGES = [0.05, 0.25, 0.5, 0.75];
export function classify(percent, extent) {
	if (percent === null || !Number.isFinite(percent)) return null;
	const a = Math.abs(percent) / extent;
	const step = EDGES.filter((e) => a >= e).length; // 0..4
	return Math.sign(percent) * step;
}

// Legend rows, most negative first: {cls, from, to} in percent.
export function legendClasses(extent) {
	const bounds = [0, ...EDGES.slice(1), 1].map((e) => e * extent);
	const neutral = EDGES[0] * extent;
	const rows = [];
	for (let s = 4; s >= 1; s--)
		rows.push({
			cls: -s,
			from: -bounds[s],
			to: -(s === 1 ? neutral : bounds[s - 1]),
		});
	rows.push({ cls: 0, from: -neutral, to: neutral });
	for (let s = 1; s <= 4; s++)
		rows.push({
			cls: s,
			from: s === 1 ? neutral : bounds[s - 1],
			to: bounds[s],
		});
	return rows;
}

// Mix of the pole into the neutral grey per class step: 25, 50, 75, 100 %.
export const classFill = (cls) =>
	cls === null
		? "var(--map-nodata)"
		: cls === 0
			? "var(--map-neutral)"
			: `color-mix(in oklab, var(${cls < 0 ? "--decrease" : "--increase"}) ${25 * Math.abs(cls)}%, var(--map-neutral))`;

// --- URL state: ?region=<EXIOBASE code>, alongside scenario and indicator ----

export function regionParam(search) {
	const code = new URLSearchParams(search).get("region");
	return code && code in BY_CODE ? code : null;
}

export function withRegion(search, code) {
	const params = new URLSearchParams(search);
	if (code) params.set("region", code);
	else params.delete("region");
	const s = `${params}`;
	return s ? `?${s}` : "";
}
