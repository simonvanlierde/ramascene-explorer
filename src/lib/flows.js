// Pure logic for the map-first explorer: what the selection sums to, the
// wording of the live sentence, the colour scales, the tapered flow bands and
// the drill-down Sankey. No DOM here, so node --test covers it.

import { geoDistance } from "d3-geo";
import { interpolateLab, interpolateRgb, interpolateRgbBasis, piecewise } from "d3-interpolate";
import { cubicOut } from "svelte/easing";
import { at } from "./embodied.js";

// The 15 level-2 sections in the Parquet's order, short enough for the rail,
// and one muted hue each, shared by the rail, the map and the Sankey.
export const SECTION_SHORT = [
	"Agriculture",
	"Fishing",
	"Mining",
	"Manufacturing",
	"Electricity, gas, water",
	"Construction",
	"Trade",
	"Hotels, restaurants",
	"Transport",
	"Finance",
	"Real estate, business",
	"Public admin",
	"Education",
	"Health",
	"Other services",
];
export const SECTION_COLOURS = [
	"#6e9550",
	"#3f9693",
	"#8f7558",
	"#7f68a3",
	"#d1a136",
	"#969696",
	"#c45f6c",
	"#e0946f",
	"#4a76ad",
	"#5a5a80",
	"#b67c8f",
	"#557552",
	"#c9ac5a",
	"#d77f66",
	"#8fadc8",
];
const CONTINENTS = ["Europe", "Middle-East", "America", "Asia-Pacific", "Africa"];

// Names that read better on the map than the database's.
const ROW_NAME = {
	WA: "Rest of Asia–Pacific",
	WL: "Rest of America",
	WF: "Rest of Africa",
	WM: "Rest of Middle East",
	WE: "Rest of Europe",
};
export const placeName = (meta, k) => ROW_NAME[meta.country_codes[k]] ?? meta.countries[k];
// The same name after "in" or "from", where these four take "the".
const THE = new Set(["US", "GB", "NL", "CZ"]);
export const theName = (meta, k) => (THE.has(meta.country_codes[k]) ? "the " : "") + placeName(meta, k);

// --- numbers ------------------------------------------------------------------

const MINUS = "−";
const numbers = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });
const scientific = new Intl.NumberFormat("en", { notation: "scientific", maximumSignificantDigits: 3 });
const percentages = new Intl.NumberFormat("en", {
	maximumSignificantDigits: 3,
	maximumFractionDigits: 2,
	roundingPriority: "lessPrecision",
});
// Display only: differences below a trillionth of their baseline are shown
// as zero. Keep the original values for calculations and exports.
export const displayChange = (value, baseline) => (Math.abs(value) <= Math.abs(baseline) * 1e-12 ? 0 : value);

// Three significant figures; scientific notation keeps very small values short.
export function fmt(v) {
	const a = Math.abs(v);
	const s = (a > 0 && a < 1e-4 ? scientific : numbers).format(a).replace("E-", "e−").replace("E", "e");
	return (v < 0 ? MINUS : "") + s;
}
const sign = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "");
export function pct(v) {
	const value = displayChange(v, 100);
	const a = Math.abs(value);
	if (a > 0 && a < 0.01) return `<0.01% ${value < 0 ? "decrease" : "increase"}`;
	return `${sign(value)}${percentages.format(a)}%`;
}
// A share that is not zero never reads as 0%.
export function share(a, b) {
	const p = b > 0 ? (a / b) * 100 : 0;
	return p > 0 && p < 0.5 ? "<1%" : `${Math.round(p)}%`;
}
export const possessive = (name) => (name.endsWith("s") ? "’" : "’s");

// --- indicators ------------------------------------------------------------------

