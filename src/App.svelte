<script>
import { cubicInOut } from "svelte/easing";
import { banner, dataUrl, ignoredData, sameRun } from "../explorer.js";
import { embodiedUrl, openEmbodiedUrl, readRun } from "../embodied.js";
import { continents, fitExtent, parseView, runText, summarise, viewSearch, wording } from "../flows.js";
import { apiUrl, ignoredApi } from "../live.js";
import Details from "./Details.svelte";
import FlowMap from "./FlowMap.svelte";
import Sentence from "./Sentence.svelte";
import Sidebar from "./Sidebar.svelte";
import Strip from "./Strip.svelte";
import { reducedMotion, ui } from "./view.svelte.js";

const search = location.search;
const dataPath = dataUrl(search);
const ignored = ignoredData(search);
// Optional live panel: nothing is imported, and nothing is fetched, without ?api=.
const api = apiUrl(search);
const refusedApi = ignoredApi(search);

let data = $state.raw(null);
let empty = $state(false);
let src = $state.raw(null); // the opened Parquet file
let flowsError = $state("");
let base = $state.raw(null);
// {run, base, delta}: the run on screen, as dense arrays in meta's layout; the next one may still
// be loading. Every flow source hands the page this shape, so the map, Strip and Details never
// know where a run came from. base is the baseline the run is a change against.
let shown = $state.raw(null);
let loadingRun = $state("");
let ready = $state(false);
const flag = $derived(data && banner(data));

load();
async function load() {
	try {
		const response = await fetch(dataPath, { cache: "no-cache" });
		if (!response.ok) throw new Error(response.status);
		data = await response.json();
	} catch {
		empty = true;
		return;
	}
	if (banner(data).synthetic) {
		document.title = `${banner(data).text} · ${document.title}`;
		document.body.classList.add("synthetic");
	}
	try {
		src = await openEmbodiedUrl(embodiedUrl(dataPath), data.provenance?.embodied?.bytes);
	} catch {
		flowsError = "missing";
		return;
	}
	if (!sameRun(src.meta, data)) {
		flowsError = "mismatch";
		return;
	}
	Object.assign(
		ui,
		parseView(location.search, {
			runs: src.meta.runs,
			indicators: src.meta.indicators.map((i) => i.id),
			codes: src.meta.country_codes,
		}),
	);
	try {
		base = await readRun(src, "baseline");
	} catch {
		flowsError = "failed";
		return;
	}
	ready = true;
	if (ui.mode === "whatif") showRun(ui.run);
	// the default run, so the first switch to What if… does not wait
	else (window.requestIdleCallback ?? setTimeout)(() => fetchRun(ui.run).catch(() => {}));
}

// --- runs: fetched once each, by range request -------------------------------------
const cache = new Map();
function fetchRun(run) {
	if (!cache.has(run))
		cache.set(
			run,
			readRun(src, run).catch((e) => {
				cache.delete(run);
				throw e;
			}),
		);
	return cache.get(run);
}
const showRun = (run) => show(run, async () => ({ run, base, delta: await fetchRun(run) }));

// load: () => Promise<{run, base, delta}>, from any flow source
let wanted = "";
async function show(run, load) {
	wanted = run;
	loadingRun = run;
	try {
		const next = await load();
		if (wanted !== run) return;
		shown = next;
		loadingRun = "";
		play();
	} catch {
		if (wanted === run) loadingRun = `failed:${run}`;
	}
}

// --- the replay: the scrubber from the 2011 baseline to the run -----------------------
let frame = 0;
function play() {
	cancelAnimationFrame(frame);
	if (reducedMotion()) {
		ui.s = 1;
		return;
	}
	const start = performance.now();
	const ms = 1600;
	const step = (now) => {
		const p = Math.min(1, (now - start) / ms);
		ui.s = cubicInOut(p);
		if (p < 1) frame = requestAnimationFrame(step);
	};
	ui.s = 0;
	frame = requestAnimationFrame(step);
}
const stop = () => cancelAnimationFrame(frame);

// phone: the selection lives in a bottom sheet opened from the dock
let sheet = $state(false);
let sheetOpener = $state();
function closeSheet() {
	sheet = false;
	sheetOpener?.focus();
}
const summary = $derived(
	ready
		? `${meta.countries[ui.who]} · ${wording(ui.indicator).label} · ${ui.on.size === 15 ? "all sections" : `${ui.on.size} of 15 sections`}`
		: "",
);

function setMode(mode) {
	if (ui.mode === mode) return;
	stop();
	ui.mode = mode;
	ui.s = 1;
	if (mode === "whatif") showRun(ui.run);
}
function setRun(run) {
	stop();
	ui.run = run;
	showRun(run);
}

// --- what the page shows ----------------------------------------------------------
const meta = $derived(src?.meta);
const ind = $derived(meta ? meta.indicators.findIndex((i) => i.id === ui.indicator) : 0);
const sel = $derived({ ind, id: ui.indicator, who: ui.who, dir: ui.dir, on: ui.on });
const whatif = $derived(ui.mode === "whatif" && shown !== null);
const delta = $derived(shown?.delta);
const run = $derived(shown?.run);
const sum = $derived(ready ? summarise(meta, whatif ? shown.base : base, whatif ? delta : null, sel) : null);
const extent = $derived(whatif ? fitExtent(sum) : 1);
const conts = $derived(ready && whatif ? continents(meta, sum) : null);
// "Verified" only for engine output whose every published run passed every check
const verified = $derived(data?.data_kind === "exiobase-v3" && data.checks?.published_passed_every_check === true);

