// Pure logic for the map-first explorer: what the selection sums to, the
// wording of the live sentence, the colour scales, the tapered flow bands and
// the drill-down Sankey. No DOM here, so node --test covers it.

import { interpolateLab, interpolateRgb, interpolateRgbBasis, piecewise } from "d3-interpolate";
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
export const CONTINENTS = ["Europe", "Middle-East", "America", "Asia-Pacific", "Africa"];

// Names that read better on the map than the database's.
const LABEL = {
	WA: "Rest of Asia–Pacific",
	WL: "Rest of America",
	WF: "Rest of Africa",
	WM: "Rest of Middle East",
	WE: "Rest of Europe",
};
export const placeName = (meta, k) => LABEL[meta.country_codes[k]] ?? meta.countries[k];

// --- numbers ------------------------------------------------------------------

const MINUS = "−";
const grouped = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
// Three significant figures at most, never exponent notation; a true minus.
export function fmt(v) {
	const a = Math.abs(v);
	const s = a >= 100 ? grouped.format(a) : a >= 10 ? a.toFixed(1) : a >= 0.01 ? a.toFixed(2) : a.toPrecision(1);
	return (v < 0 && Number(s.replace(/,/g, "")) !== 0 ? MINUS : "") + s;
}
const sign = (v) => (v > 0 ? "+" : v < 0 ? MINUS : "");
export const fmtSigned = (v) => sign(v) + fmt(Math.abs(v));
export function pct(v) {
	const a = Math.abs(v);
	return `${sign(v)}${a >= 10 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a >= 0.1 ? a.toFixed(2) : a.toFixed(3)}%`;
}
export const share = (a, b) => `${b > 0 ? Math.round((a / b) * 100) : 0}%`;
export const possessive = (name) => (name.endsWith("s") ? "’" : "’s");

// --- indicators ------------------------------------------------------------------