// Display unit and wording per indicator (global ids of the engine database).
// made: the producer side's label, in the indicator's own word (released,
// jobs, extracted); here: the legend's start; own(name): what a country does.
// Values reach these functions already in the display unit (factor applied):
// Mt for GHG and metal ores, persons for employment.
const WORDING = {
	5: {
		label: "GHG",
		noun: "greenhouse gases",
		source: "emissions are released",
		made: { col: "Released in", here: "Released here to make", own: (n) => `What ${n} releases`, is: "it is released" },
		total: { in: "Consumption footprint", out: "Emissions released" },
		factor: 1e-9,
		unit: "Mt CO₂-eq",
		in: {
			verb: " consumption was linked to",
			abroad: "was released abroad",
			would: " consumption would have been linked to",
			where: "released in",
		},
		out: {
			verb: " released",
			abroad: "of it served consumption abroad",
			would: "emissions released in ",
			come: " would have come to",
			where: "consumed in",
		},
	},
	3: {
		label: "Employment",
		noun: "jobs",
		source: "people work",
		made: { col: "Jobs in", here: "Jobs here that make", own: (n) => `Jobs in ${n}`, is: "the jobs are" },
		total: { in: "Jobs behind consumption", out: "Jobs located here" },
		factor: 1e3,
		unit: "jobs",
		in: {
			verb: " consumption was linked to",
			abroad: "of them were abroad",
			would: " consumption would have been linked to",
			where: "in jobs in",
		},
		out: {
			verb: " had",
			abroad: "of them served consumption abroad",
			would: "jobs in ",
			come: " would have come to",
			where: "serving consumption in",
		},
	},
	7: {
		label: "Metal ores",
		noun: "metal ores",
		source: "metal ores are mined",
		made: {
			col: "Extracted in",
			here: "Extracted here to make",
			own: (n) => `What ${n} extracts`,
			is: "it is extracted",
		},
		total: { in: "Ores behind consumption", out: "Ores extracted here" },
		factor: 1e-3,
		unit: "Mt",
		in: {
			verb: " consumption required",
			abroad: "was extracted abroad",
			would: " consumption would have required metal-ore extraction of",
			where: "extracted in",
		},
		out: {
			verb: " extracted",
			abroad: "of it served consumption abroad",
			would: "metal-ore extraction in ",
			come: " would have come to",
			where: "consumed in",
		},
	},
};
// An id without wording here (a new indicator in the data) is an error, not GHG.
export function wording(id) {
	if (!WORDING[id]) throw new Error(`No wording for indicator id ${id}; add it to WORDING in flows.js`);
	return WORDING[id];
}

// [number, unit] for an amount in the indicator's display unit.
export function amount(v, id) {
	const w = wording(id);
	if (w.unit !== "jobs") return [fmt(v), w.unit];
	const a = Math.abs(v);
	if (a >= 1e6) return [fmt(v / 1e6), "million jobs"];
	if (a >= 1e3) return [fmt(v / 1e3), "thousand jobs"];
	return [fmt(v), "jobs"];
}
export const amountText = (v, id) => amount(v, id).join(" ");
// The same with the unit cut to "Mt" or "k jobs", where space is short (map
// labels, legend, run cards); the full unit is stated nearby.
const SHORT_UNIT = {
	"Mt CO\u2082-eq": "Mt",
	Mt: "Mt",
	"million jobs": "M jobs",
	"thousand jobs": "k jobs",
	jobs: "jobs",
};
export function amountShort(v, id) {
	const [n, u] = amount(v, id);
	return SHORT_UNIT[u].startsWith("M ") || SHORT_UNIT[u].startsWith("k ")
		? `${n}${SHORT_UNIT[u]}`
		: `${n} ${SHORT_UNIT[u]}`;
}

// --- runs ---------------------------------------------------------------------

// The runs What if… lists first, in order; What if… opens on the first.
export const FEATURED = ["coal-power-china", "steel-asia-pacific-20", "construction-demand-europe"];

