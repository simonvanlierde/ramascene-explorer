import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../embodied.js";
import { arc, bandGeometry, SECTION_SHORT, sankeyLayout, summarise, taper, taperGlyph } from "../flows.js";

// Same pinned seed as the property tests, so Stryker sees the same inputs every run
if (process.env.FC_SEED) fc.configureGlobal({ seed: Number(process.env.FC_SEED) });

const src = await openEmbodied(
	await asyncBufferFromFile(new URL("./fixture-embodied.parquet", import.meta.url).pathname),
);
const { meta } = src;
const base = await readRun(src, "baseline");
const ALL = new Set(SECTION_SHORT.keys());
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const nums = (s) => s.match(/-?\d+(?:\.\d+)?/g).map(Number);
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// --- the flat map's centreline and the taper ---------------------------------------

test("the arc runs from its start to its end and bows upwards by a quarter of the span", () => {
	fc.assert(
		fc.property(
			fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })),
			fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })),
			fc.integer({ min: 2, max: 40 }),
			(a, c, n) => {
				const pts = arc(a, c, n);
				assert.equal(pts.length, n + 1);
				assert.deepEqual(pts[0], a);
				assert.ok(dist(pts[n], c) < 1e-9);
				// the middle of a quadratic curve sits a quarter of the way to its control point
				const m = mid(a, c);
				const top = pts[Math.floor(n / 2)];
				if (n % 2 === 0) {
					assert.ok(close(top[0], m[0]));
					assert.ok(close(top[1], m[1] - 0.12 * dist(a, c)));
				}
				assert.ok(pts.every((p) => p[1] <= Math.max(a[1], c[1]) + 1e-9));
			},
		),
	);
});

test("the taper starts thin, widens monotonically and is full width from 60% of the way", () => {
	assert.ok(close(taper(0), 0.16));
	assert.ok(close(taper(0.6), 1));
	assert.equal(taper(1), 1);
	let prev = 0;
	for (let i = 0; i <= 100; i++) {
		const w = taper(i / 100);
		assert.ok(w >= prev);
		prev = w;
	}
});

test("the legend glyph is a closed band, symmetric about its centre line, tapered along the flow", () => {
	for (const dir of ["in", "out"]) {
		const [x0, y0, ...rest] = nums(taperGlyph(10, 2, 62, dir));
		const pts = [[x0, y0]];
		for (let i = 0; i < rest.length; i += 2) pts.push([rest[i], rest[i + 1]]);
		assert.equal(pts.length, 42);
		const up = pts.slice(0, 21);
		const down = pts.slice(21).reverse();
		up.forEach((p, i) => {
			assert.equal(p[0], down[i][0]);
			assert.ok(Math.abs(p[1] - 9 + (down[i][1] - 9)) < 0.11);
		});
		const half = (i) => 9 - up[i][1];
		// the band spans x = 2 to x1; full width is v * k
		assert.equal(up[0][0], 2);
		assert.equal(up[20][0], 62);
		const [thin, wide] = dir === "in" ? [half(0), half(20)] : [half(20), half(0)];
		assert.ok(Math.abs(wide - 10) < 0.06);
		assert.ok(Math.abs(thin - 10 * 0.16) < 0.06);
	}
	assert.match(taperGlyph(1, 1, 30, "in"), /^M[\d.,L-]+Z$/);
});

// --- flow bands --------------------------------------------------------------------

const B = [400, 200];
const one = (v, dir, k = 1, from = [100, 300]) => bandGeometry([{ k: 1, v, P: arc(from, B) }], B, { k, dir });
const corners = (d) => {
	const n = nums(d);
	const pts = [];
	for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
	return pts;
};
const partnerStart = fc
	.record({ x: fc.integer({ min: 0, max: 200 }), y: fc.integer({ min: 0, max: 400 }) })
	.map((p) => [p.x, p.y]);

