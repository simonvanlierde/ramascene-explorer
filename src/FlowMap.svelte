<script>
// The map card: regions filled by the selection, tapered bands for the
// largest flows meeting at the selected country, Flat/Globe, the legend and,
// in What if…, the scrubber from the 2011 baseline to the run.
import {
	geoDistance,
	geoEqualEarth,
	geoEqualEarthRaw,
	geoInterpolate,
	geoOrthographicRaw,
	geoPath,
	geoProjectionMutator,
} from "d3-geo";
import { untrack } from "svelte";
import { cubicInOut } from "svelte/easing";
import { merge } from "topojson-client";
import {
	amountShort,
	amountText,
	arc,
	BAND,
	bandGeometry,
	bandPartners,
	changeArm,
	divBand,
	divFill,
	flowPct,
	LAND,
	pct,
	placeName,
	possessive,
	SEA,
	SECTION_COLOURS,
	SECTION_SHORT,
	SELF,
	seqScale,
	share,
	taperGlyph,
	theName,
	wording,
} from "../flows.js";
import { regionForIso } from "../map.js";
import { reducedMotion, ui } from "./view.svelte.js";

let { meta, sum, whatif, extent, play, stop, loadingRun, retry } = $props();

// --- geometry: the 49 regions merged from Natural Earth countries -----------------
let shapes = $state.raw([]);
// where a region's label and bands meet, where its centroid misleads
const ANCHOR = { WA: [100, 20], WL: [-62, -12], US: [-98, 39], WF: [20, 2], WM: [45, 25], WE: [25, 47], NO: [9, 61], FR: [2.5, 46.5], RU: [60, 58], CA: [-100, 56] };
fetch("geo/countries-110m.topo.json")
	.then((r) => r.json())
	.then((topo) => {
		const geoms = topo.objects.countries.geometries;
		shapes = meta.country_codes.map((code, i) => {
			const geometry = merge(topo, geoms.filter((g) => regionForIso(g.properties.iso, meta.country_codes) === code));
			const feature = { type: "Feature", geometry };
			return { i, code, feature, at: ANCHOR[code] ?? geoPath().centroid(feature) };
		});
	});

// --- projection: Equal Earth morphing into an orthographic globe -------------------
let W = $state(0);
let H = $state(0);
let alpha = $state(ui.globe ? 1 : 0);
let rot = $state([0, 0]);
// zoom on top of the fitted map, and the flat map's pan in px (the globe pans by turning)
let zk = $state(1);
let off = $state([0, 0]);
const ZMAX = 8;
const mutate = geoProjectionMutator((a) => (x, y) => {
	const p = geoEqualEarthRaw(x, y);
	const q = geoOrthographicRaw(x, y);
	return [p[0] + a * (q[0] - p[0]), p[1] + a * (q[1] - p[1])];
});
const proj = mutate(0);
const path = geoPath(proj);
const TOP = 52; // room for the chips above the map
const view = $derived.by(() => {
	const w = Math.max(W, 320);
	const h = Math.max(H, 260);
	const flat = geoEqualEarth().fitExtent([[16, TOP], [w - 16, h - 12]], { type: "Sphere" });
	const k1 = Math.min(w - 32, h - TOP - 12) / 2;
	const t0 = flat.translate();
	const t1 = [w / 2, TOP + (h - TOP - 12) / 2];
	const t = [t0[0] + alpha * (t1[0] - t0[0]), t0[1] + alpha * (t1[1] - t0[1])];
	mutate(alpha);
	proj
		.scale((flat.scale() + alpha * (k1 - flat.scale())) * zk)
		.translate([t[0] + off[0], t[1] + off[1]])
		.rotate([rot[0] * alpha, rot[1] * alpha])
		.clipAngle(alpha > 0.02 ? Math.max(90, 179.9 - alpha * 89.9) : null)
		.precision(0.3);
	return { w, h, t, scale: Math.min(1.4, Math.max(0.8, w / 700)) };
});
const centre = () => [-rot[0] * alpha, -rot[1] * alpha];
const visible = (ll) => alpha < 0.5 || geoDistance(ll, centre()) < Math.PI / 2 - 0.04;
const regionPaths = $derived((view, shapes.map((s) => path(s.feature) ?? "")));
const sphere = $derived((view, path({ type: "Sphere" })));

