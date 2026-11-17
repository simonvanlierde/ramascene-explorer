<script>
// Custom form: computes in the browser, or on the job API with ?api=. This component alone contacts the job
// API; its text is never rendered as markup.
import { onDestroy, tick } from "svelte";
import { BROWSER_STATUS, browserProvenance } from "./lib/browser-engine/browser-results.js";
import {
	CHANGE_RANGE,
	catalogTree,
	rootNamed,
	LIVE_STATUS,
	liveProvenance,
	formChange,
	liveClauses,
	liveText,
	minus,
	scenarioBody,
	unreachableMessage,
	waitForJob,
} from "./lib/live.js";
import { plan } from "./lib/browser-engine/browser-engine.js";
import { fmt } from "./lib/flows.js";
import LiveTotals from "./LiveTotals.svelte";
import Picker from "./Picker.svelte";
import { ui } from "./view.svelte.js";

// onflows(job, text, clauses): shows a finished job's flows on the map; true if it had flows to show
// onnews(text, alert): every status message, for a live region outside the selection sheet
// onscreen: the custom run is the one the map shows
let { api, browser = false, onscreen = false, onflows, onnews } = $props();
let client;
let connection = 0;
onDestroy(() => { connection++; client?.close(); });
const status = $derived(browser ? BROWSER_STATUS : LIVE_STATUS);

// A request that stalls (a half-open tunnel, a laptop waking from sleep) fails after 30 s;
// a run's own signal also stops it, for Cancel. Without AbortSignal.any (Safari before 17.4),
// a run's request keeps only Cancel.
async function fetchJson(url, { signal, ...init } = {}) {
	const timeout = AbortSignal.timeout(30_000);
	const response = await fetch(url, { cache: "no-store", ...init, signal: signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal ?? timeout) });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = Array.isArray(body.detail)
			? body.detail.map((d) => formChange(typeof d === "string" ? d : `${d.loc?.join(".")}: ${d.msg}`)).join("; ")
			: body.detail;
		throw new Error(`${response.status}: ${detail ?? response.statusText}`);
	}
	return body;
}

// The planner's cap on interventions (plan() throws above it)
const MAX_LEVERS = 10;
// The explorer's steel-into-vehicles scenario, preselected so one click reproduces it.
// Each lever is one intervention; change is as typed, so the too-broad check plans what Run would send.
let nextKey = 0;
const lever = (from = { product: "180", origin: "1", consumer: "198", consumedReg: "2", change: "-20" }) => ({ ...from, key: nextKey++ });
let levers = $state([lever()]);
// lever 1 keeps the ids the first version had; later levers add their number
const at = (name, i) => (i ? `live-${name}-${i + 1}` : `live-${name}`);
async function addLever() {
	levers.push(lever(levers.at(-1)));
	await tick();
	const first = document.getElementById(at("product", levers.length - 1));
	first?.focus({ preventScroll: true });
	first?.closest("fieldset")?.scrollIntoView({ block: "start" });
}
// focus goes to the previous lever (or the new first one), never to the removed row
async function removeLever(i) {
	levers.splice(i, 1);
	say(`Change ${i + 1} removed.`);
	await tick();
	document.getElementById(at("product", Math.max(i - 1, 0)))?.focus();
}
let catalog = $state.raw(null);
let message = $state("");
let failed = $state(false);
let unreachable = $state(false);
// the worker files did not load: Run would fail the same way until a reload
let outdated = $state(false);
let running = $state(false);
let elapsed = $state(0);
// set by Cancel, so the stopped run's error stays quiet
let cancelled = false;
// aborts a job-API run's requests; the job itself may still finish on the server
let stopJob;
let job = $state.raw(null);
// false while the panel shows a finished job the map could not draw
let mapped = $state(true);