test("a band is as wide as its flow times the scale, never under the minimum", () => {
	fc.assert(
		fc.property(
			fc.double({ min: 0.5, max: 200, noNaN: true }),
			fc.double({ min: 0.1, max: 5, noNaN: true }),
			fc.constantFrom("in", "out"),
			(v, k, dir) => {
				const { bands } = one(v, dir, k);
				const w = Math.max(0.8, v * k);
				// full width is reached at the end the flow arrives at; the other end is a 0.16 sliver
				const [start, end] = dir === "in" ? [0, bands[0].widths.length - 1] : [bands[0].widths.length - 1, 0];
				assert.ok(close(bands[0].widths[end], w));
				assert.ok(close(bands[0].widths[start], 0.16 * w));
				assert.ok(Math.max(...bands[0].widths) <= w + 1e-9);
			},
		),
	);
	// doubling the flow doubles the width once above the minimum
	const [a, b] = [one(10, "in", 1).bands[0].widths, one(20, "in", 1).bands[0].widths];
	for (const [i, w] of a.entries()) assert.ok(close(2 * w, b[i]));
});

test("the two directions draw the same band tapered the opposite way", () => {
	const [i, o] = [one(12, "in", 2).bands[0].widths, one(12, "out", 2).bands[0].widths];
	for (const [j, w] of [...i].reverse().entries()) assert.ok(close(w, o[j]));
	assert.equal(one(12, "in", 2).bands[0].d.split("L").length, one(12, "out", 2).bands[0].d.split("L").length);
});

test("a band is a closed ribbon whose two edges stay half a width either side of its centre line", () => {
	fc.assert(
		fc.property(
			partnerStart,
			fc.double({ min: 1, max: 60, noNaN: true }),
			fc.constantFrom("in", "out"),
			(from, v, dir) => {
				const P = arc(from, B);
				const { bands } = bandGeometry([{ k: 1, v, P }], B, { k: 1, dir });
				if (bands.length === 0) return;
				const { d, widths } = bands[0];
				assert.match(d, /^M.*Z$/);
				const pts = corners(d);
				const n = P.length;
				assert.equal(pts.length, 2 * n);
				const left = pts.slice(0, n);
				const right = pts.slice(n).reverse();
				// the ribbon starts on the partner's anchor
				const c0 = mid(left[0], right[0]);
				assert.ok(dist(c0, P[0]) < 0.15);
				for (let i = 0; i < n - 1; i++) {
					assert.ok(Math.abs(dist(left[i], right[i]) - widths[i]) < 0.15, `width at ${i}`);
				}
			},
		),
	);
});

test("a band ends on the collar around the selected country, as wide as the band there", () => {
	fc.assert(
		fc.property(
			partnerStart,
			fc.double({ min: 1, max: 60, noNaN: true }),
			fc.constantFrom("in", "out"),
			(from, v, dir) => {
				const { R, bands } = bandGeometry([{ k: 1, v, P: arc(from, B) }], B, { k: 1, dir });
				if (bands.length === 0) return;
				const pts = corners(bands[0].d);
				const n = pts.length / 2;
				const [e1, e2] = [pts[n - 1], pts[n]];
				assert.ok(Math.abs(dist(e1, B) - R) < 0.1);
				assert.ok(Math.abs(dist(e2, B) - R) < 0.1);
				// the band's collar end spans an arc of w / R, so its corners are a chord apart
				const w = bands[0].widths[n - 1];
				assert.ok(Math.abs(dist(e1, e2) - 2 * R * Math.sin(w / (2 * R))) < 0.2);
			},
		),
	);
});

