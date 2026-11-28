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
				at: "Released here",
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
			made: {
				col: "Jobs in",
				at: "Jobs here",
				here: "Jobs here that make",
				own: (n) => `Jobs in ${n}`,
				is: "the jobs are",
			},
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
				would: "employment in ",
				come: " would have come to",
			},
		},
		7: {
			label: "Metal ores",
			noun: "metal ores",
			source: "metal ores are mined",
			made: {
				col: "Extracted in",
				at: "Extracted here",
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
		model: "Model",
		generated: "Generated",
		run: "Run",
		failed: "Failed scenarios",
		breakdown: "Breakdown",
		command: "Command",
	},
	detached: "(detached)",
	uncommitted: " · uncommitted changes",
	runtime: ({ python, numpy, django, rss }) => `Python ${python} · numpy ${numpy} · Django ${django} · peak RSS ${rss}`,

	// --- the map card: labels, tooltip, legend and scrubber ----------------------------
	map: {
		consumedHere: "Consumed here",
		homeIn: "at home, for its own consumption",
		homeOut: "at home and consumed at home",
		hereFor: (name) => `here, for consumption in ${name}`,
		inFor: (name) => `in ${name}, for consumption here`,
		almostNone: "Almost no 2011 flow",
		almostNoneFor: (into, name) => `Almost no 2011 flow ${into ? `for ${name}` : `from ${name}`}`,
		changeOn: (change, flow, where) => `${change} on a 2011 flow of ${flow}${where === null ? "" : `, ${where}`}`,
		million: "M",
		thousand: "k",
		into: (name, possessive) => `into ${name}${possessive} consumption`,
		outOf: (name) => `out of ${name}`,
		// bands: how many flows the map draws, or null for World, which has none
		label: (bands, where, what) =>
			`Map of ${bands === null ? `the world total, by the region where ${where}` : `${bands} flows ${what}`}; the table in Details lists every flow`,
		detailsFor: (name) => `Details for ${name}: Sankey, table and method`,
		details: "Details",
		projection: "Map projection",
		flat: "Flat",
		globe: "Globe",
		zoom: "Zoom",
		zoomIn: "Zoom in",
		zoomOut: "Zoom out",
		resetZoom: "Reset zoom",
		noteRun: (world, pct) =>
			`${world ? "Each region’s colour is the % change in its total" : "Bands keep their 2011 width. The colour of each band and country is the % change in its flow"} in this run, drawn ${pct}% of the way from the 2011 baseline. The slider blends the two; it is not a timeline. An engine run on 2011 data, not a forecast.`,
		noteWorld: (unit, where) => `Colour: ${unit} per region, by where ${where}.`,
		noteBands: (n, what, unit, section) =>
			`Bands: the ${n} largest flows ${what}${section === null ? "" : `, ${section} only`}; width shows ${unit}. Colour: ${unit} per region.`,
		turn: "Drag to turn the globe, scroll or pinch to zoom.",
		pinch: "Scroll or pinch to zoom.",
		largest: (section, share) => `Largest: ${section}, ${share}`,
		click: "Click to select",
		changeLegend: "Change in each 2011 flow, %",
		scale:
			"Colour deepens with the square root of the change. The larger flows set the ends; changes past either end share the end colour.",
		bandWidth: (unit) => ` Band width is each flow’s 2011 value, in ${unit}.`,
		scrub: "From the 2011 baseline to the run",
		baseline: "2011 baseline",
		ofRun: (pct) => `${pct}% of the run`,
		run: "run",
		replay: "Replay",
		legendIn: (here, name) => `${here} what ${name} consumes`,
		legendOut: (name) => `Consumed here, made in ${name}`,
		noOutlines: "The map outlines could not be loaded.",
	},

	// --- Details: the Sankey, the table and the method ---------------------------------
	details: {
		sankey: "Sankey",
		table: "Table",
		industry: "Industry",
		share: "Share",
		largest: "Largest industry",
		change: "Change",
		copied: "Link copied",
		selected: "Link selected: press Ctrl+C or ⌘C to copy it",
		consumes: (name) => `What ${name} consumes`,
		ifRun: (text) => ` · if ${text}`,
		allSections: "all 15 industry sections",
		linkNote: "Copy link shares the filters and last published scenario. It does not include this custom result.",
		link: "Link to this view",
		copy: "Copy link",
		close: "Close details",
		tabs: "Detail view",
		sankeyLabel: (total, made) =>
			`Sankey of ${total}: ${made.toLowerCase()}, industry, consumed in. The Table tab lists the same flows.`,
		baseline: " baseline flows",
		// shown: how many sections the middle column has, or null for all 15
		middle: (shown) =>
			`Middle column: ${shown === null ? "the 15" : `${shown} of the 15`} industry sections, in the same colours as the section buttons. Hover a band for its value; the Table tab lists every flow.`,
		csv: "Download CSV",
		thisRun: " · change: this run",
	},
	meaning: {
		heading: "What the numbers mean",
		flows: (source) =>
			`The map follows supply chains from final demand, what households, governments and investors buy, back to the industries where ${source}. Consumption adds up the flows behind final demand in the selected country or region, wherever they happen. Production adds up the flows that happen there, wherever the demand is. World adds up every region, so both directions give the same total. With Consumption, World colours each region by where ${source}. With Production, it colours each region by where the final demand is.`,
		whatif:
			"What if… shows how changes in one place ripple through supply chains worldwide. Each change alters the spending on one product, or the input of one product per unit of output, and the model recalculates every supply chain. Prices and all other input requirements stay fixed, and nothing replaces what is cut, so there is no substitution or rebound. These are scenarios for the 2011 economy, not forecasts.",
		method: (dataset, year) =>
			`Method: RaMa-Scene calculates these links with a demand-pull Leontief input–output model, using ${dataset} for ${year}. A scenario scales the selected technical coefficients or final demand, then solves the model again.`,
		units:
			"GHG means greenhouse-gas emissions, measured in megatonnes of CO₂-equivalent. Metal ores are measured in megatonnes extracted. Employment counts people employed who are attributed to the selected demand. The label “jobs” does not mean full-time equivalents or net job creation.",
		start:
			"Choose a country, follow its consumption footprint on the map, then try a published scenario in What if… to compare it with the baseline.",
	},

	// --- the calculation checks and the precomputed data's provenance -------------------
	provenance: {
		noRemote: "(no remote)",
		run: (summary, at) => `${summary} · generated ${at}`,
		dataset: (d) =>
			`${d.name} (${(d.creators ?? []).join(", ")}; Zenodo ${d.version}, ${d.published}) · doi:${d.doi} · EXIOBASE year ${d.year}, files *_${d.file_suffix}.npy`,
		reference: (tolerance) =>
			`The engine reproduces the Octave reference files shipped with RaMa-Scene (routes two and four; value added and GHG), ${tolerance}.`,
		independent: (values, runs, indicators, regions) =>
			`${values} world-region totals from the engine match a separate sum, B·L·ΣY (indicator intensities, supply-chain requirements, final demand), within relative 1e-9. They cover ${runs} runs, counting the baseline and the 0% control, × ${indicators} indicators × ${regions} world regions. The sum uses the engine’s own L, so it checks the aggregation, not the inverse. The cross-engine comparison in the source code checks the inverse with pymrio.`,
		control: "A 0% scenario through the same modified-coefficient path reproduces the baseline.",
		direction: (skipped) =>
			"Every published scenario changes at least one indicator total. Reductions do not raise totals for indicators with non-negative inputs" +
			(skipped.length ? ` (rise check skipped for indicators ${skipped.join(", ")}).` : "."),
		flows: "The flows the map draws add up to the engine's country totals within relative 1e-9.",
		excluded: (n) => `${n} excluded`,
		passed: "Passed",
		notPassed: "Not passed",
		heading: "Calculation checks",
		notLive: "These checks cover the published scenarios, not the custom run on screen.",
		scope:
			"These checks test numerical consistency. They do not establish whether a scenario is realistic or desirable. A fall in employment, for example, is a model result rather than a benefit.",
		policy:
			"Reference, baseline and control failures stop publication. Individual scenarios that fail a check are excluded, with the reason recorded below.",
		details: "Data and reproduction details",
		failedNote: "Excluded from this page, with the recorded reason:",
		parametersNote:
			"Exact RaMa-Scene parameters (model_details). IDs refer to the engine catalogue; techChange is a percentage:",
	},

	// --- shared by several parts of the page -------------------------------------------
	newTab: " (opens in new tab)",
	indicator: "Indicator",
	tryAgain: "Try again",
	cancel: "Cancel",
	cancelled: "Cancelled.",
	mode: { label: "Mode", flows: (year) => `Flows, ${year}`, whatif: "What if…" },
	// a precomputed run's flows, as the sidebar and the map's legend report them
	run: {
		failed: "That run could not be loaded.",
		orAnother: "or pick another.",
		loading: "Loading the run’s flows…",
	},
	consumedIn: "Consumed in",
	someSections: (n) => `${n} of 15 industry sections`,

	// --- the headline sentence, whose country and indicator are buttons --------------------
	sentence: {
		world: "world",
		the: "the ",
		allSections: " across all 15 industry sections",
		through: (what) => ` through ${what}`,
		// the word in each indicator's in.abroad and out.abroad that World replaces with "in" and a region
		abroad: "abroad",
		in: "in",
		zeroBase: "zero 2011 baseline",
		of: "of",
		when: (year, scope) => `in ${year}${scope};`,
		mostIn: ", most in",
		ifStart: (year) => `In the ${year} economy, if`,
		aChange: "; a change of",
		largest: (out) => `The largest change ${out ? "was linked to consumption in" : "occurred in"}`,
		abroadToo: ", and abroad in",
		noChange: "No change at the displayed precision",
		country: (name) => `Country: ${name}. Change`,
		indicator: (what) => `Indicator: ${what}. Change`,
		chooseCountry: "Choose a country",
		chooseIndicator: "Choose an indicator",
	},

	// --- the three numbers under the sentence ------------------------------------------
	strip: {
		allSections: "All 15 industry sections",
		abroad: "Abroad",
		forAbroad: "For consumption abroad",
		outside: (amount, name) => `${amount} outside ${name}`,
		largest: "Largest flow",
		noneAbroad: "No flow abroad",
		worldTotal: "World total",
		noTotal: "no 2011 total",
		everywhere: ", all countries and industries",
		changeBy: (name, where) => `${name}’s change, by where ${where}`,
		by: (where) => `By where ${where}`,
		regions: (whatif, name, consumption, where) =>
			`${whatif ? `The change in ${name}${consumption ? "’s consumption" : ""}` : "The world total"}, by the world region where ${where}`,
		noFlow: "no 2011 flow",
		ofTotal: (share) => `${share} of the total`,
	},

	// --- the header's basis pill and its note -----------------------------------------
	basis: {
		caveat: "Published scenarios · not forecasts",
		liveCaveat: (status) => `${status} · not forecasts`,
		thisRun: (status) => `This run: ${status}`,
		liveNote: (year) =>
			`A custom scenario for the ${year} economy, not a forecast. The published scenarios' checks do not cover it.`,
		title: "Where these numbers come from",
		model: "Demand-pull Leontief input–output model",
		note: (year) =>
			`Each published scenario changes one thing in the ${year} economy and recalculates every supply chain, with prices and all other inputs fixed. They show what that change would have done then, not what will happen.`,
		toMethod: "Method and checks",
		source: "Source code by Simon van Lierde",
	},

	// --- the page frame: header, dock and the states before the map --------------------
	app: {
		notReady: "the precomputed flows are not loaded, so the page has no layout for them",
		allSections: "all sections",
		someSections: (n) => `${n} of 15 sections`,
		formGone:
			"The custom scenario form could not load. Reload the page; it may have been updated since you opened it, or the connection dropped.",
		dark: "Dark theme",
		github: "Source code on GitHub",
		skipMap: "Skip to the map",
		skipMain: "Skip to main content",
		by: "by",
		ignored: (key, value) => `ignored ${key}=${value}`,
		checkedLabel: "Checks passed: view calculation checks and method",
		checked: "Checks passed",
		unchecked: (synthetic) => `Checks unavailable: ${synthetic ? "test data" : "a check failed"}`,
		cue: "See what one change does",
		dock: "Mode and selection",
		runFilters: "Run and filters",
		filters: "Filters",
		ifRun: (text) => `If ${text} · `,
		loading: "Loading the 2011 flows…",
	},
	// why there is no map: no data, or data that did not load
	empty: {
		heading: "No precomputed data here yet",
		check: "To check the page itself,",
		fixture: "open it with the synthetic test data",
		banner: ". A banner marks it as test data.",
		resultsIn: "The real results are in",
		flowsIn: "and the embodied flows in",
		onlyEngine: ". Only a run of the engine on the EXIOBASE dataset makes them:",
		noResults: "The scenario results could not be loaded.",
		dropped: "The connection may have dropped while reading",
		reload: ". Reload the page to try again.",
		noFlows: "The embodied flows are not here.",
		asset: "ships as a release asset, not in git. Fetch it next to",
		flowsFailed: "The 2011 flows could not be loaded.",
		mismatch: "The embodied flows come from a different run",
		than: "than",
		regenerate:
			"(dataset, engine commit or time differ), so they are not shown next to it. Regenerate both in one precompute run.",
	},

	// --- the sidebar, a bottom sheet on a phone ----------------------------------------
	side: {
		label: "Selection",
		heading: "Choose what to show",
		done: "Done",
		worldChange: (change) => `world ${change}`,
		efficiency: "Material efficiency",
		scenario: "Scenario",
		customShown: "Custom scenario shown",
		published: (n) => `${n} published scenarios`,
		changeLabel: "Change the scenario",
		change: "Change",
		gridTitle: "Material efficiency, one product",
		gridSize: (products, cuts) => `${products} products × 5 regions × ${cuts} cuts`,
		back: "Back to published scenarios",
		product: "Input product",
		region: "In every industry of",
		cut: "By",
		gridFailed: (why) => `This combination was run but failed a check, so it is not shown: ${why}`,
		gridMissing: "This combination was not precomputed.",
		doneLabel: "Done picking the product, region and cut",
		country: "Country or region",
		regions: (n) => `${n} regions`,
		direction: "Direction",
		consumption: "Consumption",
		production: "Production",
		sections: "Industry sections",
		sectionsShare: (whatif) => `share of the ${whatif ? "2011 " : ""}flows`,
		tools: "Theme and source code",
	},

	// --- the selection: industry rail, country box, catalogue pickers ------------------
	rail: {
		all: (n) => `All ${n} sections`,
		share: (share) => ` ${share} of the selection`,
		off: ", off",
	},
	countryBox: { list: "Countries and regions", none: "No region matches" },
	picker: {
		search: (label) => `Search ${label.toLowerCase()}`,
		placeholder: "Type to narrow the list",
		none: (query) => `No match for “${query}”.`,
	},

	// --- a custom run's totals by region -----------------------------------------------
	totals: {
		headline: (noun, change, share, browser, base) =>
			`Summed over all regions, ${noun} would change by ${change} (${share}) against ${browser ? "its baseline" : "the job’s own baseline"} of ${base}.`,
		browserTable: "The browser scenario’s totals by region",
		jobTable: "The job’s totals by region",
		columns: ["Region", "Baseline", "Scenario", "Change", "Change %"],
	},

	// --- the custom scenario form ---------------------------------------------------------
	form: {
		removed: (n) => `Change ${n} removed.`,
		busy: "A scenario is already running. Wait for it to finish, then try again.",
		reloading: "The scenario data is loading again; try again.",
		broad: (why) => `This selection is ${why}`,
		allProducts: "All products",
		download: (mb) => `This selection downloads about ${mb} MB of data.`,
		back: "Back on the published scenario. Run again to see the custom result.",
		loading: "Loading browser scenario data…",
		connecting: (api) => `Connecting to ${api}…`,
		codeGone:
			"The browser scenario code could not load. Reload the page; it may have been updated since you opened it, or the connection dropped.",
		ready: "Ready to compute in this browser.",
		connected: (api) => `Connected to ${api}.`,
		dataFailed: (why) => `Browser data could not load: ${why}. Try again.`,
		cancelledJob: "Cancelled. The job API may still finish the job, and runs one job at a time.",
		computing: "Computing the scenario in this browser…",
		sending: "Sending the scenario…",
		jobStatus: (job) => `Job ${job.id}: ${job.status}…`,
		lessThan: "less than 0.1",
		computed: (s) => `Computed in this browser in ${s} s.`,
		finished: (id, s) => `Job ${id} finished in ${s} s.`,
		mapped: (whatif) =>
			`${whatif ? " The map shows its flows." : " What if… shows its flows on the map."} Details → Method lists the totals by region.`,
		unmapped: (why) => ` Its flows are not on the map: ${why}`,
		failed: (browser, why) => `${browser ? "Scenario" : "Job"} failed: ${why}`,
		title: "Custom scenario",
		inBrowser: "Computed in this browser",
		onApi: (api) => `Calculated by the job API at ${api}`,
		close: "Close",
		open: "Set up",
		status: (status) => `Results are ${status}.`,
		browserIntro: "Changes to the 2011 economy, against the published baseline. Nothing is sent to a server.",
		apiIntro:
			"Changes to the 2011 economy, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (a few seconds; one job runs at a time). The result is compared with the baseline computed in the same job.",
		lever: (n) => `Change ${n}`,
		product: "Product",
		origin: "Produced in",
		consumer: "Used by (industry or final demand)",
		consumedIn: "Used in (region)",
		change: "Input or demand change, %",
		changeHelp: (min, max) =>
			`For an industry, this changes its input of the product per unit of output. For final demand, it changes spending on the product. A negative value is a cut. Range: ${min} to +${max}%.`,
		remove: (n) => `Remove change ${n}`,
		add: "Add a change",
		atMost: (n) => ` (at most ${n})`,
		overlap: "Changes to the same input or spending multiply: two cuts of 20% leave 64%, not 60%.",
		running: "Running…",
		run: "Run scenario",
		provenance: (browser) => `Provenance (${browser ? "browser computation" : "live job"})`,
	},

	// --- Ask: a question to a model the reader runs -----------------------------------------
	ask: {
		rephrase: ". Rephrase the question and ask again.",
		noData: "the scenario data did not load. Open Custom scenario, use Try again if it shows, then ask again",
		nothing: "Nothing was run, and the map is unchanged.",
		noAction: "the model's answer had no action this page can run. Ask again, in other words",
		title: "Ask in plain words",
		who: (base) =>
			`The model at ${base} only picks the changes to make. The engine in this page computes every number.`,
		question: "Question",
		example: "For example: What if European car makers used 20% less steel?",
		asking: "Asking…",
		ask: "Ask",
		busy: "Asking the model, then running the engine…",
		says: (reply) => `The model says: ${reply}`,
		chose: "The model chose these changes and the engine ran them. Check them against your question:",
	},

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
		stillRunning: (status, s) => `job still ${status} after ${s} s`,
		manyChanges: (n) => `${n} changes were made together`,
		demandClause: (where, product, origin, change) =>
			`final demand${where} for ${product}${origin} ${change < 0 ? "fell" : change > 0 ? "rose" : "changed"} by ${Math.abs(change)}%`,
		inputClause: (users, where, product, origin, change) =>
			`${users}${where} required ${Math.abs(change)}% ${change < 0 ? "less" : "more"} ${product}${origin} per unit of output`,
		pill: "Live job: not covered by checks",
		heading: "This run: computed live",
		note: "The calculation checks below cover the published scenarios, not this job. The map shows a job the job API computed while you waited, against the baseline from the same job.",
	},

	// --- custom scenarios computed in the browser --------------------------------------
	browser: {
		status: "computed in this browser",
		pill: "Custom run: not covered by checks",
		heading: "Custom calculation",
		note: "The calculation checks below cover the published scenarios, not this custom run. The same browser calculation reproduces every published scenario’s world-region totals within relative 1e-6 of RaMa-Scene. A custom run makes the same assumptions as a published one: prices and all other inputs stay fixed, and nothing replaces what is cut.",
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