// the change the job API accepts: GET /catalog says, or its known range
const range = $derived(catalog?.tech_change_percent ?? CHANGE_RANGE);
// the form folds into one card under the run list until it is opened, and
// the browser data loads on the first open, not with the page
let open = $state(false);
let connected = false;
// the connection in progress, resolving to the catalogue (null if it failed)
let connecting = Promise.resolve(null);
function ensureConnected() {
	if (!connected) {
		connected = true;
		connect();
	}
}
function toggle() {
	open = !open;
	ui.custom = open;
	if (open) ensureConnected();
}
// For the Ask panel, which shares this panel's worker: the catalogue, once loaded.
export async function catalogue() {
	ensureConnected();
	return browser ? connecting : null;
}
// For the Ask panel: plans the scenario, then runs it as Run does. Resolves to {ok, text}.
export async function runScenario(scenario) {
	if (running) return { ok: false, text: "A scenario is already running." };
	try {
		plan({ catalog, ...catalog.size }, scenario.model_details);
	} catch (e) {
		const text = e.message.startsWith("too broad") ? `This selection is ${e.message}` : e.message;
		say(text, true);
		return { ok: false, text };
	}
	return execute(scenario);
}
const trees = $derived({
	products: catalogTree(rootNamed(catalog?.products, "All products")),
	regions: catalogTree(rootNamed(catalog?.regions, "World")),
	consumers: catalogTree(catalog?.consumers),
});
const body = () =>
	scenarioBody(
		levers.map((l) => ({ product: l.product, originReg: l.origin, consumedBy: l.consumer, consumedReg: l.consumedReg, techChange: l.change })),
		range,
	);
// a browser selection's plan before Run: what it downloads, or why it is too large
const planned = $derived.by(() => {
	if (!browser || !catalog) return {};
	try {
		return { download: plan({ catalog, ...catalog.size }, body().model_details).download };
	} catch (e) {
		// other errors surface on Run
		return { tooBroad: e.message.startsWith("too broad") ? `This selection is ${e.message}` : "" };
	}
});
const tooBroad = $derived(planned.tooBroad ?? "");
// said only above 5 MB, where the download is what a reader on a phone may wait for
const download = $derived(planned.download > 5e6 ? `This selection downloads about ${fmt(planned.download / 1e6)} MB of data.` : "");

// the map went back to a published scenario: the last result message no longer holds
let wasOnscreen = false;
$effect(() => {
	if (onscreen) wasOnscreen = true;
	else if (wasOnscreen) {
		wasOnscreen = false;
		say("Back on the published scenario. Run again to see the custom result.");
	}
});
function say(text, bad = false) {
	message = text;
	failed = bad;
	onnews?.(text, bad);
}

// quiet: after a failed run, keep its message while a fresh worker starts
function connect({ quiet = false } = {}) {
	const attempt = ++connection;
	unreachable = false;
	outdated = false;
	if (!quiet) say(browser ? "Loading browser scenario data…" : `Connecting to ${api}…`);
	// the client's own file gone (a deploy since the page loaded) is as stale as a missing worker
	let gone = false;
	const loading = browser
		? import("./lib/browser-engine/browser-client.js").then(({ browserClient }) => {
			if (attempt !== connection) return null;
			client?.close();
			client = browserClient();
			return client.request();
		}, () => {
			gone = true;
			throw new Error("The browser scenario code could not load. Reload the page; it may have been updated since you opened it, or the connection dropped.");
		})
		: fetchJson(`${api}/catalog`);
	connecting = loading.then(
		(c) => {
			if (attempt !== connection) return null;
			catalog = c;
			if (!quiet) say(browser ? "Ready to compute in this browser." : `Connected to ${api}.`);
			return c;
		},
		(e) => {
			if (attempt !== connection) return null;
			// Try again would load the same missing worker files: only a reload helps
			outdated = browser && (gone || client?.outdated === true);
			unreachable = !outdated;
			say(outdated ? e.message : browser ? `Browser data could not load: ${e.message}. Try again.` : unreachableMessage(api, e), true);
			return null;
		},
	);
}
// While the form is open, the worker starts reading the selection it shows, so Run
// waits only for what is left. Sent once per change, half a second after the last.
let sent = "";
$effect(() => {
	if (!browser || !open || !catalog || running || tooBroad) return;
	let scenario;
	try {
		scenario = body();
	} catch {
		return;
	}
	const text = JSON.stringify(scenario.model_details);
	if (text === sent) return;
	const timer = setTimeout(() => {
		sent = text;
		client?.prefetch(scenario);
	}, 500);
	return () => clearTimeout(timer);
});