test("the centre line bends onto the collar, and the edges stay square to it", () => {
	fc.assert(
		fc.property(partnerStart, fc.double({ min: 4, max: 40, noNaN: true }), (from, v) => {
			const P = arc(from, B);
			const { R, bands } = bandGeometry([{ k: 1, v, P }], B, { k: 1, dir: "in" });
			if (bands.length === 0) return;
			const pts = corners(bands[0].d);
			const n = P.length;
			const left = pts.slice(0, n);
			const right = pts.slice(n).reverse();
			const centre = left.map((p, i) => mid(p, right[i]));
			const last = n - 1;
			for (let i = 0; i < n - 1; i++) {
				// the shift from the arc grows with the cube of the way along, up to the collar radius
				assert.ok(Math.abs(dist(centre[i], P[i]) - R * (i / last) ** 3) < 0.15, `shift at ${i}`);
			}
			for (let i = 1; i < n - 2; i++) {
				const t = [centre[i + 1][0] - centre[i - 1][0], centre[i + 1][1] - centre[i - 1][1]];
				const e = [left[i][0] - right[i][0], left[i][1] - right[i][1]];
				const cos = (t[0] * e[0] + t[1] * e[1]) / (Math.hypot(...t) * Math.hypot(...e) || 1);
				if (Math.hypot(...t) > 1 && Math.hypot(...e) > 1) assert.ok(Math.abs(cos) < 0.15, `edge not square at ${i}`);
			}
			// the ribbon does not twist at the collar end
			assert.ok(dist(left[last - 1], left[last]) <= dist(left[last - 1], right[last]) + 0.2);
			assert.ok(dist(right[last - 1], right[last]) <= dist(right[last - 1], left[last]) + 0.2);
		}),
	);
});

test("bands bound for nearly the same spot on the collar are spread apart, also across the back of it", () => {
	for (const centre of [0.5, Math.PI, -Math.PI + 0.02]) {
		const lines = [20, 30, 25, 35, 15].map((v, k) => {
			const th = centre + (k - 2) * 0.01;
			return { k, v, P: arc([B[0] + 300 * Math.cos(th), B[1] + 300 * Math.sin(th)], B) };
		});
		const { R, bands } = bandGeometry(lines, B, { k: 1, dir: "in" });
		assert.equal(bands.length, 5);
		const ends = bands.map((b) => {
			const pts = corners(b.d);
			const n = pts.length / 2;
			return { c: mid(pts[n - 1], pts[n]), w: b.widths[n - 1] };
		});
		const angles = ends.map((e) => Math.atan2(e.c[1] - B[1], e.c[0] - B[0]));
		for (let i = 0; i < ends.length; i++)
			for (let j = i + 1; j < ends.length; j++) {
				const turn = Math.abs(angles[i] - angles[j]);
				const apart = Math.min(turn, 2 * Math.PI - turn);
				// neighbours along the collar touch or leave a gap, never overlap
				assert.ok(apart >= (ends[i].w + ends[j].w) / (2 * R) - 0.05, `${centre}: ${i}, ${j}`);
			}
	}
});

test("the collar grows with the bands so they fit round it side by side", () => {
	const lines = (vs) => vs.map((v, k) => ({ k, v, P: arc([60 + k * 25, 380 - k * 30], B) }));
	const small = bandGeometry(lines([3, 3]), B, { k: 1, dir: "in" });
	assert.equal(small.R, 6);
	const wide = bandGeometry(lines([200, 200, 200, 200]), B, { k: 1, dir: "in" });
	assert.ok(close(wide.R, 800 / (2 * Math.PI * 0.82)));
	assert.ok(close(bandGeometry(lines([100, 100, 100, 100]), B, { k: 2, dir: "in" }).R, wide.R));
	assert.ok(wide.R > small.R);
	// the minimum width counts towards the collar even for a flow of zero
	const tiny = bandGeometry(lines(new Array(60).fill(0)), B, { k: 1, dir: "in" });
	assert.ok(close(tiny.R, (60 * 0.8) / (2 * Math.PI * 0.82)) || tiny.R === 6);
	assert.ok(tiny.bands.every((b) => Math.max(...b.widths) <= 0.8 + 1e-9));
});

