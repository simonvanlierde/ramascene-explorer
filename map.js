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