// Stops a run: in the browser a fresh worker replaces the busy one; on the job API the page
// stops waiting, and says the job may still finish there.
function cancel() {
	cancelled = true;
	if (browser) {
		sent = "";
		connect();
	} else {
		stopJob?.abort();
		say("Cancelled. The job API may still finish the job, and runs one job at a time.");
	}
	document.getElementById("live-run")?.focus();
}

// Try again goes as soon as it is pressed: focus the card's own button instead
function retryConnect() {
	connect();
	document.getElementById("live-open")?.focus();
}

async function submit(event) {
	event.preventDefault();
	// Run stays focusable while a job runs (aria-disabled), so a second press lands here
	if (running) return;
	let scenario;
	try {
		scenario = body();
	} catch (e) {
		say(e.message, true);
		return;
	}
	await execute(scenario);
}

// Runs a scenario and shows it on the map; both Run and the Ask panel come here.
async function execute(scenario) {
	let result = { ok: false, text: "" };
	running = true;
	cancelled = false;
	elapsed = 0;
	const started = performance.now();
	const tick = setInterval(() => (elapsed = (performance.now() - started) / 1000), 100);
	say(browser ? "Computing the scenario in this browser…" : "Sending the scenario…");
	const controller = new AbortController();
	stopJob = controller;
	const { signal } = controller;
	try {
		const submitted = browser ? null : await fetchJson(`${api}/jobs`, {
			signal,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(scenario),
		});
		const done = browser ? await client.request(scenario) : await waitForJob((url) => fetchJson(url, { signal }), `${api}/jobs/${submitted.id}`, {
			signal,
			onUpdate: (j) => say(`Job ${j.id}: ${j.status}…`),
		});
		if (done.status === "failed") throw new Error(done.error);
		job = done;
		mapped = false;
		const duration = done.duration_s < 0.1 ? "less than 0.1" : done.duration_s.toFixed(1);
		let text = browser ? `Computed in this browser in ${duration} s.` : `Job ${done.id} finished in ${duration} s.`;
		try {
			mapped = onflows?.(done, liveText(done, catalog), liveClauses(done, catalog)) === true;
			if (mapped)
				text += `${ui.mode === "whatif" ? " The map shows its flows." : " What if… shows its flows on the map."} Details → Method lists the totals by region.`;
		} catch (e) {
			text += ` Its flows are not on the map: ${e.message}`;
		}
		say(text);
		result = { ok: true, text };
	} catch (e) {
		if (cancelled) return result;
		result = { ok: false, text: `${browser ? "Scenario" : "Job"} failed: ${e.message}` };
		say(result.text, true);
		// a trap or a timeout stopped the worker: start a fresh one for the next Run
		if (browser && client?.stopped) {
			sent = "";
			connect({ quiet: true });
		}
	} finally {
		clearInterval(tick);
		running = false;
	}
	return result;
}
</script>