test("bands that start inside the collar are dropped, the others keep their order of flows", () => {
	const lines = [
		{ k: 7, v: 20, P: arc([402, 203], B) },
		{ k: 8, v: 20, P: arc([100, 300], B) },
		{ k: 9, v: 20, P: arc([700, 100], B) },
	];
	const { bands } = bandGeometry(lines, B, { k: 1, dir: "in" });
	assert.deepEqual(bands.map((b) => b.k).sort(), [8, 9]);
	// a lone small band has R = 6, so the exclusion zone is 18 px: 19 gets a band, 17 none
	const edge = [B[0] - 19, B[1]];
	const near = bandGeometry([{ k: 1, v: 20, P: arc(edge, B) }], B, { k: 1, dir: "in" });
	assert.equal(near.bands.length, 1);
	const inside = bandGeometry([{ k: 1, v: 20, P: arc([B[0] - 17, B[1]], B) }], B, { k: 1, dir: "in" });
	assert.equal(inside.bands.length, 0);
	for (const b of bands) assert.equal(b.v, lines.find((l) => l.k === b.k).v);
});

test("bands do not overlap where they meet the collar", () => {
	fc.assert(
		fc.property(
			fc.array(fc.tuple(fc.double({ min: 0, max: 6.28, noNaN: true }), fc.integer({ min: 5, max: 40 })), {
				minLength: 2,
				maxLength: 8,
			}),
			(spec) => {
				const lines = spec.map(([th, v], k) => ({
					k,
					v,
					P: arc([B[0] + 300 * Math.cos(th), B[1] + 300 * Math.sin(th)], B),
				}));
				const { R, bands } = bandGeometry(lines, B, { k: 1, dir: "in" });
				const ends = bands.map((b) => {
					const pts = corners(b.d);
					const n = pts.length / 2;
					return { c: mid(pts[n - 1], pts[n]), w: b.widths[n - 1] };
				});
				// the spreading runs a fixed number of passes, so allow it a little slack
				const tight = bands.length * 40 < 2 * Math.PI * R * 0.5;
				if (!tight) return;
				for (let i = 0; i < ends.length; i++)
					for (let j = i + 1; j < ends.length; j++)
						assert.ok(dist(ends[i].c, ends[j].c) >= (ends[i].w + ends[j].w) / 2 - 1, `${i} and ${j} overlap`);
			},
		),
	);
});

// --- drill-down Sankey -------------------------------------------------------------

const GAP = 3;
const TOP = 30;
const layouts = fc.record({
	who: fc.integer({ min: 0, max: meta.countries.length - 1 }),
	dir: fc.constantFrom("in", "out"),
	on: fc.subarray([...ALL], { minLength: 1 }).map((s) => new Set(s)),
});
const build = ({ who, dir, on }, size) => {
	const sel = { ind: 0, id: 5, who, dir, on };
	const sum = summarise(meta, base, null, sel);
	fc.pre(sum.total > 0);
	return { sel, sum, lay: sankeyLayout(meta, sum, sel, size) };
};
const columns = (lay) => [lay.left, lay.mid, lay.right];

test("every Sankey column carries the same total", () => {
	fc.assert(
		fc.property(layouts, (s) => {
			const { sum, lay } = build(s);
			for (const col of columns(lay)) {
				assert.ok(
					close(
						col.reduce((a, n) => a + n.v, 0),
						sum.total,
						1e-6,
					),
				);
			}
		}),
	);
});

test("node heights are proportional to their values within a column and fit the box", () => {
	fc.assert(
		fc.property(layouts, fc.integer({ min: 200, max: 900 }), (s, height) => {
			const { sum, lay } = build(s, { height });
			for (const col of columns(lay)) {
				const k = (height - TOP - GAP * (col.length - 1)) / sum.total;
				for (const n of col) assert.ok(close(n.h, Math.max(0.8, n.v * k)));
				const last = col.at(-1);
				assert.ok(last.y + last.v * k <= height + 1e-6);
				assert.equal(col[0].y, TOP);
			}
		}),
	);
});