// Plain-language "if …" clause for each run, as the sentence uses it.
const NAMED = {
	"vehicle-demand-europe": "European final demand for European-made motor vehicles fell by 20%",
	"steel-in-vehicles-europe": "European vehicle makers required 20% less steel per unit of output",
	"cement-in-construction": "construction required 20% less cement per unit of output worldwide",
	"coal-power-china": "industry in China required 20% less Chinese coal power per unit of output",
	"construction-demand-europe": "European final demand for construction work fell by 20%",
};
// The kind of change, as the chosen card's subtitle names it; a grid cell has none here.
export const RUN_KIND = {
	"vehicle-demand-europe": "Final demand",
	// first use of the term on the page, so it carries its gloss
	"construction-demand-europe": "Final demand: what households, governments and investors buy",
	"coal-power-china": "Electricity use",
};
const PLACE = { "Middle-East": "the Middle East", America: "the Americas" };
export function runText(data, id) {
	if (NAMED[id]) return NAMED[id];
	const s = data.scenarios.find((x) => x.id === id);
	if (!s?.grid) return s?.label ?? id;
	const product = data.grid.products.find((p) => p.slug === s.grid.product);
	const region = data.grid.regions.find((r) => r.slug === s.grid.region);
	const name = region?.name ?? s.grid.region;
	return `every industry in ${PLACE[name] ?? name} required ${Math.abs(s.grid.cut)}% less ${(product?.short ?? s.grid.product).toLowerCase()} per unit of output`;
}
export const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// --- the selection ---------------------------------------------------------------

// Everything the map, the sentence and the rail show for one selection.
// base: the dense baseline run; delta: the dense run (change), or null.
// sel: {ind (position in meta.indicators), id (global id), who, dir ("in"|"out"), on: Set of sections}
export function summarise(meta, base, delta, sel) {
	const N = meta.countries.length;
	const S = meta.sections.length;
	const f = wording(sel.id).factor;
	const cellIdx = (k, q) => (sel.dir === "in" ? at(meta, sel.ind, k, q, sel.who) : at(meta, sel.ind, sel.who, q, k));
	const vals = new Float64Array(N);
	const dv = new Float64Array(N);
	const sec = new Float64Array(S);
	for (let k = 0; k < N; k++)
		for (let q = 0; q < S; q++) {
			const i = cellIdx(k, q);
			sec[q] += f * base[i];
			if (!sel.on.has(q)) continue;
			vals[k] += f * base[i];
			if (delta) dv[k] += f * delta[i];
		}
	const total = vals.reduce((a, b) => a + b, 0);
	const home = vals[sel.who];
	const others = [...vals.keys()].filter((k) => k !== sel.who && vals[k] > 0).sort((a, b) => vals[b] - vals[a]);
	// The largest flows that matter at the scale of this selection.
	const floor = (total - home) * 0.008;
	const bands = others.filter((k) => vals[k] >= floor).slice(0, 18);
	const dTotal = delta ? dv.reduce((a, b) => a + b, 0) : 0;
	const byChange = delta ? [...dv.keys()].sort((a, b) => Math.abs(dv[b]) - Math.abs(dv[a])) : [];
	// A change below display resolution has no hotspot to name.
	const changed = delta && displayChange(dv[byChange[0]], total) !== 0 ? byChange[0] : null;
	// the home country often changes most; the sentence then also names the largest abroad
	const changedAbroad = delta
		? (byChange.find((k) => k !== sel.who && displayChange(dv[k], total) !== 0) ?? null)
		: null;
	return {
		vals,
		dv: delta ? dv : null,
		sec,
		total,
		home,
		others,
		bands,
		dTotal,
		changed,
		changedAbroad,
		cell: (k, q) => f * base[cellIdx(k, q)],
	};
}

// % change of one partner's flow, or null where the 2011 flow is too small to
// carry a percentage (under a millionth of the selection's total).
export const flowPct = (sum, k) => (sum.dv && sum.vals[k] > sum.total * 1e-6 ? (sum.dv[k] / sum.vals[k]) * 100 : null);

// Map colours and labels use the selection's display resolution; exports
// retain the unrounded percentage returned by flowPct.
export function displayFlowPct(sum, k) {
	const p = flowPct(sum, k);
	return p === null ? null : displayChange(sum.dv[k], sum.total) === 0 ? 0 : p;
}

// Which way the flows on screen move in a run: -1 all down, 1 all up, 0 both
// (the legend then shows one arm of the change ramp, or both).
export function changeArm(sum) {
	const p = sum.others.map((k) => displayFlowPct(sum, k) ?? 0);
	if (p.every((v) => v === 0)) return 0;
	return p.every((v) => v <= 0) ? -1 : p.every((v) => v >= 0) ? 1 : 0;
}