// Display unit and wording per indicator (global ids of the engine database).
// Values reach these functions already in the display unit (factor applied):
// Mt for GHG and metal ores, persons for employment.
const WORDING = {
	5: {
		label: "GHG",
		noun: "greenhouse gases",
		factor: 1e-9,
		unit: "Mt CO₂-eq",
		short: "Mt",
		in: {
			verb: " consumption caused",
			abroad: "was released abroad",
			would: " consumption would have caused",
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
		factor: 1e3,
		unit: "jobs",
		short: "jobs",
		in: {
			verb: " consumption supported",
			abroad: "of them were abroad",
			would: " consumption would have supported",
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
		factor: 1e-3,
		unit: "Mt",
		short: "Mt",
		in: {
			verb: " consumption required",
			abroad: "was extracted abroad",
			would: " consumption would have required",
			where: "extracted in",
		},
		out: {
			verb: " extracted",
			abroad: "of it served consumption abroad",
			would: "metal ore extraction in ",
			come: " would have come to",
			where: "consumed in",
		},
	},
};
export const wording = (id) => WORDING[id] ?? WORDING[5];

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
export function amountShort(v, id) {
	const [n, u] = amount(v, id);
	return u === "million jobs" || u === "thousand jobs"
		? `${n}${u[0] === "m" ? "M" : "k"} jobs`
		: `${n} ${u.replace(" CO\u2082-eq", "")}`;
}

// --- runs ---------------------------------------------------------------------

// Plain-language "if …" clause for each run, as the sentence uses it.
const NAMED = {
	"vehicle-demand-europe": "Europe bought 20% fewer cars, vans and trucks",
	"steel-in-vehicles-europe": "European car makers used 20% less steel",
	"cement-in-construction": "builders everywhere used 20% less cement",
};
const PLACE = { "Middle-East": "the Middle East", America: "the Americas" };
export function runText(data, id) {
	if (NAMED[id]) return NAMED[id];
	const s = data.scenarios.find((x) => x.id === id);
	if (!s?.grid) return s?.label ?? id;
	const product = data.grid.products.find((p) => p.slug === s.grid.product);
	const region = data.grid.regions.find((r) => r.slug === s.grid.region);
	const name = region?.name ?? s.grid.region;
	return `every industry in ${PLACE[name] ?? name} used ${Math.abs(s.grid.cut)}% less ${(product?.short ?? s.grid.product).toLowerCase()}`;
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
	const changed = delta ? [...dv.keys()].sort((a, b) => Math.abs(dv[b]) - Math.abs(dv[a]))[0] : null;
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
		cell: (k, q) => f * base[cellIdx(k, q)],
	};
}

// % change of one partner's flow, or null where the 2011 flow is too small to
// carry a percentage (under a millionth of the selection's total).
export const flowPct = (sum, k) => (sum.dv && sum.vals[k] > sum.total * 1e-6 ? (sum.dv[k] / sum.vals[k]) * 100 : null);

// Round up to 1, 1.5, 2, 3, 5 or 7.5 × 10^k.
export function niceUp(m) {
	if (!(m > 0)) return 1;
	const e = 10 ** Math.floor(Math.log10(m));
	return [1, 1.5, 2, 3, 5, 7.5, 10].map((x) => x * e).find((v) => v >= m * (1 - 1e-12));
}

// The diverging scale's extent for a run: the 98th percentile of |% change|
// over every producer-consumer flow of the selected sections that is at
// least a 100,000th of their world total, rounded up.
export function fitExtent(meta, base, delta, ind, on) {
	const N = meta.countries.length;
	const flows = [];
	let world = 0;
	for (let p = 0; p < N; p++)
		for (let c = 0; c < N; c++) {
			let b = 0;
			let d = 0;
			for (const q of on) {
				const i = at(meta, ind, p, q, c);
				b += base[i];
				d += delta[i];
			}
			world += b;
			flows.push([b, d]);
		}
	const a = flows
		.filter(([b]) => b >= world * 1e-5)
		.map(([b, d]) => Math.abs((d / b) * 100))
		.sort((x, y) => x - y);
	return niceUp(a.length ? a[Math.min(a.length - 1, Math.floor(0.98 * (a.length - 1)))] : 1);
}

// --- colour ---------------------------------------------------------------------

export const SELF = "#2b3a45";
export const BAND = "#a8471c";
export const LAND = "#e8e9e7";
export const SEA = "#f6f8f9";
const SEQ = interpolateRgbBasis(["#efe9dc", "#cfd8d3", "#93b1b4", "#4f7d8c"]);
const DIV_FILL = piecewise(interpolateLab, ["#3d6c96", "#a9c3d9", "#f1f0ec", "#e2b0a5", "#a5493d"]);
const DIV_BAND = piecewise(interpolateRgb, ["#284f78", "#5b87b0", "#b4b9bd", "#c0675a", "#8b3a31"]);

const clamp01 = (t) => Math.max(0, Math.min(1, t));
// Log scale from lo to hi on the sand-to-teal ramp.
export const seqScale = (lo, hi) => (v) => SEQ(clamp01(Math.log(v / lo) / Math.log(hi / lo)));
// Square-root diverging scale on ±m, so the typical small change still reads
// next to the run's extremes. Blue is a decrease, red an increase.
const divScale = (ramp) => (m) => (v) => ramp(0.5 + 0.5 * Math.sign(v) * Math.sqrt(clamp01(Math.abs(v) / m)));
export const divFill = divScale(DIV_FILL);
export const divBand = divScale(DIV_BAND);

// --- flow bands -------------------------------------------------------------------

const easeCubicOut = (t) => 1 - (1 - t) ** 3;
// Half-width factor along a band, t = 0 at the flow's origin and 1 where it
// arrives: thin where it leaves, full width from 60% of the way.
export const taper = (t) => 0.16 + 0.84 * easeCubicOut(Math.min(1, t / 0.6));

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
		// neighbours inside the collar read from the fill
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
		const L = [];
		const Rt = [];
		const widths = [];
		Q.forEach((pt, i) => {
			const t = i / n;
			const a = Q[Math.max(0, i - 1)];
			const c = Q[Math.min(n, i + 1)];
			const dx = c[0] - a[0];
			const dy = c[1] - a[1];
			const h = Math.hypot(dx, dy) || 1;
			const hw = (w / 2) * taper(dir === "in" ? t : 1 - t);
			widths.push(2 * hw);
			L.push([pt[0] - (dy / h) * hw, pt[1] + (dx / h) * hw]);
			Rt.push([pt[0] + (dy / h) * hw, pt[1] - (dx / h) * hw]);
		});
		// the collar end sits on the circle, as wide as the band is there
		const half = widths[n] / (2 * R);
		const e1 = [B[0] + R * Math.cos(p - half), B[1] + R * Math.sin(p - half)];
		const e2 = [B[0] + R * Math.cos(p + half), B[1] + R * Math.sin(p + half)];
		// match each edge to the nearer collar point so the ribbon does not twist
		const near =
			Math.hypot(L[n - 1][0] - e1[0], L[n - 1][1] - e1[1]) < Math.hypot(L[n - 1][0] - e2[0], L[n - 1][1] - e2[1]);
		L[n] = near ? e1 : e2;
		Rt[n] = near ? e2 : e1;
		const xy = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
		return { k, v, widths, d: `M${L.map(xy).join("L")}L${Rt.reverse().map(xy).join("L")}Z` };
	});
	return { R, bands };
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
	const me = { ks: partners, name: meta.countries[sel.who], v: sum.total, me: true };
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
	const xL = inDir ? 132 : 6;
	const xM = 214;
	const xR = inDir ? width - nw - 6 : 330;
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
export function parseView(search, { runs, indicators, codes }) {
	const q = new URLSearchParams(search);
	const scenario = q.get("scenario");
	const indicator = Number(q.get("indicator"));
	const region = q.get("region");
	const sections = (q.get("sections") ?? "")
		.split(",")
		.filter((x) => /^\d+$/.test(x))
		.map(Number)
		.filter((x) => x < SECTION_SHORT.length);
	const panel = q.get("panel");
	const named = runs.filter((r) => r !== "baseline");
	return {
		mode: q.get("mode") === "whatif" ? "whatif" : "flows",
		run: named.includes(scenario) ? scenario : named[0],
		indicator: indicators.includes(indicator) ? indicator : indicators[0],
		who: Math.max(0, codes.indexOf(codes.includes(region) ? region : "DE")),
		dir: q.get("dir") === "out" ? "out" : "in",
		on: new Set(sections.length ? sections : SECTION_SHORT.keys()),
		globe: q.get("map") === "globe",
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
	set("map", v.globe ? "globe" : null);
	set("panel", v.panel);
	const s = `${q}`.replace(/%2C/g, ",");
	return s ? `?${s}` : "";
}

// --- the five continents ----------------------------------------------------------

// Released in each continent, over every consumer, for the selected sections:
// [{name, base, change}] in the display unit (change 0 without a run). With
// every section on, these are the run's continental totals in results.json.
export function continents(meta, base, delta, sel) {
	const f = wording(sel.id).factor;
	const N = meta.countries.length;
	return CONTINENTS.map((name) => {
		let b = 0;
		let d = 0;
		for (const country of meta.aggregates[name] ?? []) {
			const p = meta.countries.indexOf(country);
			for (const q of sel.on)
				for (let c = 0; c < N; c++) {
					const i = at(meta, sel.ind, p, q, c);
					b += base[i];
					if (delta) d += delta[i];
				}
		}
		return { name, base: f * b, change: f * d };
	});
}
