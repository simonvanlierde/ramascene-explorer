// EXIOBASE regions ↔ Natural Earth countries (ISO 3166-1 alpha-2), so the map
// can merge countries into the 49 regions. The region codes come from the
// Parquet footer (meta.country_codes): ISO alpha-2 (GB for the United Kingdom,
// GR for Greece) except the five rest-of-world aggregates, which EXIOBASE codes
// WA, WL, WE, WF, WM. No DOM here, so node --test covers it.

// Which Natural Earth countries each rest-of-world aggregate stands for; the
// footer does not carry this.
// Rule: remaining Europe → WE, the Americas → WL, Africa → WF, Iran and
// Western Asia except the Caucasus → WM, everything else in Asia and Oceania
// → WA. EXIOBASE's own concordance may differ at the edges (Greenland, the
// Caucasus, Central Asia).
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

// EXIOBASE region code for a Natural Earth country, or null (N. Cyprus: not
// assigned). codes: the region codes, meta.country_codes.
export function regionForIso(iso, codes) {
	if (!iso) return null;
	return codes.includes(iso) && !REST_OF[iso] ? iso : (ISO_TO_REST[iso] ?? null);
}

// A copy of a quantized TopoJSON topology whose arcs keep only the points
// Douglas-Peucker needs to stay within tol degrees (lon/lat taken as planar).
// Arcs keep their ends, so neighbouring regions still meet. The map draws it
// while it moves, where regenerating every path each frame is the cost.
export function thinTopology(topo, tol) {
	const [sx, sy] = topo.transform.scale;
	const arcs = topo.arcs.map((arc) => {
		const pts = [];
		for (const [dx, dy] of arc) {
			const [x, y] = pts.at(-1) ?? [0, 0];
			pts.push([x + dx, y + dy]);
		}
		const keep = new Uint8Array(pts.length);
		keep[0] = keep[pts.length - 1] = 1;
		const todo = [[0, pts.length - 1]];
		while (todo.length) {
			const [i, j] = todo.pop();
			const [ax, ay] = [pts[i][0] * sx, pts[i][1] * sy];
			const [bx, by] = [pts[j][0] * sx, pts[j][1] * sy];
			const len = Math.hypot(bx - ax, by - ay);
			let [far, at] = [0, -1];
			for (let m = i + 1; m < j; m++) {
				const [px, py] = [pts[m][0] * sx, pts[m][1] * sy];
				// a closed ring starts and ends on one point: measure from it
				const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
				if (d > far) [far, at] = [d, m];
			}
			if (far > tol) {
				keep[at] = 1;
				todo.push([i, at], [at, j]);
			}
		}
		const [a, z] = [pts[0], pts.at(-1)];
		// a closed arc thinned below 4 points is no ring: d3-geo reads it as the sphere
		if (a[0] === z[0] && a[1] === z[1] && keep.reduce((n, k) => n + k, 0) < 4) return arc;
		let [px, py] = [0, 0];
		return pts
			.filter((_, m) => keep[m])
			.map(([qx, qy]) => {
				const d = [qx - px, qy - py];
				[px, py] = [qx, qy];
				return d;
			});
	});
	return { ...topo, arcs };
}
