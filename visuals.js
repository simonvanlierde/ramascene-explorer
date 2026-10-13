// Loading and layout helpers for the map and the Sankey. The Svelte components
// in src/ draw them; the pure logic lives in map.js and sankey.js.

import { sameRun } from "./explorer.js";
import { decodeTopology } from "./map.js";
import { SECTOR_SHORT } from "./sankey.js";

// Fetch a JSON document; null when absent or unreadable (the sidecars are optional).
async function fetchJson(url) {
	try {
		const response = await fetch(url, { cache: "no-cache" });
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
}

// The map geometry, and the sidecars next to results.json. The sidecars must
// come from the same run (sameRun); anything else is not shown next to it.
export async function loadVisuals(dataPath, data) {
	const topo = await fetchJson("geo/countries-110m.topo.json");
	const features = topo ? decodeTopology(topo, "countries") : null;
	if (!dataPath.endsWith("results.json")) return { features };
	const [regions, flows] = await Promise.all(
		["regions.json", "flows.json"].map((n) => fetchJson(dataPath.replace(/results\.json$/, n))),
	);
	return {
		features,
		regions: sameRun(regions, data) ? regions : null,
		flows: sameRun(flows, data) ? flows : null,
	};
}

// --- Sankey labels ------------------------------------------------------------------

const short = (id) => SECTOR_SHORT[id] ?? id;
// At phone width the label column is ~118 px: shorter still (full names in the table).
const NARROW = {
	"Electricity, gas, water": "Electricity",
	"Real estate, business": "Real estate",
	"Public administration": "Public admin.",
	"Hotels, restaurants": "Hotels",
	"Rest of Asia and Pacific": "Rest of Asia-Pac.",
	"Rest of Middle East": "Rest of Mid. East",
};

const labelGap = {};

// One side's nodes and labels: [{node, x, y, anchor, name, leader}]. t is the
// replay position (1 is the finished layout); height the drawing's height.
export function sankeyLabels(list, { anchorLeft, narrow, height, t }) {
	const step = narrow ? 34 : 38; // two lines: name, then value
	const ys = [];
	for (const n of list) ys.push(Math.max((n.y0 + n.y1) / 2, (ys.at(-1) ?? -Infinity) + step));
	for (let i = ys.length - 1; i >= 0; i--)
		ys[i] = Math.min(ys[i], i === ys.length - 1 ? height - 20 : ys[i + 1] - step);
	// labels keep a minimum spacing, so a small node's label can sit beside
	// its neighbour: then that side's labels step out and a leader line
	// joins each displaced label to its own node
	const centre = (n) => (n.y0 + n.y1) / 2;
	const off = (i) => Math.abs(ys[i] - centre(list[i])) > 6;
	// mid-replay the nodes are still growing: keep the finished layout's
	// offset so the labels do not jump sideways between frames
	const side = anchorLeft ? "left" : "right";
	if (t === 1) labelGap[side] = list.some((_, i) => off(i)) ? 18 : 8;
	const gap = labelGap[side] ?? 8;
	return list.map((n, i) => {
		const y = ys[i];
		const edge = anchorLeft ? n.x0 : n.x1;
		const dir = anchorLeft ? -1 : 1;
		const long = anchorLeft ? short(n.id) : n.id;
		return {
			node: n,
			x: edge + dir * gap,
			y,
			anchor: anchorLeft ? "end" : "start",
			name: narrow ? (NARROW[long] ?? long) : long,
			leader: t === 1 && off(i) ? `M${edge + dir * 2},${centre(n)} L${edge + dir * (gap - 5)},${y - 7}` : null,
		};
	});
}