// the selection lives in the query string, so every view can be shared
$effect(() => {
	if (!ready) return;
	const q = viewSearch(ui, meta.country_codes, location.search);
	if (q !== location.search) history.replaceState(null, "", `${location.pathname}${q}${location.hash}`);
});
</script>

{#if flag?.synthetic}
	<div id="banner" class="banner" role="alert">{flag.text}</div>
{/if}

<a class="skip" href="#app" inert={ui.panel !== null}>Skip to the map</a>
<div class="shell">
	<header class="top" inert={ui.panel !== null}>
		<div class="brand">
			<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6" fill="var(--acc)" /><path d="M4 16C8 7 13 6 18 6" fill="none" stroke="#fff" stroke-width="3.2" /><path d="M4 16C8 9 13 8 18 8" fill="none" stroke="#fff" stroke-width=".9" /></svg>
			<h1>RaMa-Scene Explorer</h1>
			<span class="by">by <a href="https://github.com/simonvanlierde">Simon van Lierde</a></span>
		</div>
		<div class="rt" id="status">
			{#if ignored !== null}<span class="pill fail">ignored data={ignored}</span>{/if}
			{#if refusedApi !== null}<span class="pill fail">ignored api={refusedApi}</span>{/if}
			{#if data}
				<span class="pill basis"><span class="ds">{data.provenance.dataset.name} · {data.base_year} · </span>precomputed, not a forecast</span>
				{#if verified}
					<button type="button" class="pill ok" onclick={() => (ui.panel = "method")} aria-label="Verified: how this was computed and checked">
						<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
						Verified
					</button>
				{:else}
					<button type="button" class="pill unverified" onclick={() => (ui.panel = "method")}>Not verified: {flag?.synthetic ? "test data" : "a check failed"}</button>
				{/if}
			{/if}
			<a class="pill gh" href="https://github.com/simonvanlierde/ramascene-explorer" aria-label="Source code on GitHub" title="Source code on GitHub">
				<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
			</a>
		</div>
	</header>

	{#if ready}
		<Sidebar {data} {meta} {sum} {whatif} {loadingRun} {setMode} {setRun} {sheet} onclose={closeSheet} inert={ui.panel !== null} />
		<main class="main" id="app" tabindex="-1" inert={ui.panel !== null}>
			<Sentence {data} {meta} {sum} {whatif} {run} />
			<Strip {meta} {sum} {conts} {whatif} {extent} />
			<FlowMap {meta} {sum} {whatif} {extent} {play} {stop} {loadingRun} />
		</main>
		<Details {data} {meta} {sum} {whatif} {run} />
		<nav class="dock" aria-label="Mode and selection" inert={ui.panel !== null}>
			<div class="seg big" role="group" aria-label="Mode">
				<button type="button" aria-pressed={ui.mode === "flows"} onclick={() => setMode("flows")}>Flows, {data.base_year}</button>
				<button type="button" aria-pressed={ui.mode === "whatif"} onclick={() => setMode("whatif")}>What if…</button>
			</div>
			<button type="button" class="filters" bind:this={sheetOpener} aria-expanded={sheet} aria-controls="side" onclick={() => (sheet = true)}>
				<span class="fl">{ui.mode === "whatif" ? "Run and filters" : "Filters"}</span><span class="fs">{ui.mode === "whatif" && run ? `If ${runText(data, run)} · ` : ""}{summary}</span>
			</button>
		</nav>
	{:else if flowsError || empty}
		<main class="main solo" id="empty">
			{#if empty}
				<p><strong>No precomputed data here yet.</strong> The page reads <code>data/results.json</code> and the embodied flows in <code>data/embodied.parquet</code>, which only a run of the engine on the EXIOBASE dataset produces:</p>
				<pre>uv run python precompute.py --run --engine "$ENGINE_DIR" --data "$DATASETS_DIR" \
    --out data/results.json --out-embodied data/embodied.parquet</pre>
				<p>To check the page itself, open it with <code>?data=tests/fixture.json</code> (synthetic, bannered).</p>
			{:else if flowsError === "missing"}
				<p><strong>The embodied flows are not here.</strong> <code>{embodiedUrl(dataPath)}</code> ships as a release asset, not in git. Fetch it next to <code>results.json</code>:</p>
				<pre>gh release download data-2011 --pattern embodied.parquet --dir data</pre>
			{:else if flowsError === "failed"}
				<p role="alert"><strong>The 2011 flows could not be loaded.</strong> The connection may have dropped while reading <code>{embodiedUrl(dataPath)}</code>. Reload the page to try again.</p>
			{:else}
				<p><strong>The embodied flows come from a different run</strong> than <code>{dataPath}</code> (dataset, engine commit or time differ), so they are not shown next to it. Regenerate both in one precompute run.</p>
			{/if}
		</main>
	{:else}
		<main class="main solo" aria-busy="true"><p class="loading">Loading the 2011 flows…</p></main>
	{/if}
</div>

{#if api}{#await import("./LivePanel.svelte") then { default: LivePanel }}<LivePanel {api} />{/await}{/if}
