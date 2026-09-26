// DOM side of the map (and the Sankey): builds SVG from the pure logic in
// map.js and sankey.js. index.html calls loadVisuals once, then the render
// functions on every change of the selection.

import { fmtPct, formatValue, signed } from "./explorer.js";
import {
	classFill,
	classify,
	decodeTopology,
	divergingExtent,
	EXIOBASE_REGIONS,
	isRestOf,
	legendClasses,
	project,
	REST_OF,
	regionForIso,
	regionValues,
} from "./map.js";
import { SECTOR_SHORT, sankeyLayout, tween } from "./sankey.js";

const SVG = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, text) => {
	const node = attrs.svg
		? document.createElementNS(SVG, tag)
		: document.createElement(tag);
	for (const [k, v] of Object.entries(attrs))
		if (k !== "svg" && v !== undefined) node.setAttribute(k, v);
	if (text !== undefined) node.textContent = text;
	return node;
};
const svgEl = (tag, attrs, text) => el(tag, { svg: 1, ...attrs }, text);
const $ = (id) => document.getElementById(id);

let features = null;
let geometry = { width: 0 };
let current = null; // the latest render context, for the event handlers

// Fetch a JSON document; null when absent or unreadable (the sidecars are optional).
async function fetchJson(url) {
	try {
		const response = await fetch(url, { cache: "no-cache" });
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
}

// The sidecars sit next to results.json and must come from the same dataset
// files; anything else is not shown next to it.
export async function loadVisuals(dataPath, data) {
	const topo = await fetchJson("geo/countries-110m.topo.json");
	features = topo ? decodeTopology(topo, "countries") : null;
	if (!dataPath.endsWith("results.json")) return {};
	const same = (doc) =>
		doc &&
		doc.data_kind === data.data_kind &&
		JSON.stringify(doc.provenance?.dataset?.sha256) ===
			JSON.stringify(data.provenance?.dataset?.sha256);
	const [regions, flows] = await Promise.all(
		["regions.json", "flows.json"].map((n) =>
			fetchJson(dataPath.replace(/results\.json$/, n)),
		),
	);
	return {
		regions: same(regions) ? regions : null,
		flows: same(flows) ? flows : null,
	};
}

// --- map ------------------------------------------------------------------------

export function renderMap(ctx) {
	current = ctx;
	const { data, docs, state, indicator } = ctx;
	const section = $("map-section");
	if (!features) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	// the 49-region sidecar when it has this scenario, else the continental aggregates
	const detailed =
		docs.regions && regionValues(docs.regions, state, indicator.factor);
	const view = detailed ?? regionValues(data, state, indicator.factor);
	const source = detailed ? docs.regions : data;
	const values = ctx.baselineView
		? Object.fromEntries(
				Object.entries(view.values).map(([k, v]) => [
					k,
					{ ...v, delta: 0, percent: 0, scenario: v.baseline },
				]),
			)
		: view.values;
	const extent = divergingExtent(
		Object.values(view.values).map((v) => v.percent),
	);

	const svg = $("map");
	const width = Math.max(320, svg.clientWidth || 960);
	if (geometry.width !== width)
		geometry = { width, ...project(features, width) };
	svg.setAttribute("viewBox", `0 0 ${width} ${geometry.height}`);
	svg.setAttribute("height", geometry.height);
	if (svg.dataset.width !== String(width)) {
		svg.replaceChildren();
		buildMap(svg);
	}
	svg.dataset.width = width;

	for (const path of svg.querySelectorAll("path.country")) {
		const code = path.dataset.code;
		const v = values[code];
		path.style.fill = classFill(v ? classify(v.percent, extent) : null);
		path.classList.toggle("selected", code === state.region);
	}
	for (const path of svg.querySelectorAll("path.hatch")) {
		// every country shares a value with others: all of them at aggregate level
		path.hidden = !(view.level === "aggregate" || isRestOf(path.dataset.code));
		path.classList.toggle("selected", path.dataset.code === state.region);
	}
	svg._values = values;
	svg._unit = indicator.unit;

	const percents = Object.values(view.values).map((v) => v.percent ?? 0);
	drawLegend(
		extent,
		view.level,
		Math.min(0, ...percents) < 0,
		Math.max(0, ...percents) > 0,
	);
	const scenario = data.scenarios.find((s) => s.id === state.scenario);
	$("map-caption").textContent =
		`Change in ${indicator.name} by region where the impact occurs, as a percentage of that region's own ${data.base_year} baseline: ` +
		`${scenario.label}${ctx.baselineView ? " (showing the baseline: no change)" : ""}. ` +
		(view.level === "region"
			? "44 EXIOBASE countries and 5 rest-of-world aggregates; a hatched area is one of those aggregates, so all its countries share one value. "
			: "This scenario has no 49-region breakdown here, so every country shows its continental aggregate (all hatched). ") +
		"Which countries a rest-of-world aggregate covers follows Natural Earth continents; EXIOBASE's own list may differ at the edges (Greenland, the Caucasus, Central Asia). " +
		"Malta is too small to draw at this scale; N. Cyprus is not assigned. Values for every region are in the table below the map.";
	$("map-source").textContent = detailed
		? `Source: ${source.breakdown}. Engine ${source.provenance.engine.branch ?? ""} ${String(source.provenance.engine.commit).slice(0, 12)}.`
		: `Source: ${source.breakdown}.`;

	drawMapTable(view, indicator.unit, state.region);
	const select = $("map-region");
	if (!select.options.length) {
		select.append(el("option", { value: "" }, "None"));
		for (const r of EXIOBASE_REGIONS)
			select.append(el("option", { value: r.code }, r.name));
		select.addEventListener("change", () =>
			current.onSelect(select.value || null),
		);
	}
	select.value = state.region ?? "";
}

function buildMap(svg) {
	const defs = svg.appendChild(svgEl("defs"));
	const pattern = defs.appendChild(
		svgEl("pattern", {
			id: "hatch",
			width: 6,
			height: 6,
			patternUnits: "userSpaceOnUse",
			patternTransform: "rotate(45)",
		}),
	);
	pattern.append(
		svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }),
	);
	const fills = svg.appendChild(svgEl("g"));
	const hatches = svg.appendChild(svgEl("g", { "aria-hidden": "true" }));
	features.forEach((f, i) => {
		const code = regionForIso(f.iso);
		const attrs = {
			d: geometry.paths[i],
			"data-code": code ?? "",
			"data-name": f.name,
		};
		fills.append(svgEl("path", { ...attrs, class: "country" }));
		if (code)
			hatches.append(
				svgEl("path", { ...attrs, class: "hatch", fill: "url(#hatch)" }),
			);
	});
	if (svg._wired) return;
	svg._wired = true;
	const tip = $("map-tip");
	const show = (event) => {
		const path = event.target.closest?.("path.country");
		if (!path) {
			tip.hidden = true;
			return;
		}
		const code = path.dataset.code;
		const v = svg._values?.[code];
		tip.replaceChildren();
		if (!code)
			tip.append(
				el("strong", {}, path.dataset.name),
				el("span", {}, "Not assigned to an EXIOBASE region"),
			);
		else if (!v)
			tip.append(
				el("strong", {}, path.dataset.name),
				el("span", {}, "No value"),
			);
		else {
			const region = EXIOBASE_REGIONS.find((r) => r.code === code);
			const shared =
				v.level === "aggregate"
					? `${region.aggregate}, continental aggregate`
					: isRestOf(code)
						? `${region.name}, one value for ${REST_OF[code].split(" ").length} mapped countries`
						: region.name;
			tip.append(
				el("strong", {}, `${fmtPct(v.percent)}`),
				el(
					"span",
					{},
					`${signed(v.delta, svg._unit)} ${svg._unit}, of ${formatValue(v.baseline, svg._unit)}`,
				),
				el("span", {}, `${path.dataset.name} · ${shared}`),
			);
		}
		const box = svg.getBoundingClientRect();
		const x = event.clientX - box.left;
		const y = event.clientY - box.top;
		tip.hidden = false;
		tip.style.left = `${Math.min(x + 12, box.width - tip.offsetWidth - 4)}px`;
		tip.style.top = `${y + 16}px`;
	};
	svg.addEventListener("pointermove", show);
	svg.addEventListener("pointerleave", () => {
		tip.hidden = true;
	});
	svg.addEventListener("click", (event) => {
		const code = event.target.closest?.("path.country")?.dataset.code;
		if (code) current.onSelect(code === current.state.region ? null : code);
	});
}