// --- colour -------------------------------------------------------------------
const hi = $derived(Math.max(...sum.others.map((k) => sum.vals[k]), 1e-12));
const lo = $derived(hi / 1000);
const seq = $derived(seqScale(lo, hi));
const ff = $derived(divFill(extent));
const fb = $derived(divBand(extent));
const oneSection = $derived(ui.on.size === 1 ? [...ui.on][0] : null);
function fillOf(k) {
	if (whatif) {
		const p = flowPct(sum, k);
		return p === null ? LAND : ff(p * ui.s);
	}
	if (k === ui.who) return SELF;
	return sum.vals[k] < lo / 10 ? LAND : seq(sum.vals[k]);
}
const bandColour = (k) =>
	whatif ? fb((flowPct(sum, k) ?? 0) * ui.s) : oneSection !== null ? SECTION_COLOURS[oneSection] : BAND;

// --- bands and labels -----------------------------------------------------------
const STEPS = Array.from({ length: 31 }, (_, i) => i / 30);
const anchors = $derived(shapes.map((s) => s.at));
const widthK = $derived((13 * view.scale) / (sum.vals[sum.bands[0]] || 1));
const geom = $derived.by(() => {
	view;
	if (!shapes.length) return { R: 0, bands: [], B: [0, 0] };
	const self = shapes[ui.who].at;
	const B = proj(self);
	const lines = [];
	for (const k of bandPartners(sum.bands, ui.who, anchors)) {
		const A = shapes[k].at;
		let P;
		if (alpha > 0.5) {
			const ip = geoInterpolate(A, self);
			// a partner over the horizon: its band starts where the great circle comes into view
			const t0 = STEPS.find((t) => visible(ip(t))) ?? 1;
			P = STEPS.map((t) => proj(ip(t0 + (1 - t0) * t)));
		} else P = arc(proj(A), B);
		if (P.some((p) => !p)) continue;
		lines.push({ k, v: sum.vals[k], P });
	}
	return { ...bandGeometry(lines, B, { k: widthK, dir: ui.dir }), B, shown: visible(self) };
});
// The boxes of what floats on the map (the chips, the zoom, the legend and the
// note), in view px, so no label goes under them.
let mapv = $state();
let blocks = $state.raw([]);
$effect(() => {
	const host = mapv;
	if (!host) return;
	const els = host.parentElement.querySelectorAll(".mtl, .mtr, .mzm, .lg, .mnote");
	const measure = () => {
		const r = host.getBoundingClientRect();
		blocks = [...els]
			.map((e) => e.getBoundingClientRect())
			.filter((b) => b.width && b.bottom > r.top && b.top < r.bottom)
			.map((b) => [b.left - r.left, b.top - r.top, b.right - r.left, b.bottom - r.top]);
	};
	const ro = new ResizeObserver(measure);
	ro.observe(host);
	for (const e of els) ro.observe(e);
	return () => ro.disconnect();
});
const hits = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
const labels = $derived.by(() => {
	const placed = [...blocks];
	const out = [];
	for (const b of [...geom.bands].sort((x, y) => y.v - x.v)) {
		const p = proj(shapes[b.k].at);
		if (!p || !visible(shapes[b.k].at)) continue;
		const t = placeName(meta, b.k);
		const w = t.length * 5.6 + 6;
		const box = [p[0] - w / 2, p[1] - 13, p[0] + w / 2, p[1] + 8];
		if (box[0] < 4 || box[2] > view.w - 4 || box[1] < 4 || box[3] > view.h - 4) continue;
		if (placed.some((q) => hits(box, q))) continue;
		placed.push(box);
		const fp = flowPct(sum, b.k);
		out.push({ k: b.k, t, x: p[0], y: p[1] - 3, sub: whatif ? (fp === null ? "–" : pct(fp)) : amountShort(b.v, ui.indicator) });
		if (out.length > 6) break;
	}
	return out;
});

