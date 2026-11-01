<script>
// Custom form for ?api= or ?compute=1. This component alone contacts the job
// API; its text is never rendered as markup.
import { compare } from "../explorer.js";
import { onDestroy } from "svelte";
import { BROWSER_STATUS, browserProvenance } from "../browser-results.js";
import { amountText, pct, wording } from "../flows.js";
import {
	catalogName,
	CHANGE_RANGE,
	LIVE_STATUS,
	liveData,
	liveProvenance,
	liveText,
	minus,
	scenarioBody,
	unreachableMessage,
	waitForJob,
} from "../live.js";
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
let changeInput;
let catalog = $state.raw(null);
let message = $state("");
let failed = $state(false);
let unreachable = $state(false);
let running = $state(false);
let data = $state.raw(null);
let job = $state.raw(null);
let indicators = $state.raw([]);
let indicatorId = $state("");

// the change the job API accepts: GET /catalog says, or its known range
const range = $derived(catalog?.tech_change_percent ?? CHANGE_RANGE);
// the form folds into one card under the run list until it is opened
let open = $state(false);

function say(text, bad = false) {
	message = text;
	failed = bad;
	onnews?.(text, bad);
}

function connect() {
	const attempt = ++connection;
	unreachable = false;
	say(browser ? "Loading browser scenario data…" : `Connecting to ${api}…`);
	const connecting = browser
		? import("../browser-client.js").then(({ browserClient }) => {
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
			say(browser ? "Ready to compute in this browser." : `Connected to ${api}.`);
		},
		(e) => {
			if (attempt !== connection) return;
			unreachable = true;
			say(browser ? `Browser data could not load: ${e.message}. Try again.` : unreachableMessage(api, e), true);
		},
	);
}
connect();
// Try again goes as soon as it is pressed: focus the card's own button instead
function retryConnect() {
	connect();
	document.getElementById("live-open")?.focus();
}

// Signed amount and percentage in the page's units; a zero baseline has no percentage.
const signedText = (v, id) => (v > 0 ? "+" : "") + amountText(v, id);
const pctText = (p) => (p === null ? "—" : pct(p));

const view = $derived.by(() => {
	if (!data) return null;
	const id = Number(indicatorId);
	const w = wording(id);
	const rows = compare(data, { scenario: "live", indicator: indicatorId }, w.factor);
	const baseTotal = rows.reduce((s, r) => s + r.baseline, 0);
	const deltaTotal = rows.reduce((s, r) => s + r.delta, 0);
	const share = pctText(baseTotal ? (100 * deltaTotal) / baseTotal : null);
	return {
		id,
		rows,
		headline: `Summed over all regions, ${w.noun} would change by ${signedText(deltaTotal, id)} (${share}) against ${browser ? "its baseline" : "the job’s own baseline"} of ${amountText(baseTotal, id)}.`,
		provenance: browser ? browserProvenance(job) : liveProvenance(job, api),
	};
});

