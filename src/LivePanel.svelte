<script>
// Custom form: computes in the browser, or on the job API with ?api=. This component alone contacts the job
// API; its text is never rendered as markup.
import { onDestroy } from "svelte";
import { BROWSER_STATUS, browserProvenance } from "./lib/browser-engine/browser-results.js";
import {
	CHANGE_RANGE,
	catalogTree,
	LIVE_STATUS,
	liveProvenance,
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

// onflows(job, text): shows a finished job's flows on the map; true if it had flows to show
// onnews(text, alert): every status message, for a live region outside the selection sheet
let { api, browser = false, onflows, onnews } = $props();
let client;
let connection = 0;
onDestroy(() => { connection++; client?.close(); });
const status = $derived(browser ? BROWSER_STATUS : LIVE_STATUS);

async function fetchJson(url, init) {
	const response = await fetch(url, { cache: "no-store", ...init });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = Array.isArray(body.detail)
			? body.detail.map((d) => (typeof d === "string" ? d : `${d.loc?.join(".")}: ${d.msg}`)).join("; ")
			: body.detail;
		throw new Error(`${response.status}: ${detail ?? response.statusText}`);
	}
	return body;
}

// The explorer's steel-into-vehicles scenario, preselected so one click reproduces it.
let pick = $state({ product: "180", origin: "1", consumer: "198", consumedReg: "2" });
// the form's change as typed, so the too-broad check plans what Run would send
let change = $state("-20");
let catalog = $state.raw(null);
let message = $state("");
let failed = $state(false);
let unreachable = $state(false);
let running = $state(false);
let elapsed = $state(0);
// set by Cancel, so the stopped run's error stays quiet
let cancelled = false;
let job = $state.raw(null);
// false while the panel shows a finished job the map could not draw
let mapped = $state(true);

// the change the job API accepts: GET /catalog says, or its known range
const range = $derived(catalog?.tech_change_percent ?? CHANGE_RANGE);
// the form folds into one card under the run list until it is opened, and
// the browser data loads on the first open, not with the page
let open = $state(false);
let connected = false;
function toggle() {
	open = !open;
	ui.custom = open;
	if (open && !connected) {
		connected = true;
		connect();
	}
}
const trees = $derived({
	products: catalogTree(catalog?.products),
	regions: catalogTree(catalog?.regions),
	consumers: catalogTree(catalog?.consumers),
});
const body = (techChange) =>
	scenarioBody({ product: pick.product, originReg: pick.origin, consumedBy: pick.consumer, consumedReg: pick.consumedReg, techChange }, range);
// a browser selection's plan before Run: what it downloads, or why it is too large
const planned = $derived.by(() => {
	if (!browser || !catalog) return {};
	try {
		return { download: plan({ catalog, ...catalog.size }, body(change).model_details).download };
	} catch (e) {
		// other errors surface on Run
		return { tooBroad: e.message.startsWith("too broad") ? `This selection is ${e.message}` : "" };
	}
});
const tooBroad = $derived(planned.tooBroad ?? "");
// said only above 5 MB, where the download is what a reader on a phone may wait for
const download = $derived(planned.download > 5e6 ? `This selection downloads about ${fmt(planned.download / 1e6)} MB of data.` : "");

function say(text, bad = false) {
	message = text;
	failed = bad;
	onnews?.(text, bad);
}

