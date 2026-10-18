<script>
import { banner, dataUrl, ignoredData, sameRun } from "../explorer.js";
import { embodiedUrl, openEmbodiedUrl, readRun } from "../embodied.js";
import { continents, fitExtent, parseView, summarise, viewSearch } from "../flows.js";
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
let shown = $state.raw(null); // {run, delta}: the run on screen; the next one may still be loading
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
		src = await openEmbodiedUrl(embodiedUrl(dataPath));
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
	base = await readRun(src, "baseline");
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
let wanted = "";
async function showRun(run) {
	wanted = run;
	loadingRun = run;
	try {
		const d = await fetchRun(run);
		if (wanted !== run) return;
		shown = { run, delta: d };
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
		ui.s = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2; // cubic in-out
		if (p < 1) frame = requestAnimationFrame(step);
	};
	ui.s = 0;
	frame = requestAnimationFrame(step);
}
const stop = () => cancelAnimationFrame(frame);

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
const sum = $derived(ready ? summarise(meta, base, whatif ? delta : null, sel) : null);
const extent = $derived(whatif ? fitExtent(meta, base, delta, ind, ui.on) : 1);
const conts = $derived(ready && whatif ? continents(meta, base, delta, sel) : null);

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

<div class="shell">
	<header class="top">
		<div class="brand">
			<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6" fill="var(--acc)" /><path d="M4 16C8 7 13 6 18 6" fill="none" stroke="#fff" stroke-width="3.2" /><path d="M4 16C8 9 13 8 18 8" fill="none" stroke="#fff" stroke-width=".9" /></svg>
			<h1>RaMa-Scene Explorer</h1>
		</div>
		<div class="rt" id="status">
			{#if ignored !== null}<span class="pill fail">ignored data={ignored}</span>{/if}
			{#if refusedApi !== null}<span class="pill fail">ignored api={refusedApi}</span>{/if}
			{#if data}
				<span class="pill basis">{data.provenance.dataset.name} · {data.base_year} · precomputed, not a forecast</span>
				<button type="button" class="pill ok" onclick={() => (ui.panel = "method")} aria-label="Verified: how this was computed and checked">
					<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
					Verified
				</button>
			{/if}
		</div>
	</header>

	{#if ready}
		<Sidebar {data} {meta} {sum} {whatif} {loadingRun} {setMode} {setRun} />
		<main class="main" id="app">
			<Sentence {data} {meta} {sum} {whatif} {run} />
			<Strip {meta} {sum} {conts} {whatif} {extent} />
			<FlowMap {meta} {sum} {whatif} {extent} {play} {stop} {loadingRun} />
		</main>
		<Details {data} {meta} {sum} {whatif} {run} />
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
			{:else}
				<p><strong>The embodied flows come from a different run</strong> than <code>{dataPath}</code> (dataset, engine commit or time differ), so they are not shown next to it. Regenerate both in one precompute run.</p>
			{/if}
		</main>
	{:else}
		<main class="main solo" aria-busy="true"><p class="loading">Loading the 2011 flows…</p></main>
	{/if}
</div>

{#if api}{#await import("./LivePanel.svelte") then { default: LivePanel }}<LivePanel {api} />{/await}{/if}
