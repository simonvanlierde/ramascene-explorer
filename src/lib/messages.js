// The page's words, in one place: a translation is a second object of the same shape.
// A message that takes values is a function. tests/messages.test.js checks that every
// msg.… the code reads exists here, and that nothing here goes unused.

// Every Intl formatter and collator reads this, never navigator.language, so numbers and
// sort order always match the language of the text around them.
export const LOCALE = "en";

// Names that take "the" after "in" or "from".
const THE = new Set(["US", "GB", "NL", "CZ"]);

const en = {
	// --- places, sections and grammar -----------------------------------------------
	// The 15 level-2 sections in the Parquet's order, short enough for the rail.
	sections: [
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
	],
	world: "World",
	theWorld: "the world",
	// Names that read better on the map than the database's.
	placeNames: {
		WA: "Rest of Asia–Pacific",
		WL: "Rest of America",
		WF: "Rest of Africa",
		WM: "Rest of Middle East",
		WE: "Rest of Europe",
	},
	// The two that are too long for the Sankey's partner column on a phone.
	placeShort: { WA: "Rest of Asia–Pac.", WM: "Rest of Mid. East" },
	// a region's name after "in" or "from"
	theName: (code, name) => (THE.has(code) ? "the " : "") + name,
	possessive: (name) => (name.endsWith("s") ? "’" : "’s"),
	// the five world regions, as the strip and the Sankey write them
	continents: {
		Europe: "Europe",
		"Middle-East": "Middle East",
		America: "America",
		"Asia-Pacific": "Asia Pacific",
		Africa: "Africa",
	},
	// the same after "in", where the grid's runs name them
	continentIn: { "Middle-East": "the Middle East", America: "the Americas" },

	// --- numbers ---------------------------------------------------------------------
	noChange: "no change from 2011",
	pctWords: (size, lower) => `${size.replace(/^</, "less than ")} ${lower ? "lower" : "higher"} than in 2011`,
	millionJobs: "million jobs",
	thousandJobs: "thousand jobs",
	// the unit cut short, where space is short (map labels, legend, run cards)
	unitShort: {
		"Mt CO₂-eq": "Mt",
		Mt: "Mt",
		"million jobs": "M jobs",
		"thousand jobs": "k jobs",
		jobs: "jobs",
	},

	// --- indicators ------------------------------------------------------------------
	// Wording per indicator (global ids of the engine database). made: the producer side's
	// label, in the indicator's own word (released, jobs, extracted); here: the legend's start;
	// own(name): what a country does. unit: the display unit flows.js converts to.
	indicators: {
		5: {
			label: "GHG",
			noun: "greenhouse gases",
			source: "emissions are released",
			made: {
				col: "Released in",
				here: "Released here to make",
				own: (n) => `What ${n} releases`,
				is: "it is released",
			},
			total: { in: "Consumption footprint", out: "Emissions released" },
			consumed: "it is consumed",
			unit: "Mt CO₂-eq",
			in: {
				verb: " consumption was linked to",
				abroad: "was released abroad",
				would: " consumption would have been linked to",
			},
			out: {
				verb: " released",
				abroad: "of it served consumption abroad",
				would: "emissions released in ",
				come: " would have come to",
			},
		},
		3: {
			label: "Employment",
			noun: "jobs",
			source: "people work",
			made: { col: "Jobs in", here: "Jobs here that make", own: (n) => `Jobs in ${n}`, is: "the jobs are" },
			total: { in: "Jobs behind consumption", out: "Jobs located here" },
			consumed: "the jobs serve consumption",
			unit: "jobs",
			in: {
				verb: " consumption was linked to",
				abroad: "of them were abroad",
				would: " consumption would have been linked to",
			},
			out: {
				verb: " had",
				abroad: "of them served consumption abroad",
				would: "jobs in ",
				come: " would have come to",
			},
		},
		7: {
			label: "Metal ores",
			noun: "metal ores",
			source: "metal ores are mined",
			made: {
				col: "Extracted in",
				here: "Extracted here to make",
				own: (n) => `What ${n} extracts`,
				is: "it is extracted",
			},
			total: { in: "Ores behind consumption", out: "Ores extracted here" },
			consumed: "it is consumed",
			unit: "Mt",
			in: {
				verb: " consumption required",
				abroad: "was extracted abroad",
				would: " consumption would have required metal-ore extraction of",
			},
			out: {
				verb: " extracted",
				abroad: "of it served consumption abroad",
				would: "metal-ore extraction in ",
				come: " would have come to",
			},
		},
	},
	// The plain line under the Flows sentence: what the direction shows.
	hintWorld: (where) => `Colours the map by where ${where}.`,
	hintIn: (source, name) => `Where ${source} to make what ${name} consumes.`,
	hintOut: (name) => `Where what ${name} makes is consumed.`,

	// --- runs ------------------------------------------------------------------------
	// Plain-language "if …" clause for each run, as the sentence uses it.
	runs: {
		"vehicle-demand-europe": "European final demand for European-made motor vehicles fell by 20%",
		"steel-in-vehicles-europe": "European vehicle makers required 20% less steel per unit of output",
		"cement-in-construction": "construction required 20% less cement per unit of output worldwide",
		"coal-power-china": "industry in China required 20% less Chinese coal power per unit of output",
		"construction-demand-europe": "European final demand for construction work fell by 20%",
	},
	gridRun: (region, cut, product) => `every industry in ${region} required ${cut}% less ${product} per unit of output`,
	// The kind of change, as the chosen card's subtitle names it; a grid cell has none here.
	runKind: {
		"vehicle-demand-europe": "Final demand",
		// first use of the term on the page, so it carries its gloss
		"construction-demand-europe": "Final demand: what households, governments and investors buy",
		"coal-power-china": "Electricity use",
	},

	// --- the Sankey ------------------------------------------------------------------
	atHome: "At home",
	home: (name) => `${name} (home)`,
	otherRegions: (n) => `${n} other regions`,
};

export const msg = { en }[LOCALE];