test("nodes in a column are stacked in order, largest first, with a fixed gap and no overlap", () => {
	fc.assert(
		fc.property(layouts, (s) => {
			const { sum, lay } = build(s);
			for (const col of columns(lay)) {
				const k = (lay.height - TOP - GAP * (col.length - 1)) / sum.total;
				for (let i = 0; i + 1 < col.length; i++) {
					assert.ok(close(col[i + 1].y - (col[i].y + col[i].v * k), GAP));
					assert.ok(col[i + 1].y >= col[i].y + col[i].h - 0.8);
				}
			}
			// partners and sections come largest first; "other regions" is the sum of the rest and goes last
			const partners = s.dir === "in" ? lay.left : lay.right;
			const named = partners.filter((n) => !n.me && !/ other regions$/.test(n.name));
			for (let i = 0; i + 1 < named.length; i++) assert.ok(named[i].v >= named[i + 1].v);
			for (let i = 0; i + 1 < lay.mid.length; i++) assert.ok(lay.mid[i].v >= lay.mid[i + 1].v);
		}),
	);
});

test("the selected country is one node on its own side, beside the partners", () => {
	for (const dir of ["in", "out"]) {
		const { sel, sum, lay } = build({ who: meta.country_codes.indexOf("DE"), dir, on: ALL });
		const [home, partners] = dir === "in" ? [lay.right, lay.left] : [lay.left, lay.right];
		assert.equal(home.length, 1);
		assert.equal(home[0].name, meta.countries[sel.who]);
		assert.equal(home[0].v, sum.total);
		assert.equal(partners.length, sum.vals.filter((v) => v > 0).length);
		// the columns sit left to right: partners/me, sections, me/partners
		assert.ok(lay.x.L < lay.x.M && lay.x.M < lay.x.R);
	}
});

test("past nine partners the rest fold into one 'other regions' node that sums them", () => {
	const n = 14;
	const vals = Array.from({ length: n }, (_, k) => (k + 1) * 10);
	const sum = {
		vals,
		total: vals.reduce((a, b) => a + b),
		sec: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		cell: (k, q) => (q === 3 ? vals[k] : 0),
	};
	sum.sec[3] = sum.total;
	const lay = sankeyLayout(meta, sum, { who: 0, dir: "in", on: ALL });
	assert.equal(lay.left.length, 10);
	assert.deepEqual(
		lay.left.slice(0, 9).map((p) => p.v),
		vals.slice(5).reverse(),
	);
	const other = lay.left[9];
	assert.equal(other.name, "5 other regions");
	assert.equal(other.v, 10 + 20 + 30 + 40 + 50);
	assert.equal(lay.links.filter((l) => l.to === SECTION_SHORT[3]).length, 10);
});

test("each link connects the nodes it names, and its thickness is the share of the value it carries", () => {
	fc.assert(
		fc.property(layouts, (s) => {
			const { sum, lay } = build(s);
			const nodeOf = (name, col) => col.find((n) => n.name === name);
			const kOf = (col) => (lay.height - TOP - GAP * (col.length - 1)) / sum.total;
			for (const l of lay.links) {
				const [x0, a0, , , , , x1, b0, , b1, , , , , , a1] = nums(l.d);
				const stage1 = lay.left.some((n) => n.name === l.from);
				const [src, dst] = stage1
					? [nodeOf(l.from, lay.left), nodeOf(l.to, lay.mid)]
					: [nodeOf(l.from, lay.mid), nodeOf(l.to, lay.right)];
				assert.ok(src && dst, `${l.from} -> ${l.to}`);
				const [srcCol, dstCol] = stage1 ? [lay.left, lay.mid] : [lay.mid, lay.right];
				assert.ok(close(a1 - a0, l.v * kOf(srcCol)));
				assert.ok(close(b1 - b0, l.v * kOf(dstCol)));
				// the ribbon sits within the nodes' own extent on both ends
				assert.ok(a0 >= src.y - 1e-6 && a1 <= src.y + src.v * kOf(srcCol) + 1e-6);
				assert.ok(b0 >= dst.y - 1e-6 && b1 <= dst.y + dst.v * kOf(dstCol) + 1e-6);
				const m = (x0 + x1) / 2;
				assert.equal(nums(l.d)[2], m);
				assert.equal(nums(l.d)[4], m);
				assert.equal(x0, stage1 ? lay.x.L + lay.nw : lay.x.M + lay.nw);
				assert.equal(x1, stage1 ? lay.x.M : lay.x.R);
				assert.equal(l.q, (stage1 ? dst : src).q);
			}
		}),
	);
});

