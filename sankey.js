// Pure layout for the sector → region Sankey of a scenario's change.
// Input: the flows precompute.py exports (top cells by |change| named, every
// other cell lumped into an "other" flow), so the flows sum to the total.

// Short labels for the 15 level-2 product aggregates of the engine database.
export const SECTOR_SHORT = {
	"Agriculture, hunting and forestry": "Agriculture",
	Fishing: "Fishing",
	"Mining and quarrying": "Mining",
	Manufacturing: "Manufacturing",
	"Electricity, gas and water supply": "Electricity, gas, water",
	Construction: "Construction",
	Trade: "Trade",
	"Hotels and restaurants": "Hotels, restaurants",
	"Transport, storage and communication": "Transport",
	"Financial intermediation": "Finance",
	"Real estate, renting and business activities": "Real estate, business",
	"Public administration": "Public administration",
	Education: "Education",
	"Health and social work": "Health",
	"Other service activities": "Other services",
};

const OTHER = new Set(["Other sectors", "Other regions"]);

// Nodes on one side, largest |change| first, "Other …" last.
function side(flows, key) {
	const nodes = new Map();
	for (const f of flows) {
		const n = nodes.get(f[key]) ?? { id: f[key], abs: 0, net: 0 };
		n.abs += Math.abs(f.delta);
		n.net += f.delta;
		nodes.set(f[key], n);
	}
	return [...nodes.values()].sort(
		(a, b) => OTHER.has(a.id) - OTHER.has(b.id) || b.abs - a.abs,
	);
}

// {sources, targets, links, total}: every mark in the SVG's coordinates.
// Link width is |delta|; sign travels as link.delta (colour, never width).
// scaleAbs fixes the value → pixel scale (the full change's total |delta|), so a
// tween towards the baseline shrinks the bands instead of rescaling them.
export function sankeyLayout(
	flows,
	{ width, height, left, right, nodeWidth = 12, gap = 10, scaleAbs },
) {
	const live = flows.filter((f) => f.delta !== 0);
	const sources = side(live, "sector");
	const targets = side(live, "region");
	const totalAbs = live.reduce((s, f) => s + Math.abs(f.delta), 0);
	const most = Math.max(sources.length, targets.length);
	const k = totalAbs ? (height - gap * (most - 1)) / (scaleAbs ?? totalAbs) : 0;
	const place = (nodes, x0) => {
		// each side is centred, so the shorter one does not hug the top
		const used =
			nodes.reduce((s, n) => s + n.abs * k, 0) + gap * (nodes.length - 1);
		let y = (height - used) / 2;
		for (const n of nodes) {
			Object.assign(n, { x0, x1: x0 + nodeWidth, y0: y, y1: y + n.abs * k });
			n.cursor = n.y0;
			y = n.y1 + gap;
		}
	};
	place(sources, left);
	place(targets, width - right - nodeWidth);
	const s = new Map(sources.map((n, i) => [n.id, { n, i }]));
	const t = new Map(targets.map((n, i) => [n.id, { n, i }]));
	// order links at the source by target position (and vice versa): fewer crossings
	const links = live
		.map((f) => ({ ...f, source: s.get(f.sector), target: t.get(f.region) }))
		.sort((a, b) => a.source.i - b.source.i || a.target.i - b.target.i)
		.map((l) => {
			const w = Math.abs(l.delta) * k;
			const sy = l.source.n.cursor;
			l.source.n.cursor += w;
			return { ...l, width: w, sy };
		})
		.sort((a, b) => a.target.i - b.target.i || a.source.i - b.source.i)
		.map((l) => {
			const ty = l.target.n.cursor;
			l.target.n.cursor += l.width;
			const x0 = l.source.n.x1;
			const x1 = l.target.n.x0;
			const xm = (x0 + x1) / 2;
			const r = (v) => Math.round(v * 10) / 10;
			return {
				sector: l.sector,
				region: l.region,
				delta: l.delta,
				named: l.named,
				cells: l.cells,
				width: l.width,
				path:
					`M${r(x0)},${r(l.sy)}C${r(xm)},${r(l.sy)} ${r(xm)},${r(ty)} ${r(x1)},${r(ty)}` +
					`L${r(x1)},${r(ty + l.width)}C${r(xm)},${r(ty + l.width)} ${r(xm)},${r(l.sy + l.width)} ${r(x0)},${r(l.sy + l.width)}Z`,
			};
		});
	return {
		sources,
		targets,
		links,
		total: live.reduce((s, f) => s + f.delta, 0),
	};
}

// The flows scaled towards the baseline: t → 0 is no change, 1 the full
// intervention. Linear in t, as every flow is a difference to the baseline.
export const tween = (flows, t) =>
	flows.map((f) => ({ ...f, delta: f.delta * t }));