// quiet: after a failed run, keep its message while a fresh worker starts
function connect({ quiet = false } = {}) {
	const attempt = ++connection;
	unreachable = false;
	if (!quiet) say(browser ? "Loading browser scenario data…" : `Connecting to ${api}…`);
	const connecting = browser
		? import("./lib/browser-engine/browser-client.js").then(({ browserClient }) => {
			if (attempt !== connection) return null;
			client?.close();
			client = browserClient();
			return client.request();
		})
		: fetchJson(`${api}/catalog`);
	connecting.then(
		(c) => {
			if (attempt !== connection) return;
			catalog = c;
			if (!quiet) say(browser ? "Ready to compute in this browser." : `Connected to ${api}.`);
		},
		(e) => {
			if (attempt !== connection) return;
			unreachable = true;
			say(browser ? `Browser data could not load: ${e.message}. Try again.` : unreachableMessage(api, e), true);
		},
	);
}
if (!browser) {
	connected = true;
	connect();
}
// While the form is open, the worker starts reading the selection it shows, so Run
// waits only for what is left. Sent once per change, half a second after the last.
let sent = "";
$effect(() => {
	if (!browser || !open || !catalog || running || tooBroad) return;
	let scenario;
	try {
		scenario = body(change);
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

// Stops a browser run: a fresh worker replaces the busy one.
function cancel() {
	cancelled = true;
	sent = "";
	connect();
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
		scenario = body(change);
	} catch (e) {
		say(e.message, true);
		return;
	}
	running = true;
	cancelled = false;
	elapsed = 0;
	const started = performance.now();
	const tick = setInterval(() => (elapsed = (performance.now() - started) / 1000), 100);
	say(browser ? "Computing the scenario in this browser…" : "Sending the scenario…");
	try {
		const submitted = browser ? null : await fetchJson(`${api}/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(scenario),
		});
		const done = browser ? await client.request(scenario) : await waitForJob(fetchJson, `${api}/jobs/${submitted.id}`, {
			onUpdate: (j) => say(`Job ${j.id}: ${j.status}…`),
		});
		if (done.status === "failed") throw new Error(done.error);
		job = done;
		mapped = false;
		const duration = done.duration_s < 0.1 ? "less than 0.1" : done.duration_s.toFixed(1);
		let text = browser ? `Computed in this browser in ${duration} s.` : `Job ${done.id} finished in ${duration} s.`;
		try {
			mapped = onflows?.(done, liveText(done, catalog)) === true;
			if (mapped)
				text += `${ui.mode === "whatif" ? " The map shows its flows." : " What if… shows its flows on the map."} Details → Method lists the totals by region.`;
		} catch (e) {
			text += ` Its flows are not on the map: ${e.message}`;
		}
		say(text);
	} catch (e) {
		if (cancelled) return;
		say(`${browser ? "Scenario" : "Job"} failed: ${e.message}`, true);
		// a trap or a timeout stopped the worker: start a fresh one for the next Run
		if (browser && client?.stopped) {
			sent = "";
			connect({ quiet: true });
		}
	} finally {
		clearInterval(tick);
		running = false;
	}
}
</script>

<!-- the visible status line; App reads the same messages out -->
{#snippet state()}
	<p id="live-state" class="hint" class:bad={failed}>{message}</p>
	{#if unreachable}<button type="button" class="chipb" id="live-retry" onclick={retryConnect}>Try again</button>{/if}
{/snippet}

<section id="live" aria-labelledby="live-title">
	<div class="run chosen live-card">
		<span><b id="live-title">Custom scenario</b><small>{browser ? "Computed on this device" : "Calculated by the job API"}</small></span>
		<button type="button" class="change" id="live-open" aria-expanded={open} aria-controls="live-body" onclick={toggle}>{open ? "Close" : "Set up"}</button>
	</div>
	{#if !open}{@render state()}{/if}
	<div id="live-body" class="live-body" hidden={!open}>
		<!-- the card already says where a browser run is computed -->
		{#if !browser}<p class="live-label" id="live-label">Results are {status}.</p>{/if}
		<p class="hint">{browser ? "One change to the 2011 economy, against the published baseline. Nothing is sent to a server." : "One change to the 2011 economy, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (a few seconds; one job runs at a time). The result is compared with the baseline computed in the same job."}</p>
		<!-- the pickers need the catalog; without it the status line says why -->
		<form id="live-form" onsubmit={submit} aria-busy={running} hidden={!catalog}>
			<Picker id="live-product" label="Product" tree={trees.products} bind:value={pick.product} />
			<Picker id="live-origin" label="Produced in" tree={trees.regions} bind:value={pick.origin} />
			<Picker id="live-consumer" label="Used by" tree={trees.consumers} bind:value={pick.consumer} />
			<Picker id="live-consumed-reg" label="Used in" tree={trees.regions} bind:value={pick.consumedReg} />
			<label for="live-change">Input or demand change, %</label>
			<input id="live-change" type="number" step="any" min={range.min} max={range.max} value={change} required aria-describedby="live-change-h" oninput={(e) => (change = e.currentTarget.value)} />
			<small class="fh" id="live-change-h">For an industry: inputs per unit of output. For final demand: spending. Negative values reduce it. Range: {minus(range.min)} to +{range.max}%.</small>
			<!-- always present, so a screen reader announces the message as it comes and goes -->
			<p class="hint bad" id="live-broad" role="status">{tooBroad}</p>
			{#if download}<p class="hint" id="live-download">{download}</p>{/if}
			<button type="submit" class="go" id="live-run" disabled={unreachable || !catalog || tooBroad !== ""} aria-describedby={tooBroad ? "live-broad" : download ? "live-download" : undefined} aria-disabled={running}>{running ? "Running…" : "Run scenario"}</button>
			{#if running}
				<p class="hint live-elapsed">
					<!-- the status line announces the start and the result; the count is for sighted readers -->
					<span aria-hidden="true">{elapsed.toFixed(1)} s</span>
					{#if browser}<button type="button" class="chipb" id="live-cancel" onclick={cancel}>Cancel</button>{/if}
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