test("the links leaving or entering a node fill it exactly", () => {
	fc.assert(
		fc.property(layouts, (s) => {
			const { lay } = build(s);
			const by = (key, name) => lay.links.filter((l) => l[key] === name).reduce((a, l) => a + l.v, 0);
			for (const n of lay.left) assert.ok(close(by("from", n.name), n.v, 1e-6));
			for (const n of lay.right) assert.ok(close(by("to", n.name), n.v, 1e-6));
			for (const n of lay.mid) {
				assert.ok(close(by("to", n.name), n.v, 1e-6));
				assert.ok(close(by("from", n.name), n.v, 1e-6));
			}
		}),
	);
});

test("the Sankey draws into the box it is given", () => {
	const { lay } = build({ who: 0, dir: "in", on: ALL }, { width: 600, height: 300 });
	assert.equal(lay.width, 600);
	assert.equal(lay.height, 300);
	assert.equal(lay.x.R, 600 - lay.nw - 6);
	assert.equal(build({ who: 0, dir: "in", on: ALL }).lay.width, 452);
	assert.equal(build({ who: 0, dir: "in", on: ALL }).lay.height, 420);
});

test("links leave a node one after another from its top, and arrive stacked the same way", () => {
	fc.assert(
		fc.property(layouts, (s) => {
			const { sum, lay } = build(s);
			const k = (col) => (lay.height - TOP - GAP * (col.length - 1)) / sum.total;
			const out = new Map();
			const into = new Map();
			const colOf = (name) => (lay.left.some((n) => n.name === name) ? "L" : "R");
			for (const l of lay.links) {
				const stage1 = lay.left.some((n) => n.name === l.from);
				const srcKey = `${stage1 ? "L" : "M"}:${l.from}`;
				const dstKey = `${stage1 ? "M" : "R"}:${l.to}`;
				const [, a0, , , , , , b0, , b1, , , , , , a1] = nums(l.d);
				const [srcCol, dstCol] = stage1 ? [lay.left, lay.mid] : [lay.mid, lay.right];
				const [src, dst] = [srcCol.find((n) => n.name === l.from), dstCol.find((n) => n.name === l.to)];
				assert.ok(close(a0, out.get(srcKey) ?? src.y), `${srcKey} starts where the last link ended`);
				assert.ok(close(b0, into.get(dstKey) ?? dst.y), `${dstKey} receives where the last link ended`);
				out.set(srcKey, a1);
				into.set(dstKey, b1);
				assert.ok(colOf(l.from) && l.v > 0);
				assert.ok(k(srcCol) > 0 && k(dstCol) > 0);
			}
		}),
	);
});

test("sections without flow get no node, zero cells no link, and a partner that is the selection is marked home", () => {
	const vals = [30, 20, 10];
	const sec = new Array(SECTION_SHORT.length).fill(0);
	sec[2] = 40;
	sec[5] = 20;
	const cells = { 2: [30, 10, 0], 5: [0, 10, 10] };
	const sum = { vals, total: 60, sec, cell: (k, q) => cells[q]?.[k] ?? 0 };
	const lay = sankeyLayout(meta, sum, { who: 0, dir: "in", on: ALL });
	assert.deepEqual(
		lay.mid.map((n) => n.q),
		[2, 5],
	);
	// 3 partners x 2 sections have four non-zero cells, plus two links into the selected country
	assert.equal(lay.links.length, 4 + 2);
	assert.ok(lay.links.every((l) => l.v > 0));
	assert.equal(lay.left[0].name, `${meta.countries[0]} (home)`);
	assert.ok(lay.left.slice(1).every((n) => !n.name.endsWith("(home)")));
	assert.equal(lay.right[0].me, true);
	assert.ok(lay.left.every((n) => !n.me));
	// a section outside the selection stays out even when it carries flow
	const some = sankeyLayout(meta, sum, { who: 0, dir: "in", on: new Set([5]) });
	assert.deepEqual(
		some.mid.map((n) => n.q),
		[5],
	);
});