// Round up to 1, 1.5, 2, 3, 5 or 7.5 × 10^k.
export function niceUp(m) {
	if (!(m > 0)) return 1;
	const e = 10 ** Math.floor(Math.log10(m));
	// toPrecision drops the float noise of x × 10^k (0.30000000000000004)
	return [1, 1.5, 2, 3, 5, 7.5, 10].map((x) => +(x * e).toPrecision(2)).find((v) => v >= m * (1 - 1e-12));
}

// The diverging scale's extent: the 90th percentile of |% change| among the
// partners whose flow is at least 0.1% of the selection's total, rounded up,
// so the colours spread over the flows the map shows rather than the whole
// world, and one outlier does not wash the rest out (it is drawn at the cap).
export function fitExtent(sum) {
	const a = [...sum.vals.keys()]
		.filter((k) => sum.vals[k] >= sum.total * 1e-3)
		.map((k) => Math.abs(displayFlowPct(sum, k) ?? 0))
		.sort((x, y) => x - y);
	return niceUp(a.length ? a[Math.floor(0.9 * (a.length - 1))] : 0);
}

// --- colour ---------------------------------------------------------------------

// The map's colours per theme: self is the selected country, band the flow bands,
// land a country with no flow worth showing. The ramps run from faint to strong
// against each theme's land, so small values fade into the ground in both.
const theme = (self, band, land, sea, seq, fill, bandRamp) => ({
	self,
	band,
	land,
	sea,
	seq: interpolateRgbBasis(seq),
	fill: piecewise(interpolateLab, fill),
	bandRamp: piecewise(interpolateRgb, bandRamp),
});
export const MAP = {
	light: theme(
		"#2b3a45",
		"#a8471c",
		"#e8e9e7",
		"#f6f8f9",
		["#efe9dc", "#cfd8d3", "#93b1b4", "#4f7d8c"],
		["#3d6c96", "#a9c3d9", "#f1f0ec", "#e2b0a5", "#a5493d"],
		["#284f78", "#5b87b0", "#b4b9bd", "#c0675a", "#8b3a31"],
	),
	dark: theme(
		"#e6edf2",
		"#d9703f",
		"#2a333a",
		"#192026",
		["#3a4441", "#3f5d62", "#5f9196", "#a7d3cc"],
		["#79acdf", "#3a5872", "#2d343a", "#7a463c", "#ec8673"],
		["#8bb8e6", "#5b87b0", "#7c858c", "#c9705f", "#f0907c"],
	),
};

const clamp01 = (t) => Math.max(0, Math.min(1, t));
// Log scale from lo to hi on the theme's sequential ramp.
export const seqScale =
	(lo, hi, t = "light") =>
	(v) =>
		MAP[t].seq(clamp01(Math.log(v / lo) / Math.log(hi / lo)));
// Square-root diverging scale on ±m, so the typical small change still reads
// next to the run's extremes. Blue is a decrease, red an increase.
const divScale =
	(key) =>
	(m, t = "light") =>
	(v) =>
		MAP[t][key](0.5 + 0.5 * Math.sign(v) * Math.sqrt(clamp01(Math.abs(v) / m)));
export const divFill = divScale("fill");
export const divBand = divScale("bandRamp");

// --- flow bands -------------------------------------------------------------------

// Half-width factor along a band, t = 0 at the flow's origin and 1 where it
// arrives: thin where it leaves, full width from 60% of the way.
export const taper = (t) => 0.16 + 0.84 * cubicOut(Math.min(1, t / 0.6));

// Partners within 5° of great circle (about 550 km) of the selected country
// get no band on either map: the fill shows them, and a band that short reads
// as a smudge on the border. Partners further away get one wherever it fits
// outside the collar (bandGeometry), so zooming in makes room for more of them.
const NEAR = (5 * Math.PI) / 180;
// The partners in ks that get a band. at: [lon, lat] of each region's anchor;
// who: the selected region.
export const bandPartners = (ks, who, at) => ks.filter((k) => geoDistance(at[k], at[who]) >= NEAR);