// --- the bands arriving --------------------------------------------------------------
// Each new question in Flows reveals the bands along the flow: from the map's
// edge onto the country when it consumes, out from it when it releases. A soft
// radial mask does it, so the bands never have to be redrawn.
let reveal = $state(1); // 0 hidden, 1 shown
let revealFrame = 0;
$effect(() => {
	[ui.who, ui.dir, ui.indicator, ui.on, ui.mode];
	if (ui.mode !== "flows" || reducedMotion()) return;
	cancelAnimationFrame(revealFrame);
	const t0 = performance.now();
	const step = (now) => {
		const p = Math.min(1, (now - t0) / 800);
		reveal = cubicInOut(p); // the sweep crosses the bands evenly
		if (p < 1) revealFrame = requestAnimationFrame(step);
	};
	reveal = 0;
	revealFrame = requestAnimationFrame(step);
	return () => cancelAnimationFrame(revealFrame);
});
const reach = $derived(Math.hypot(view.w, view.h));
// in: a hole that closes from the edge onto the country; out: a disc that grows from it
const revealR = $derived(ui.dir === "in" ? (1 - reveal) * reach * 1.15 : reveal * reach * 1.15 + 1);

// --- interaction ------------------------------------------------------------------
let tween = 0;
function animate(ms, stepFn) {
	cancelAnimationFrame(tween);
	if (reducedMotion()) return stepFn(1);
	const t0 = performance.now();
	const frame = (now) => {
		const p = Math.min(1, (now - t0) / ms);
		stepFn(cubicInOut(p));
		if (p < 1) tween = requestAnimationFrame(frame);
	};
	tween = requestAnimationFrame(frame);
}
const facing = (ll) => [-ll[0], -Math.max(-40, Math.min(40, ll[1]))];
function setGlobe(g) {
	ui.globe = g;
	zk = 1;
	off = [0, 0];
	if (g && shapes.length) rot = facing(shapes[ui.who].at);
	const from = alpha;
	animate(900, (t) => (alpha = from + t * ((g ? 1 : 0) - from)));
}
function turnTo(ll) {
	if (alpha < 0.5) return;
	const [a, b] = [rot, facing(ll)];
	animate(800, (t) => (rot = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
}
// centre the globe on the selection once the shapes are in
$effect(() => {
	if (shapes.length && ui.globe && rot[0] === 0 && rot[1] === 0) rot = facing(shapes[ui.who].at);
});
const pick = (k) => (ui.who = k);

// --- zoom ----------------------------------------------------------------------
// Keeps the flat map covering the view: at zoom k it may move (k - 1) half-views.
function clampOff([x, y]) {
	const mx = ((zk - 1) * view.w) / 2;
	const my = ((zk - 1) * view.h) / 2;
	return [Math.max(-mx, Math.min(mx, x)), Math.max(-my, Math.min(my, y))];
}
// Zoom by f about the point p (view px) on the flat map, or about the centre of the globe.
function zoomAt(f, p = [view.w / 2, view.h / 2]) {
	const k = Math.max(1, Math.min(ZMAX, zk * f));
	const r = k / zk;
	const [tx, ty] = [view.t[0] + off[0], view.t[1] + off[1]];
	zk = k;
	off = alpha < 0.5 ? clampOff([p[0] - (p[0] - tx) * r - view.t[0], p[1] - (p[1] - ty) * r - view.t[1]]) : [0, 0];
}
// the reset button goes once the map is whole, so focus moves to Zoom in
const resetZoom = (group) => {
	zk = 1;
	off = [0, 0];
	group.querySelector("button").focus();
};
// the Try again button goes while the run loads; the sentence is where it lands
const retryHere = () => {
	retry();
	document.getElementById("headline")?.focus();
};
// the buttons zoom toward the selected country, so it stays where it is
const towardSelection = () => (alpha < 0.5 && geom.B ? geom.B : undefined);
let svgEl = $state();
const local = (x, y) => {
	const r = svgEl.getBoundingClientRect();
	return [x - r.left, y - r.top];
};
// the phone layout, where the page scrolls past the map
const narrow = matchMedia("(max-width: 760px)");
// a wheel listener has to be non-passive to keep the page from scrolling
$effect(() => {
	const el = svgEl;
	if (!el) return;
	const wheel = (e) => {
		// A trackpad pinch arrives with ctrlKey. Without it the page keeps the wheel
		// where it scrolls (the phone layout), and when zooming out at the floor.
		const zoomKey = e.ctrlKey || e.metaKey;
		if (!zoomKey && (narrow.matches || (zk <= 1 && e.deltaY > 0))) return;
		e.preventDefault();
		// deltaMode 1 counts lines (Firefox); a trackpad pinch arrives as a wheel with ctrlKey
		const d = e.deltaY * (e.deltaMode ? 33 : 1) * (e.ctrlKey ? 5 : 1);
		zoomAt(Math.exp(-d * 0.002), local(e.clientX, e.clientY));
	};
	el.addEventListener("wheel", wheel, { passive: false });
	return () => el.removeEventListener("wheel", wheel);
});
// The zoom lives in the link as the view's centre in degrees, so it opens on the
// same place at any screen size. It is written once the map stops moving.
const mid = () => [view.w / 2, (TOP + view.h) / 2];
const round = (x, d) => Number(x.toFixed(d));
let saveT = 0;
let restored = false;
$effect(() => {
	[zk, off, alpha];
	clearTimeout(saveT);
	saveT = setTimeout(() => {
		if (!restored) return; // a link's zoom is not applied yet
		if (zk === 1) return (ui.zoom = null);
		if (alpha > 0.5) return (ui.zoom = [round(zk, 2)]);
		view; // brings the projection up to date
		// the flat map's raw Equal Earth point under the centre (d3 flips y)
		const s = proj.scale();
		const [tx, ty] = proj.translate();
		const [lam, phi] = geoEqualEarthRaw.invert((mid()[0] - tx) / s, (ty - mid()[1]) / s);
		ui.zoom = [round(zk, 2), round((lam * 180) / Math.PI, 1), round((phi * 180) / Math.PI, 1)];
	}, 250);
	return () => clearTimeout(saveT);
});
// a link's zoom is applied once, when the map first has its shapes and size
$effect(() => {
	if (restored || !shapes.length || !W) return;
	restored = true;
	untrack(() => {
		const z = ui.zoom;
		if (!z) return;
		zk = z[0];
		if (alpha > 0.5 || z.length < 3) return;
		off = [0, 0];
		view;
		const p = proj([z[1], z[2]]);
		if (p) off = clampOff([mid()[0] - p[0], mid()[1] - p[1]]);
	});
});

// keep a newly selected country in view, whether picked on the map or in the
// country box: the globe turns to it, the zoomed flat map pans to it
$effect(() => {
	const k = ui.who;
	untrack(() => {
		if (!shapes.length) return;
		if (alpha > 0.5) return turnTo(shapes[k].at);
		if (zk === 1) return;
		view;
		const p = proj(shapes[k].at);
		if (p) off = clampOff([off[0] + mid()[0] - p[0], off[1] + mid()[1] - p[1]]);
	});
});

// One finger turns the globe or pans the zoomed flat map; two fingers zoom.
const pts = new Map();
// keeps a drag going outside the map; a pointer the browser no longer tracks
// throws (Firefox), and that must not stop the drag
function capture(id) {
	try {
		svgEl.setPointerCapture(id);
	} catch {}
}
let pinch = 0;
let drag = null;
function down(e) {
	pts.set(e.pointerId, [e.clientX, e.clientY]);
	if (pts.size === 2) {
		const [a, b] = [...pts.values()];
		pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
		if (drag) drag.moved = true;
		for (const id of pts.keys()) capture(id);
	}
	if (alpha < 0.5 && zk === 1 && pts.size < 2) return;
	drag ??= { x: e.clientX, y: e.clientY, moved: false };
}
function move(e) {
	if (!pts.has(e.pointerId)) return;
	pts.set(e.pointerId, [e.clientX, e.clientY]);
	if (pinch && pts.size === 2) {
		const [a, b] = [...pts.values()];
		const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
		zoomAt(d / pinch, local((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
		pinch = d;
		return;
	}
	if (!drag) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	// capture only once it is a drag: a captured pointer's click lands on the svg,
	// not on the region under it, and a plain click would select nothing
	if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) {
		drag.moved = true;
		capture(e.pointerId);
	}
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.dx = (drag.dx ?? 0) + dx;
	drag.dy = (drag.dy ?? 0) + dy;
	// pointer events come faster than frames: re-project once per frame. The frame
	// keeps its own reference, so a release before it runs still applies the turn.
	const d = drag;
	d.frame ||= requestAnimationFrame(() => {
		if (alpha > 0.5) rot = [rot[0] + (d.dx * 0.35) / zk, Math.max(-60, Math.min(60, rot[1] - (d.dy * 0.35) / zk))];
		else off = clampOff([off[0] + d.dx, off[1] + d.dy]);
		d.dx = d.dy = d.frame = 0;
	});
}
function up(e) {
	pts.delete(e.pointerId);
	if (pts.size < 2) pinch = 0;
	// the finger left on the glass carries on from where it is
	const [rest] = pts.values();
	if (rest && drag) [drag.x, drag.y] = rest;
	if (!pts.size) setTimeout(() => (drag = null));
}

// --- tooltip --------------------------------------------------------------------
let tip = $state(null);
function hover(e, k) {
	const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
	tip = { k, x: e.clientX - r.left, y: e.clientY - r.top };
}
const other = $derived(placeName(meta, ui.who));
// inside a phrase: "the United States"
const otherIn = $derived(theName(meta, ui.who));
const tipText = $derived.by(() => {
	if (!tip) return null;
	const k = tip.k;
	const v = sum.vals[k];
	const name = placeName(meta, k);
	const where =
		k === ui.who
			? ui.dir === "in"
				? "at home, for its own consumption"
				: "at home and consumed at home"
			: ui.dir === "in"
				? `here, for consumption in ${otherIn}`
				: `in ${otherIn}, for consumption here`;
	if (whatif) {
		const p = flowPct(sum, k);
		if (p === null) return { name, big: "–", line: `Almost no 2011 flow ${ui.dir === "in" ? `for ${otherIn}` : `from ${otherIn}`}` };
		return {
			name,
			big: pct(p),
			line: `${sum.dv[k] > 0 ? "+" : ""}${amountText(sum.dv[k], ui.indicator)} on a 2011 flow of ${amountText(v, ui.indicator)}, ${where}`,
		};
	}
	const secs = [...ui.on].map((q) => [q, sum.cell(k, q)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
	return { name, big: amountText(v, ui.indicator), line: `${where} · ${share(v, sum.total)}`, secs, v };
});

// --- scrubber -------------------------------------------------------------------
let track = $state();
const at = (e) => {
	const r = track.getBoundingClientRect();
	return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
};
function scrubKey(e) {
	const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.25, PageDown: -0.25 }[e.key];
	if (step == null && e.key !== "Home" && e.key !== "End") return;
	e.preventDefault();
	stop();
	ui.s = e.key === "Home" ? 0 : e.key === "End" ? 1 : Math.max(0, Math.min(1, ui.s + step));
}

// --- legend -----------------------------------------------------------------------
const ticks = $derived.by(() => {
	const out = [];
	for (let e = Math.ceil(Math.log10(lo)); 10 ** e <= hi; e++) out.push(10 ** e);
	// leave the right end to the unit
	return out.map((t) => ({ t, x: (Math.log(t / lo) / Math.log(hi / lo)) * 100 })).filter((t) => t.x <= 82);
});
const seqStops = $derived(Array.from({ length: 11 }, (_, i) => seq(lo * (hi / lo) ** (i / 10))).join(","));
// When every flow moves the same way, the legend shows only that arm of the ramp.
const arm = $derived(whatif ? changeArm(sum) : 0);
const divStops = $derived(
	Array.from({ length: 11 }, (_, i) => {
		const t = arm === 0 ? 2 * (i / 10) - 1 : arm < 0 ? i / 10 - 1 : i / 10;
		return ff(Math.sign(t) * extent * t * t);
	}).join(","),
);
const divTicks = $derived.by(() => {
	const m = extent;
	const q = +(extent / 4).toPrecision(2);
	if (arm < 0) return [`−${m}%`, `−${q}%`, "0%"];
	if (arm > 0) return ["0%", `+${q}%`, `+${m}%`];
	return [`−${m}%`, `−${q}%`, "0%", `+${q}%`, `+${m}%`];
});
const glyphs = $derived.by(() => {
	const a0 = sum.vals[sum.bands[0]] ?? 0;
	const a1 = Number((a0 / 5).toPrecision(1));
	return [a1, a0].filter((v) => v > 0);
});
const tickText = (t) => (t >= 1e6 ? `${t / 1e6}M` : t >= 1000 ? `${t / 1000}k` : String(t));
const unit = $derived(wording(ui.indicator).unit);
</script>

<div class="mapc" class:globe={ui.globe}>
	<!-- the map and what sits on it; the legend goes under it on a phone -->
	<div class="mapv" bind:this={mapv} bind:clientWidth={W} bind:clientHeight={H}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions: the globe drags with a pointer; the country box is the keyboard path -->
		<svg
			bind:this={svgEl}
			class="map"
			class:globe={alpha > 0.5}
			class:zoomed={zk > 1}
			class:live={!whatif}
			viewBox="0 0 {view.w} {view.h}"
			role="img"
			aria-label="Map of {sum.bands.length} flows {ui.dir === 'in' ? `into ${otherIn}${possessive(other)} consumption` : `out of ${otherIn}`}; the table in Details lists every flow"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		>
			<path d={sphere} fill={SEA} stroke={alpha > 0.02 ? "var(--rule)" : "none"} />
			<g class="rgs">
				{#each shapes as s (s.code)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: mouse shortcut for the country box -->
					<path
						class="rg"
						class:sel={s.i === ui.who}
						data-region={s.code}
						d={regionPaths[s.i]}
						fill={fillOf(s.i)}
						onmousemove={(e) => hover(e, s.i)}
						onmouseleave={() => (tip = null)}
						onclick={() => !drag?.moved && pick(s.i)}
					/>
				{/each}
			</g>
			{#if reveal < 1}
				<defs>
					<radialGradient id="reveal-g" gradientUnits="userSpaceOnUse" cx={geom.B[0]} cy={geom.B[1]} r={revealR}>
						<stop offset="0.8" stop-color={ui.dir === "in" ? "#000" : "#fff"} />
						<stop offset="1" stop-color={ui.dir === "in" ? "#fff" : "#000"} />
					</radialGradient>
					<mask id="reveal" maskUnits="userSpaceOnUse" x="0" y="0" width={view.w} height={view.h}>
						<rect width={view.w} height={view.h} fill="url(#reveal-g)" />
					</mask>
				</defs>
			{/if}
			<g class="bands" mask={reveal < 1 ? "url(#reveal)" : undefined}>
				{#each geom.bands as b (b.k)}<path d={b.d} fill={bandColour(b.k)} data-region={meta.country_codes[b.k]} />{/each}
			</g>
			{#if geom.R}<circle class="ring" cx={geom.B[0]} cy={geom.B[1]} r={geom.R} opacity={geom.shown ? 1 : 0} />{/if}
			<g class="lbls">
				{#each labels as l (l.k)}
					<text x={l.x} y={l.y} text-anchor="middle">{l.t}</text>
					<text class="b" x={l.x} y={l.y + 10} text-anchor="middle">{l.sub}</text>
				{/each}
			</g>
		</svg>

		<div class="mtl">
			<div class="sel-chip">
				<span class="sw"></span><span>{other}</span>
				<button type="button" onclick={() => (ui.panel = "sankey")} aria-label="Details for {other}: Sankey, table and method">
					Details
					<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
			</div>
		</div>
		<div class="mtr">
			<div class="seg" role="group" aria-label="Map projection">
				<button type="button" aria-pressed={!ui.globe} onclick={() => setGlobe(false)}>Flat</button>
				<button type="button" aria-pressed={ui.globe} onclick={() => setGlobe(true)}>Globe</button>
			</div>
		</div>
		<div class="seg mzm" role="group" aria-label="Zoom">
			<button type="button" aria-label="Zoom in" aria-disabled={zk >= ZMAX} onclick={() => zoomAt(2, towardSelection())}>
				<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			</button>
			<button type="button" aria-label="Zoom out" aria-disabled={zk <= 1} onclick={() => zoomAt(0.5, towardSelection())}>
				<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			</button>
			{#if zk > 1}
				<button type="button" aria-label="Reset zoom" onclick={(e) => resetZoom(e.currentTarget.parentElement)}>
					<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
			{/if}
		</div>

		<p class="mnote">
			{#if whatif}
				Bands keep their 2011 width; their colour and the fill are the % change in each flow in this run, shown {Math.round(ui.s * 100)}% of the way from the 2011 baseline. An engine run on 2011 data, not a forecast.
			{:else}
				Bands: the {geom.bands.length} largest flows {ui.dir === "in" ? `into ${otherIn}${possessive(other)} consumption` : `out of ${otherIn}`}, width ∝ {unit}{oneSection !== null ? `, ${SECTION_SHORT[oneSection].toLowerCase()} only` : ""}. Fill: {unit} per region. {alpha > 0.5 ? "Drag to turn the globe, scroll or pinch to zoom." : "Scroll or pinch to zoom."}
			{/if}
		</p>

		{#if tipText}
			<div class="tip" style="left:{Math.min(tip.x + 14, view.w - 234)}px;top:{Math.max(8, Math.min(tip.y - 12, view.h - 150))}px" aria-hidden="true">
				<b>{tipText.name}</b><span class="tv">{tipText.big}</span><br />{tipText.line}
				{#if tipText.secs?.length}
					<div class="sb">{#each tipText.secs as [q, x] (q)}<i style="width:{(x / tipText.v) * 100}%;background:{SECTION_COLOURS[q]}"></i>{/each}</div>
					<span class="sw" style="background:{SECTION_COLOURS[tipText.secs[0][0]]}"></span>Largest: {SECTION_SHORT[tipText.secs[0][0]]}, {share(tipText.secs[0][1], tipText.v)}
				{/if}
				<br /><span class="hint">Click to select</span>
			</div>
		{/if}
	</div>
	<div class="lg">
		{#if whatif}
			<div class="lt">Change in each 2011 flow, %{arm < 0 ? " (all decreases)" : arm > 0 ? " (all increases)" : ""}</div>
			<div>
				<div class="gb" style="background:linear-gradient(90deg,{divStops})"></div>
				<div class="tk num">{#each divTicks as t (t)}<span>{t}</span>{/each}</div>
			</div>
			<p class="fn">Square-root scale; 90% of flows within ±{extent}%, larger ones in the end colour. Band width: 2011 {unit}.</p>
			<div class="scrub">
				<span>2011</span>
				<!-- svelte-ignore a11y_no_static_element_interactions: the thumb inside is the keyboard control -->
				<div
					class="tr"
					bind:this={track}
					onpointerdown={(e) => {
						stop();
						e.currentTarget.setPointerCapture(e.pointerId);
						ui.s = at(e);
						e.currentTarget.firstElementChild.focus();
					}}
					onpointermove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && (ui.s = at(e))}
				>
					<div
						class="th"
						role="slider"
						tabindex="0"
						aria-label="From the 2011 baseline to the run"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={Math.round(ui.s * 100)}
						aria-valuetext={ui.s === 0 ? "2011 baseline" : `${Math.round(ui.s * 100)}% of the run`}
						style="left:{ui.s * 100}%"
						onkeydown={scrubKey}
					></div>
				</div>
				<span>run</span>
				<button type="button" class="play" onclick={play}>
					<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>
					Replay
				</button>
			</div>
		{:else}
			<div class="lt">{ui.dir === "in" ? `${wording(ui.indicator).made.here} what ${otherIn} consumes` : `Consumed here, made in ${otherIn}`}</div>
			<div>
				<div class="gb" style="background:linear-gradient(90deg,{seqStops})"></div>
				<div class="tk num ticks">
					{#each ticks as t (t.t)}<span style="left:{t.x}%">{tickText(t.t)}</span>{/each}
					<span class="u">{amountShort(1, ui.indicator).replace(/^\S+ /, "")}</span>
				</div>
			</div>
			<div class="aw">
				{#each glyphs as g (g)}
					<svg width="50" height="18" aria-hidden="true"><path d={taperGlyph(g, widthK, 48, ui.dir)} fill={oneSection !== null ? SECTION_COLOURS[oneSection] : BAND} fill-opacity=".76" /></svg>
					<span class="num">{amountShort(g, ui.indicator)}</span>
				{/each}
			</div>
		{/if}
		<!-- always there, so the text it gets is read out; the sidebar shows the same note -->
		<p class="fn runnote" role="status">{#if loadingRun.startsWith("failed:") && ui.mode === "whatif"}That run could not be loaded. <button type="button" class="chipb" onclick={retryHere}>Try again</button> or pick another.{:else if loadingRun && ui.mode === "whatif"}Loading the run’s flows…{/if}</p>
	</div>

</div>
