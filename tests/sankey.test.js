import assert from "node:assert/strict";
import { test } from "node:test";
import { SECTOR_SHORT, sankeyLayout, tween } from "../sankey.js";

// Shaped like precompute.top_flows output: named cells, then lumped "other" flows.
const flows = [
	{ sector: "Manufacturing", region: "Germany", delta: -60, named: true },
	{
		sector: "Mining and quarrying",
		region: "Rest of Africa",
		delta: -25,
		named: true,
	},
	{ sector: "Manufacturing", region: "China", delta: -20, named: true },
	{
		sector: "Manufacturing",
		region: "Other regions",
		delta: -30,
		named: false,
		cells: 40,
	},
	{
		sector: "Other sectors",
		region: "Germany",
		delta: 5,
		named: false,
		cells: 12,
	},
	{
		sector: "Other sectors",
		region: "Other regions",
		delta: -10,
		named: false,
		cells: 600,
	},
];
const total = flows.reduce((s, f) => s + f.delta, 0);
const opts = { width: 800, height: 400, left: 200, right: 200 };

test("links and nodes on both sides reconcile to the total change", () => {
	const out = sankeyLayout(flows, opts);
	assert.equal(out.total, total);
	assert.equal(
		out.links.reduce((s, l) => s + l.delta, 0),
		total,
	);
	assert.equal(
		out.sources.reduce((s, n) => s + n.net, 0),
		total,
	);
	assert.equal(
		out.targets.reduce((s, n) => s + n.net, 0),
		total,
	);
	assert.equal(out.targets.find((n) => n.id === "Germany").net, -55);
});

test("nodes are ordered by size with Other last, and fill the height", () => {
	const out = sankeyLayout(flows, opts);
	assert.deepEqual(
		out.sources.map((n) => n.id),
		["Manufacturing", "Mining and quarrying", "Other sectors"],
	);
	assert.equal(out.targets.at(-1).id, "Other regions");
	const tall = out.targets; // four nodes: the fuller side spans the height
	assert.ok(
		Math.abs(tall[0].y0) < 1e-9 && Math.abs(tall.at(-1).y1 - 400) < 1e-9,
	);
	// band widths are |delta| on one scale: sources' heights equal their links'
	for (const n of out.sources) {
		const w = out.links
			.filter((l) => l.sector === n.id)
			.reduce((s, l) => s + l.width, 0);
		assert.ok(Math.abs(w - (n.y1 - n.y0)) < 1e-9);
	}
});

test("a tween towards the baseline shrinks bands on a fixed scale", () => {
	const full = sankeyLayout(flows, opts);
	const scaleAbs = flows.reduce((s, f) => s + Math.abs(f.delta), 0);
	const half = sankeyLayout(tween(flows, 0.5), { ...opts, scaleAbs });
	assert.ok(Math.abs(half.links[0].width - full.links[0].width / 2) < 1e-9);
	assert.equal(half.total, total / 2);
});

test("every level-2 sector has a short label", () => {
	assert.equal(Object.keys(SECTOR_SHORT).length, 15);
});