// Tapered bands (after Minard): one per partner, width ∝ flow, each ending on
// a collar of radius R around the selected country B, where they meet side by
// side. Each line runs from the partner to B (projected points); dir says which
// way the flow goes, so the taper points along it: "in" (consumed in the
// selected country) flows partner → B, "out" (released in it) B → partner.
// lines: [{k, v, P}], k the partner, v the flow, P its projected centreline.
export function bandGeometry(lines, B, { k: widthK, dir, minWidth = 0.8 }) {
	const R = Math.max(6, lines.reduce((s, l) => s + Math.max(minWidth, l.v * widthK), 0) / (2 * Math.PI * 0.82));
	const live = [];
	for (const l of lines) {
		const a = l.P[0];
		// a start inside the collar leaves no room for a band: on the flat map this,
		// not bandPartners, is what drops the nearer partners
		if (Math.hypot(a[0] - B[0], a[1] - B[1]) < R + 12) continue;
		const e = l.P[l.P.length - 4];
		live.push({ ...l, w: Math.max(minWidth, l.v * widthK), th: Math.atan2(e[1] - B[1], e[0] - B[0]) });
	}
	live.sort((x, y) => x.th - y.th);
	for (const l of live) l.p = l.th;
	// spread the ends around the collar so neighbouring bands do not overlap
	const tot = live.reduce((s, l) => s + l.w / R, 0);
	for (let it = 0; it < 60 && live.length > 1; it++)
		for (let i = 0; i < live.length; i++) {
			const x = live[i];
			const y = live[(i + 1) % live.length];
			let gap = y.p - x.p;
			if (i === live.length - 1) gap += 2 * Math.PI;
			const need = (x.w + y.w) / (2 * R) + Math.min(0.01, (2 * Math.PI - tot) / live.length / 4);
			if (gap < need) {
				const d = (need - gap) / 2;
				x.p -= d;
				y.p += d;
			}
		}
	const bands = live.map(({ k, v, P, w, p }) => {
		const n = P.length - 1;
		const E = [B[0] + R * Math.cos(p), B[1] + R * Math.sin(p)];
		// bend the last stretch onto the collar point
		const Q = P.map((pt, i) => {
			const f = (i / n) ** 3;
			return [pt[0] + (E[0] - B[0]) * f, pt[1] + (E[1] - B[1]) * f];
		});
		const { L, Rt, widths } = ribbon(
			Q,
			w,
			dir,
			Q.map((_, i) => i / n),
		);
		// the collar end sits on the circle, as wide as the band is there
		const half = widths[n] / (2 * R);
		const e1 = [B[0] + R * Math.cos(p - half), B[1] + R * Math.sin(p - half)];
		const e2 = [B[0] + R * Math.cos(p + half), B[1] + R * Math.sin(p + half)];
		// match each edge to the nearer collar point so the ribbon does not twist
		const near =
			Math.hypot(L[n - 1][0] - e1[0], L[n - 1][1] - e1[1]) < Math.hypot(L[n - 1][0] - e2[0], L[n - 1][1] - e2[1]);
		L[n] = near ? e1 : e2;
		Rt[n] = near ? e2 : e1;
		return { k, v, widths, d: outline(L, Rt) };
	});
	return { R, bands };
}

// The two edges of a tapered band along the points Q. ts: where each point sits along
// the whole band, 0 at the partner and 1 at the selected country.
function ribbon(Q, w, dir, ts) {
	const n = Q.length - 1;
	const L = [];
	const Rt = [];
	const widths = [];
	Q.forEach((pt, i) => {
		const a = Q[Math.max(0, i - 1)];
		const c = Q[Math.min(n, i + 1)];
		const dx = c[0] - a[0];
		const dy = c[1] - a[1];
		const h = Math.hypot(dx, dy) || 1;
		const hw = (w / 2) * taper(dir === "in" ? ts[i] : 1 - ts[i]);
		widths.push(2 * hw);
		L.push([pt[0] - (dy / h) * hw, pt[1] + (dx / h) * hw]);
		Rt.push([pt[0] + (dy / h) * hw, pt[1] - (dx / h) * hw]);
	});
	return { L, Rt, widths };
}
const xy = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
const outline = (L, Rt) => `M${L.map(xy).join("L")}L${[...Rt].reverse().map(xy).join("L")}Z`;