<!-- the visible status line; App reads the same messages out -->
{#snippet state()}
	<p id="live-state" class="hint" class:bad={failed}>{message}</p>
	{#if unreachable}<button type="button" class="chipb" id="live-retry" onclick={retryConnect}>Try again</button>{/if}
{/snippet}

<section id="live" aria-labelledby="live-title">
	<div class="run chosen live-card">
		<span><b id="live-title">Custom scenario</b><small>{browser ? "Computed in this browser" : `Calculated by the job API at ${api}`}</small></span>
		<button type="button" class="change" id="live-open" aria-expanded={open} aria-controls="live-body" onclick={toggle}>{open ? "Close" : "Set up"}</button>
	</div>
	{#if !open}{@render state()}{/if}
	<div id="live-body" class="live-body" hidden={!open}>
		<!-- the card already says where a browser run is computed -->
		{#if !browser}<p class="live-label" id="live-label">Results are {status}.</p>{/if}
		<p class="hint">{browser ? "Changes to the 2011 economy, against the published baseline. Nothing is sent to a server." : "Changes to the 2011 economy, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (a few seconds; one job runs at a time). The result is compared with the baseline computed in the same job."}</p>
		<!-- the pickers need the catalog; without it the status line says why -->
		<form id="live-form" onsubmit={submit} aria-busy={running} hidden={!catalog}>
			{#each levers as l, i (l.key)}
				<fieldset class="lever">
					<legend>Change {i + 1}</legend>
					<Picker id={at("product", i)} label="Product" tree={trees.products} bind:value={l.product} />
					<Picker id={at("origin", i)} label="Produced in" tree={trees.regions} bind:value={l.origin} />
					<Picker id={at("consumer", i)} label="Used by" tree={trees.consumers} bind:value={l.consumer} />
					<Picker id={at("consumed-reg", i)} label="Used in" tree={trees.regions} bind:value={l.consumedReg} />
					<label for={at("change", i)}>Input or demand change, %</label>
					<input id={at("change", i)} type="number" step="any" min={range.min} max={range.max} value={l.change} oninput={(e) => (l.change = e.currentTarget.value)} required aria-describedby="live-change-h" />
					{#if i === 0}<small class="fh" id="live-change-h">For an industry: inputs per unit of output. For final demand: spending. Negative values reduce it. Range: {minus(range.min)} to +{range.max}%.</small>{/if}
					{#if levers.length > 1}<button type="button" class="chipb remove" id={at("remove", i)} onclick={() => removeLever(i)}>Remove change {i + 1}</button>{/if}
				</fieldset>
			{/each}
			<button type="button" class="chipb add" id="live-add" disabled={levers.length >= MAX_LEVERS} onclick={addLever}>Add a change{levers.length >= MAX_LEVERS ? ` (at most ${MAX_LEVERS})` : ""}</button>
			{#if levers.length > 1}<small class="fh" id="live-overlap">Changes to the same input or spending multiply: two cuts of 20% leave 64%, not 60%.</small>{/if}
			<!-- always present, so a screen reader announces the message as it comes and goes -->
			<p class="hint bad" id="live-broad" role="status">{tooBroad}</p>
			{#if download}<p class="hint" id="live-download">{download}</p>{/if}
			<button type="submit" class="go" id="live-run" disabled={unreachable || outdated || !catalog || tooBroad !== ""} aria-describedby={tooBroad ? "live-broad" : download ? "live-download" : undefined} aria-disabled={running}>{running ? "Running…" : "Run scenario"}</button>
			{#if running}
				<p class="hint live-elapsed">
					<!-- the status line announces the start and the result; the count is for sighted readers -->
					<span aria-hidden="true">{elapsed.toFixed(1)} s</span>
					<button type="button" class="chipb" id="live-cancel" onclick={cancel}>Cancel</button>
				</p>
			{/if}
		</form>
		<!-- under Run while the form is open, so its answer is where the reader is -->
		{#if open}{@render state()}{/if}
		<!-- a job the map cannot draw stays here; a mapped run's totals are in Details -->
		{#if job && !mapped}
			<div id="live-result">
				<LiveTotals {job} {browser} ids="live-job" />
				<details>
					<summary>Provenance ({browser ? "browser computation" : "live job"})</summary>
					<dl id="live-provenance">
						{#each browser ? browserProvenance(job) : liveProvenance(job, api) as [k, v]}
							<dt>{k}</dt>
							<dd>{#if k === "Scenario parameters"}<pre>{v}</pre>{:else}{v}{/if}</dd>
						{/each}
					</dl>
				</details>
			</div>
		{/if}
	</div>
</section>