// Only the arms the data reach: a map of decreases lists no red classes.
function drawLegend(extent, level, negatives, positives) {
	const legend = $("map-legend");
	legend.replaceChildren();
	const fmt = (v) => fmtPct(v).replace("−", "-").replace("-", "−");
	const swatches = el("div", { class: "legend-scale" });
	for (const row of legendClasses(extent).filter(
		(r) => (r.cls >= 0 || negatives) && (r.cls <= 0 || positives),
	)) {
		const item = el("span", { class: "legend-item" });
		item.append(
			el("span", {
				class: "swatch",
				style: `background:${classFill(row.cls)}`,
			}),
			el(
				"span",
				{},
				row.cls === 0
					? `within ±${fmtPct(row.to).replace("+", "")}`
					: `${fmt(row.from)} to ${fmt(row.to)}`,
			),
		);
		swatches.append(item);
	}
	const hatch = el("span", { class: "legend-item" });
	hatch.append(
		el("span", { class: "swatch hatched" }),
		el(
			"span",
			{},
			level === "region"
				? "rest-of-world aggregate (one value)"
				: "continental aggregate (one value)",
		),
	);
	const none = el("span", { class: "legend-item" });
	none.append(
		el("span", { class: "swatch", style: "background:var(--map-nodata)" }),
		el("span", {}, "not assigned"),
	);
	legend.append(swatches, el("div", { class: "legend-extra" }));
	legend.lastChild.append(hatch, none);
}