// Bands whose selected country is behind the globe: each runs from its partner to the
// horizon, as wide there as it would be at that point of the whole band, with no collar.
// lines: [{k, v, P, ts}], P the stretch in view and ts each point's place along the band.
export function horizonBands(lines, { k: widthK, dir, minWidth = 0.8 }) {
	return lines.map(({ k, v, P, ts }) => {
		const { L, Rt, widths } = ribbon(P, Math.max(minWidth, v * widthK), dir, ts);
		return { k, v, widths, d: outline(L, Rt) };
	});
}

// Quadratic arc from a to c bowed upwards: the flat map's centreline.
export function arc(a, c, n = 30) {
	const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
	const q = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - d * 0.24];
	return Array.from({ length: n + 1 }, (_, i) => {
		const t = i / n;
		const u = 1 - t;
		return [u * u * a[0] + 2 * u * t * q[0] + t * t * c[0], u * u * a[1] + 2 * u * t * q[1] + t * t * c[1]];
	});
}

// Legend glyph: a band of flow v drawn from x = 2 to x1, centred on y = 9.
export function taperGlyph(v, widthK, x1, dir) {
	const w = v * widthK;
	const pts = Array.from({ length: 21 }, (_, j) => {
		const t = j / 20;
		return [2 + t * (x1 - 2), (w / 2) * taper(dir === "in" ? t : 1 - t)];
	});
	const up = pts.map(([x, h]) => `${x.toFixed(1)},${(9 - h).toFixed(1)}`);
	const down = pts.reverse().map(([x, h]) => `${x.toFixed(1)},${(9 + h).toFixed(1)}`);
	return `M${up.join("L")}L${down.join("L")}Z`;
}

// --- drill-down Sankey ------------------------------------------------------------

// Released in → industry → consumed in, for the selection's flows. The
// selected country is one node on its side; the partners are the nine
// largest plus one "other regions" node; the middle column is the sections in
// the selection with any flow. Returns nodes and ribbon paths in a width ×
// height box.
export function sankeyLayout(meta, sum, sel, { width = 452, height = 420 } = {}) {
	const { vals } = sum;
	const secs = [...sel.on].filter((q) => sum.sec[q] > 0).sort((a, b) => sum.sec[b] - sum.sec[a]);
	const partners = [...vals.keys()].filter((k) => vals[k] > 0).sort((a, b) => vals[b] - vals[a]);
	const top = partners.slice(0, 9);
	const rest = partners.slice(9);
	const P = top.map((k) => ({
		ks: [k],
		name: k === sel.who ? `${placeName(meta, k)} (home)` : placeName(meta, k),
		v: vals[k],
	}));
	if (rest.length) P.push({ ks: rest, name: `${rest.length} other regions`, v: rest.reduce((s, k) => s + vals[k], 0) });
	const me = { ks: partners, name: placeName(meta, sel.who), v: sum.total, me: true };
	const inDir = sel.dir === "in";
	const left = inDir ? P : [me];
	const right = inDir ? [me] : P;
	const mid = secs.map((q) => ({
		q,
		name: SECTION_SHORT[q],
		v: sum.sec[q],
	}));
	const top0 = 30;
	const gap = 3;
	const nw = 9;
	// release mirrors consumption: the selected country is one node at the edge,
	// and the industry labels face it, over the bands that fan into it
	const xL = inDir ? 132 : 6;
	const xM = inDir ? 214 : width - 214 - nw;
	const xR = inDir ? width - nw - 6 : width - 132 - nw;
	const total = sum.total || 1;
	const scale = (c) => (height - top0 - gap * (c.length - 1)) / total;
	const stack = (c) => {
		const k = scale(c);
		let y = top0;
		for (const d of c) {
			d.y = y;
			d.h = Math.max(0.8, d.v * k);
			d.o = y;
			d.i = y;
			y += d.v * k + gap;
		}
		return k;
	};
	const kL = stack(left);
	const kM = stack(mid);
	const kR = stack(right);
	const val = (g, q) => g.ks.reduce((s, k) => s + sum.cell(k, q), 0);
	const rib = (x0, a0, a1, x1, b0, b1) => {
		const m = (x0 + x1) / 2;
		return `M${x0},${a0}C${m},${a0} ${m},${b0} ${x1},${b0}L${x1},${b1}C${m},${b1} ${m},${a1} ${x0},${a1}Z`;
	};
	const links = [];
	for (const l of left)
		for (const m of mid) {
			const x = val(l, m.q);
			if (x <= 0) continue;
			links.push({ q: m.q, v: x, from: l.name, to: m.name, d: rib(xL + nw, l.o, l.o + x * kL, xM, m.i, m.i + x * kM) });
			l.o += x * kL;
			m.i += x * kM;
		}
	for (const m of mid) {
		m.o = m.y;
		for (const r of right) {
			const x = val(r, m.q);
			if (x <= 0) continue;
			links.push({ q: m.q, v: x, from: m.name, to: r.name, d: rib(xM + nw, m.o, m.o + x * kM, xR, r.i, r.i + x * kR) });
			m.o += x * kM;
			r.i += x * kR;
		}
	}
	return { left, mid, right, links, x: { L: xL, M: xM, R: xR }, nw, top0, width, height };
}