async function submit(event) {
	event.preventDefault();
	// Run stays focusable while a job runs (aria-disabled), so a second press lands here
	if (running) return;
	let body;
	try {
		body = scenarioBody({
			product: pick.product,
			originReg: pick.origin,
			consumedBy: pick.consumer,
			consumedReg: pick.consumedReg,
			techChange: changeInput.value,
		}, range);
	} catch (e) {
		say(e.message, true);
		return;
	}
	running = true;
	say(browser ? "Computing the scenario in this browser…" : "Sending the scenario…");
	try {
		const submitted = browser ? null : await fetchJson(`${api}/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const done = browser ? await client.request(body) : await waitForJob(fetchJson, `${api}/jobs/${submitted.id}`, {
			onUpdate: (j) => say(`Job ${j.id}: ${j.status}…`),
		});
		if (done.status === "failed") throw new Error(done.error);
		const d = liveData(done, status);
		// the indicator list comes from the first job and stays
		if (!indicators.length) {
			indicators = d.indicators;
			indicatorId = String(indicators[0].id);
		}
		job = done;
		data = d;
		let text = browser ? `Computed in this browser in ${done.duration_s.toFixed(1)} s.` : `Job ${done.id} finished in ${done.duration_s.toFixed(1)} s.`;
		try {
			if (onflows?.(done, liveText(done, catalog)))
				text += ui.mode === "whatif" ? " The map shows its flows." : " What if… shows its flows on the map.";
		} catch (e) {
			text += ` Its flows are not on the map: ${e.message}`;
		}
		say(text);
	} catch (e) {
		say(`${browser ? "Scenario" : "Job"} failed: ${e.message}`, true);
	} finally {
		running = false;
	}
}
</script>

<!-- the visible status line; App reads the same messages out -->
{#snippet state()}
	<p id="live-state" class="hint" class:bad={failed}>{message}</p>
	{#if unreachable}<button type="button" class="chipb" id="live-retry" onclick={retryConnect}>Try again</button>{/if}
{/snippet}

{#snippet options(items)}
	{#each items ?? [] as item (item.id)}<option value={String(item.id)} title={item.name}>{catalogName(item)}</option>{/each}
{/snippet}

<section id="live" aria-labelledby="live-title">
	<div class="run chosen live-card">
		<span><b id="live-title">Custom scenario</b><small>{browser ? "Computed on this device" : "Calculated by the job API"}</small></span>
		<button type="button" class="change" id="live-open" aria-expanded={open} aria-controls="live-body" onclick={() => (open = !open)}>{open ? "Close" : "Set up"}</button>
	</div>
	{#if !open}{@render state()}{/if}
	<div id="live-body" class="live-body" hidden={!open}>
		<p class="live-label" id="live-label">Results are {status}.</p>
		<p class="hint">{browser ? "One intervention on the 2011 economy, calculated on this device. The page downloads the data it needs. The result uses the same baseline as the published scenarios; no scenario is sent to a job server." : "One intervention on the 2011 base year, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (a few seconds; one job runs at a time). The result is compared with the baseline computed in the same job."}</p>
		<!-- the pickers need the catalog; without it the status line says why -->
		<form id="live-form" onsubmit={submit} aria-busy={running} hidden={!catalog}>
			<label for="live-product">Product</label>
			<select id="live-product" required disabled={!catalog} bind:value={pick.product}>{@render options(catalog?.products)}</select>
			<label for="live-origin">Produced in</label>
			<select id="live-origin" required disabled={!catalog} bind:value={pick.origin}>{@render options(catalog?.regions)}</select>
			<label for="live-consumer">Used by</label>
			<select id="live-consumer" required disabled={!catalog} bind:value={pick.consumer}>{@render options(catalog?.consumers)}</select>
			<label for="live-consumed-reg">Used in</label>
			<select id="live-consumed-reg" required disabled={!catalog} bind:value={pick.consumedReg}>{@render options(catalog?.regions)}</select>
			<label for="live-change">Input or demand change, %</label>
			<input id="live-change" type="number" step="any" min={range.min} max={range.max} value="-20" required aria-describedby="live-change-h" bind:this={changeInput} />
			<small class="fh" id="live-change-h">For an industry, change inputs per unit of output. For final demand, change spending. Negative values reduce the selected quantity. Range: {minus(range.min)} to +{range.max}%.</small>
			<button type="submit" class="go" id="live-run" disabled={unreachable || !catalog} aria-disabled={running}>{running ? "Running…" : "Run scenario"}</button>
		</form>
		<!-- under Run while the form is open, so its answer is where the reader is -->
		{#if open}{@render state()}{/if}
		<div id="live-result" hidden={!view}>
			{#if view}
				<p class="headline" id="live-headline">{view.headline}</p>
				{#if indicators.length > 1}
					<label for="live-indicator">Indicator</label>
					<select id="live-indicator" bind:value={indicatorId}>
						{#each indicators as i (i.id)}<option value={String(i.id)}>{`${wording(i.id).label} (${wording(i.id).unit})`}</option>{/each}
					</select>
				{/if}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex: horizontal table scrolling needs keyboard focus -->
				<div class="table-wrap" tabindex="0" role="region" aria-label={browser ? "The browser scenario’s totals by region" : "The job’s totals by region"}>
					<table id="live-table">
						<thead><tr>
							{#each ["Region", "Baseline", "Intervention", "Change", "Change %"] as h}<th scope="col">{h}</th>{/each}
						</tr></thead>
						<tbody>
							{#each view.rows as r (r.region)}
								<tr>
									<th scope="row">{r.region}</th>
									<td>{amountText(r.baseline, view.id)}</td>
									<td>{amountText(r.scenario, view.id)}</td>
									<td>{signedText(r.delta, view.id)}</td>
									<td>{pctText(r.percent)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<details>
					<summary>Provenance ({browser ? "browser computation" : "live job"})</summary>
					<dl id="live-provenance">
						{#each view.provenance as [k, v]}
							<dt>{k}</dt>
							<dd>{#if k === "Scenario parameters"}<pre>{v}</pre>{:else}{v}{/if}</dd>
						{/each}
					</dl>
				</details>
			{/if}
		</div>
	</div>
</section>