function drawMapTable(view, unit, selected) {
	const table = $("map-table");
	table.replaceChildren();
	const head = el("tr");
	for (const h of [
		"Region",
		"Level",
		`Baseline (${unit})`,
		`Change (${unit})`,
		"Change %",
	])
		head.append(el("th", { scope: "col" }, h));
	table.appendChild(el("thead")).append(head);
	const body = table.appendChild(el("tbody"));
	const rows = EXIOBASE_REGIONS.filter((r) => view.values[r.code]).map((r) => ({
		r,
		v: view.values[r.code],
	}));
	// one row per distinct value: an aggregate-level view lists the five aggregates once
	const seen = new Set();
	rows.sort((a, b) => a.v.delta - b.v.delta);
	for (const { r, v } of rows) {
		const key = view.level === "aggregate" ? r.aggregate : r.code;
		if (seen.has(key)) continue;
		seen.add(key);
		const tr = body.appendChild(
			el(
				"tr",
				r.code === selected
					? { class: "selected", "aria-current": "true" }
					: {},
			),
		);
		tr.append(
			el(
				"th",
				{ scope: "row" },
				view.level === "aggregate" ? r.aggregate : r.name,
			),
		);
		const level =
			view.level === "aggregate"
				? "continental aggregate"
				: isRestOf(r.code)
					? "rest-of-world aggregate"
					: "country";
		for (const text of [
			level,
			formatValue(v.baseline, unit),
			signed(v.delta, unit),
			fmtPct(v.percent),
		])
			tr.append(el("td", {}, text));
	}
}

// --- Sankey -----------------------------------------------------------------------

const short = (id) => SECTOR_SHORT[id] ?? id;