// --- URL state ------------------------------------------------------------------

// The view's own query parameters; scenario and indicator keep the names the
// first version of the page used, so old links still land on their run.
// opts: {runs: run ids with flows, indicators: global ids, codes: country codes}
// The map opens on the globe; ?map=flat picks the flat map. ?map=globe, from older
// links, is the default and is dropped.
// ?zoom=k on the globe, ?zoom=k,lon,lat on the flat map; anything out of range is ignored.
function parseZoom(s) {
	const z = (s ?? "").split(",").map(Number);
	const ok = z.every(Number.isFinite) && z[0] > 1 && z[0] <= 8;
	if (ok && z.length === 1) return z;
	if (ok && z.length === 3 && Math.abs(z[1]) <= 180 && Math.abs(z[2]) <= 90) return z;
	return null;
}
export function parseView(search, { runs, indicators, codes }) {
	const q = new URLSearchParams(search);
	const scenario = q.get("scenario");
	// a missing or empty ?indicator= must fall back, not read as indicator 0
	const indicatorParam = q.get("indicator");
	const indicator = indicatorParam ? Number(indicatorParam) : Number.NaN;
	const region = q.get("region");
	const sections = (q.get("sections") ?? "")
		.split(",")
		.filter((x) => /^\d+$/.test(x))
		.map(Number)
		.filter((x) => x < SECTION_SHORT.length);
	const panel = q.get("panel");
	const named = runs.filter((r) => r !== "baseline");
	return {
		// a bare ?scenario= is a link from the first version, which always showed a run
		mode: q.get("mode") === "whatif" || (q.get("mode") === null && named.includes(scenario)) ? "whatif" : "flows",
		run: named.includes(scenario) ? scenario : (FEATURED.find((r) => named.includes(r)) ?? named[0]),
		indicator: indicators.includes(indicator) ? indicator : indicators[0],
		who: Math.max(0, codes.indexOf(codes.includes(region) ? region : "DE")),
		dir: q.get("dir") === "out" ? "out" : "in",
		on: new Set(sections.length ? sections : SECTION_SHORT.keys()),
		globe: q.get("map") !== "flat",
		zoom: parseZoom(q.get("zoom")),
		panel: ["sankey", "table", "method"].includes(panel) ? panel : null,
	};
}

