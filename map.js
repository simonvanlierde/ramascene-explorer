// EXIOBASE regions ↔ Natural Earth countries (ISO 3166-1 alpha-2), so the map
// can merge countries into the 49 regions. No DOM here, so node --test covers it.

// The 49 EXIOBASE v3 regions as the RaMa-Scene database (db.sqlite3,
// ramascene_country) names and codes them, with their continental aggregate.
// Codes are ISO alpha-2 (GB for the United Kingdom, GR for Greece) except
// the five rest-of-world aggregates, which EXIOBASE codes WA, WL, WE, WF, WM.
const AGG = {
	E: "Europe",
	M: "Middle-East",
	A: "America",
	P: "Asia-Pacific",
	F: "Africa",
};
const ROWS = `AT Austria E|BE Belgium E|BG Bulgaria E|CY Cyprus E|CZ Czech Republic E|DE Germany E|DK Denmark E|EE Estonia E|ES Spain E|FI Finland E|FR France E|GR Greece E|HR Croatia E|HU Hungary E|IE Ireland E|IT Italy E|LT Lithuania E|LU Luxembourg E|LV Latvia E|MT Malta E|NL Netherlands E|PL Poland E|PT Portugal E|RO Romania E|SE Sweden E|SI Slovenia E|SK Slovakia E|GB United Kingdom E|US United States A|JP Japan P|CN China P|CA Canada A|KR South Korea P|BR Brazil A|IN India P|MX Mexico A|RU Russia E|AU Australia P|CH Switzerland E|TR Turkey M|TW Taiwan P|NO Norway E|ID Indonesia P|ZA South Africa F|WA Rest of Asia and Pacific P|WL Rest of America A|WE Rest of Europe E|WF Rest of Africa F|WM Rest of Middle East M`;
export const EXIOBASE_REGIONS = ROWS.split("|").map((row) => {
	const [code, ...rest] = row.split(" ");
	return {
		code,
		name: rest.slice(0, -1).join(" "),
		aggregate: AGG[rest.at(-1)],
	};
});

// Which Natural Earth countries each rest-of-world aggregate stands for.
// Rule: remaining Europe → WE, the Americas → WL, Africa → WF, Iran and
// Western Asia except the Caucasus → WM, everything else in Asia and Oceania
// → WA. EXIOBASE's own concordance may differ at the edges (Greenland, the
// Caucasus, Central Asia); the page says so.
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
const BY_CODE = Object.fromEntries(EXIOBASE_REGIONS.map((r) => [r.code, r]));

// EXIOBASE region code for a Natural Earth country, or null (N. Cyprus: not assigned).
export function regionForIso(iso) {
	if (!iso) return null;
	return BY_CODE[iso] && !REST_OF[iso] ? iso : (ISO_TO_REST[iso] ?? null);
}