export function renderSankey(ctx, t = 1) {
	const { docs, state, indicator } = ctx;
	const regionName = EXIOBASE_REGIONS.find(
		(r) => r.code === state.region,
	)?.name;
	const section = $("sankey-section");
	const result = docs.flows?.results?.[state.scenario]?.[state.indicator];
	if (!result) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	const f = indicator.factor;
	const flows = result.flows.map((x) => ({ ...x, delta: x.delta * f }));
	const unit = indicator.unit;
	const svg = $("sankey");
	const width = Math.max(320, svg.clientWidth || 960);
	const narrow = width < 560;
	const labelW = narrow ? 118 : 250;
	const rows = Math.max(
		new Set(flows.map((x) => x.sector)).size,
		new Set(flows.map((x) => x.region)).size,
	);
	const height = Math.max(narrow ? 420 : 380, rows * (narrow ? 38 : 34));
	const scaleAbs = flows.reduce((s, x) => s + Math.abs(x.delta), 0);
	const layout = sankeyLayout(t === 1 ? flows : tween(flows, t), {
		width,
		height,
		left: labelW,
		right: labelW,
		nodeWidth: narrow ? 8 : 12,
		gap: narrow ? 12 : 10,
		scaleAbs,
	});
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("height", height);
	svg.replaceChildren();
	const add = (parent, tag, attrs, text) =>
		parent.appendChild(svgEl(tag, attrs, text));
	const bands = add(svg, "g", {});
	for (const l of layout.links) {
		const path = add(bands, "path", {
			d: l.path,
			class: `band ${l.delta < 0 ? "decrease" : "increase"}${l.region === regionName ? " selected" : ""}`,
		});
		path.append(
			svgEl(
				"title",
				{},
				`${l.sector} → ${l.region}: ${signed(l.delta, unit)} ${unit}${l.named ? "" : ` (${l.cells} cells lumped)`}`,
			),
		);
	}
	const nodes = add(svg, "g", {});
	const labels = (list, anchorLeft) => {
		let floor = -Infinity;
		for (const n of list) {
			add(nodes, "rect", {
				x: n.x0,
				y: n.y0,
				width: n.x1 - n.x0,
				height: Math.max(1, n.y1 - n.y0),
				class: "node",
			});
			// labels keep a minimum spacing; a label then sits a little off its node
			const y = Math.max((n.y0 + n.y1) / 2, floor);
			floor = y + (narrow ? 34 : 30);
			const x = anchorLeft ? n.x0 - 8 : n.x1 + 8;
			const anchor = anchorLeft ? "end" : "start";
			const name = anchorLeft ? short(n.id) : n.id;
			add(
				nodes,
				"text",
				{ x, y: y - 2, "text-anchor": anchor, class: "label" },
				name,
			);
			add(
				nodes,
				"text",
				{ x, y: y + (narrow ? 14 : 15), "text-anchor": anchor, class: "value" },
				`${signed(n.net, unit)}`,
			);
		}
	};
	labels(layout.sources, true);
	labels(layout.targets, false);

	if (t !== 1) return;
	const scenario = ctx.data.scenarios.find((s) => s.id === state.scenario);
	const named = result.flows.filter((x) => x.named).length;
	$("sankey-caption").textContent =
		`Change in ${indicator.name} (${unit}), ${scenario.label}: from the sector whose production emits or employs (left) to the region where that happens (right). ` +
		`Band width is the size of the change; blue bands are decreases, red increases. ` +
		`The ${named} largest sector × region cells of ${result.cells} are drawn by name; every other cell is added to the band between its named sector or region and "Other sectors" / "Other regions", ` +
		`so the bands sum to the total change, ${signed(result.total_delta * f, unit)} ${unit}.`;
	$("sankey-source").textContent =
		`Method: ${docs.flows.breakdown}. ${docs.flows.method}`;
	drawSankeyTable(result, f, unit);
}

function drawSankeyTable(result, f, unit) {
	const table = $("sankey-table");
	table.replaceChildren();
	const head = el("tr");
	for (const h of [
		"Sector",
		"Region",
		`Change (${unit})`,
		"Share of total",
		"Cells",
	])
		head.append(el("th", { scope: "col" }, h));
	table.appendChild(el("thead")).append(head);
	const body = table.appendChild(el("tbody"));
	const total = result.total_delta;
	for (const x of result.flows) {
		const tr = body.appendChild(el("tr"));
		tr.append(el("th", { scope: "row" }, x.sector));
		for (const text of [
			x.region,
			signed(x.delta * f, unit),
			total ? fmtPct((100 * x.delta) / total).replace("+", "") : "—",
			x.named ? "1" : String(x.cells),
		])
			tr.append(el("td", {}, text));
	}
	const foot = table.appendChild(el("tfoot")).appendChild(el("tr"));
	const sum = result.flows.reduce((s, x) => s + x.delta, 0);
	foot.append(el("th", { scope: "row" }, "Sum of the bands"), el("td", {}, ""));
	for (const text of [
		`${signed(sum * f, unit)} (total ${signed(total * f, unit)})`,
		"100%",
		String(result.cells),
	])
		foot.append(el("td", {}, text));
}

// --- baseline → intervention -------------------------------------------------------

const reduced = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The map fades from the neutral baseline (CSS transition on fill) while the
// Sankey bands grow from nothing; with reduced motion, the end state at once.
export function animateFromBaseline(ctx, ms = 1400) {
	if (reduced()) {
		renderMap(ctx);
		renderSankey(ctx);
		return;
	}
	const svg = $("map");
	svg.classList.add("slow");
	renderMap({ ...ctx, baselineView: true });
	svg.getBoundingClientRect(); // commit the baseline fills before the transition
	requestAnimationFrame(() => renderMap(ctx));
	setTimeout(() => svg.classList.remove("slow"), ms + 100);
	const start = performance.now();
	const frame = (now) => {
		const p = Math.min(1, (now - start) / ms);
		const t = 1 - (1 - p) ** 3; // ease out
		renderSankey(ctx, Math.max(t, 0.001));
		if (p < 1) requestAnimationFrame(frame);
		else renderSankey(ctx);
	};
	requestAnimationFrame(frame);
}