// Write the view into the query string; defaults are left out, other
// parameters (data, api) are kept.
export function viewSearch(v, codes, search = "") {
	const q = new URLSearchParams(search);
	const set = (k, val, dflt) => (val === dflt || val == null ? q.delete(k) : q.set(k, String(val)));
	set("mode", v.mode, "flows");
	set("scenario", v.mode === "whatif" ? v.run : null);
	set("indicator", v.indicator, 5);
	set("region", codes[v.who], "DE");
	set("dir", v.dir, "in");
	set("sections", v.on.size === SECTION_SHORT.length ? null : [...v.on].sort((a, b) => a - b).join(","));
	set("map", v.globe ? null : "flat");
	set("zoom", v.zoom?.join(","));
	set("panel", v.panel);
	const s = `${q}`.replace(/%2C/g, ",");
	return s ? `?${s}` : "";
}

// --- the table and its CSV ---------------------------------------------------------

// The Details table's rows: every partner with at least a millionth of the
// selection's total, its largest section among those shown, and in a run the
// flow's % change (null without a run or where the flow is too small).
export function tableRows(meta, sum, on) {
	const secs = [...on];
	return [...sum.vals.keys()]
		.filter((k) => sum.vals[k] > sum.total * 1e-6)
		.map((k) => {
			const ts = secs.reduce((a, q) => (sum.cell(k, q) > sum.cell(k, a) ? q : a), secs[0]);
			return { k, n: meta.countries[k], v: sum.vals[k], ind: SECTION_SHORT[ts], ts, c: flowPct(sum, k) };
		});
}

// Column suffix and divisor from the table's display unit.
const CSV_UNIT = {
	"Mt CO\u2082-eq": ["mt_co2eq", 1],
	Mt: ["mt", 1],
	jobs: ["jobs", 1],
	"thousand jobs": ["thousand_jobs", 1e3],
	"million jobs": ["million_jobs", 1e6],
};
const slug = (t) =>
	t
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
// RFC 4180: quote a field holding a comma, a quote or a line break
const csvField = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// The table as one CSV file: its rows, largest flow first, in the table's
// display unit at full precision, and a file name that states the basis
// (data, year, region, indicator, direction, sections and the run).
// sel: {id (global indicator id), who, dir, on}; run: the run's id in What if…, else null.
export function flowsCsv(meta, sum, sel, { data, run = null }) {
	const [u, div] = CSV_UNIT[amount(sum.total, sel.id)[1]];
	const whatif = Boolean(run && sum.dv);
	const head = ["region_code", "region_name", `flow_${u}`, "share_pct", "largest_section"];
	if (whatif) head.push(`change_${u}`, "change_pct");
	const lines = [head];
	for (const r of tableRows(meta, sum, sel.on).sort((a, b) => b.v - a.v)) {
		const row = [meta.country_codes[r.k], r.n, String(r.v / div), String((r.v / sum.total) * 100), r.ind];
		if (whatif) row.push(String(sum.dv[r.k] / div), r.c === null ? "" : String(r.c));
		lines.push(row);
	}
	const text = `${lines.map((l) => l.map(csvField).join(",")).join("\r\n")}\r\n`;
	const secs =
		sel.on.size === SECTION_SHORT.length
			? "all-sections"
			: [...sel.on]
					.sort((a, b) => a - b)
					.map((q) => slug(SECTION_SHORT[q]))
					.join("-");
	const name = [
		"ramascene",
		...(data.data_kind === "exiobase-v3" ? [] : ["synthetic"]),
		data.base_year,
		meta.country_codes[sel.who],
		slug(wording(sel.id).label),
		sel.dir === "in" ? "consumption" : "production",
		secs,
		...(whatif ? ["whatif", run] : []),
	].join("-");
	return { name: `${name}.csv`, text };
}

// --- the five continents ----------------------------------------------------------

// The selection split by the partner's continent: [{name, base, change}] in
// the display unit (change 0 without a run). The five changes add up to the
// selection's change, so the strip answers the sentence's question.
export function continents(meta, sum) {
	return CONTINENTS.map((name) => {
		let base = 0;
		let change = 0;
		for (const country of meta.aggregates[name] ?? []) {
			const k = meta.countries.indexOf(country);
			base += sum.vals[k];
			if (sum.dv) change += sum.dv[k];
		}
		return { name, base, change };
	});
}
