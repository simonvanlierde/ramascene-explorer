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

	// --- the data and its precompute run ----------------------------------------------
	bannerReal: "EXIOBASE v3 · engine output",
	bannerSynthetic: "SYNTHETIC TEST DATA: NOT A RESULT",
	runCounts: (run) =>
		`${run.scenarios_run} scenarios run, ${run.passed} passed every check, ${run.failed} failed (excluded)`,
	runWall: (median, max) => `wall time per scenario job median ${median}, max ${max}`,
	runRss: (median, max) => `peak RSS per worker median ${median}, max ${max}`,

	// --- provenance rows, shared by every run's source -----------------------------
	// Details and the Basis note pick rows out by these terms.
	terms: {
		status: "Status",
		jobApi: "Job API",
		engine: "Engine",
		dataset: "Dataset",
		method: "Method",
		referenceCheck: "Reference check",
		parameters: "Scenario parameters",
		changes: "Changes",
		computed: "Computed",
		runtime: "Runtime",
	},
	detached: "(detached)",
	uncommitted: " · uncommitted changes",
	runtime: ({ python, numpy, django, rss }) => `Python ${python} · numpy ${numpy} · Django ${django} · peak RSS ${rss}`,

	// --- custom scenarios on the job API, and the form's own checks --------------------
	live: {
		status: "computed by the job API",
		offline: (api) =>
			`Live job API not reachable (offline): nothing answers at ${api}. The precomputed runs are unaffected.`,
		apiError: (api, error) => `Job API at ${api} answered with an error: ${error}`,
		noChange: "add at least one change",
		notFinite: "the change must be a finite number (percent)",
		outOfRange: (min, max) => `the change must be between ${min} and ${max} percent`,
		// a message about one of the form's changes, by its 1-based number
		inChange: (n, message) => `change ${n}: ${message}`,
		change: (n) => `change ${n}`,
		jobApi: (api, id) => `${api} · job ${id}`,
		unknown: "(unknown)",
		dataset: (d) => `${d.name} · doi:${d.doi} · EXIOBASE year ${d.year}, files *_${d.file_suffix}.npy`,
		reference: (v) =>
			`Octave reference, on this job's matrices: ${v.passed ? "passed" : "not passed"} (${v.values} values, ${v.tolerance})`,
		noReference: "not requested for this job (it reproduces only for a 0% change)",
		finalDemand: "Final demand",
		// catalogue names too long for the form's pickers
		shortNames: {
			"Basic iron and steel and of ferro-alloys and first products thereof": "Iron, steel and ferro-alloy products",
			"Motor vehicles, trailers and semi-trailers": "Motor vehicles and trailers",
		},
		allIndustries: "All industries",
		in: " in ",
		from: " from ",
		manyChanges: (n) => `${n} changes were made together`,
		demandClause: (where, product, origin, change) =>
			`final demand${where} for ${product}${origin} ${change < 0 ? "fell" : change > 0 ? "rose" : "changed"} by ${Math.abs(change)}%`,
		inputClause: (users, where, product, origin, change) =>
			`${users}${where} required ${Math.abs(change)}% ${change < 0 ? "less" : "more"} ${product}${origin} per unit of output`,
		pill: "Live job: not covered by checks",
		heading: "This run: computed live",
		note: "The map shows a job the job API computed while you waited, against the baseline from the same job. The checks below cover the precomputed runs, not this one.",
	},

	// --- custom scenarios computed in the browser --------------------------------------
	browser: {
		status: "computed in this browser",
		pill: "Custom run: not covered by checks",
		heading: "Custom calculation",
		note: "This run was not checked: the calculation checks below cover the published scenarios only. The browser recalculates the 2011 supply chain with float64 Woodbury updates on matrices stored as float32. Every published scenario matches RaMa-Scene within relative 1e-6 that way. Judge the assumptions of your custom scenario yourself.",
		method: "Float64 Woodbury update on float32 matrices, computed in a worker in this browser",
		computed: (s) => `${s} s including data reads`,
		lessThan: "less than 0.01",
		workerGone: "The browser worker could not load. Reload the page; it may have been updated since you opened it.",
	},
	// the browser engine's checks of a scenario, worded as pipeline/numpy_engine.py words them
	engine: {
		noId: "select at least one id",
		unknownId: (id) => `unknown id ${id}`,
		badIndices: "invalid catalog indices",
		range: "change must be between -100 and 1000 percent",
		noConsumer: "select a consumer",
		unknownConsumer: (id) => `unknown consumer ${id}`,
		mixed: "cannot mix final demand and intermediate consumers",
		steps: "a scenario needs 1 to 10 interventions",
		tooBroad: (pairs, detail, several) =>
			`too broad to compute in the browser: it changes ${pairs} product–country pairs${detail}. Choose a narrower product, fewer producing countries, or fewer industries or regions that use it${several ? " or remove a change; the limits apply to all changes together" : ""}.`,
		tooBroadDetail: (products, origins) => ` (${products} products × ${origins} producing countries)`,
		nonFinite: "non-finite scenario output",
	},
};

export const msg = { en }[LOCALE];
