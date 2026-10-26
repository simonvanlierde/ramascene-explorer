<script>
// Optional live panel, imported only with a valid ?api=. The only code that
// fetches from the job API. Everything from the API is rendered as text, never as markup.
import { compare } from "../explorer.js";
import { amountText, pct, wording } from "../flows.js";
import {
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
let { api, onflows, onnews } = $props();

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
	unreachable = false;
	say(`Connecting to ${api}…`);
	fetchJson(`${api}/catalog`).then(
		(c) => {
			catalog = c;
			say(`Connected to ${api}.`);
		},
		(e) => {
			unreachable = true;
			say(unreachableMessage(api, e), true);
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
		headline: `Summed over all regions, ${w.noun} would change by ${signedText(deltaTotal, id)} (${share}) against the job’s own baseline of ${amountText(baseTotal, id)}.`,
		provenance: liveProvenance(job, api),
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
	say("Sending the scenario…");
	try {
		const submitted = await fetchJson(`${api}/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const done = await waitForJob(fetchJson, `${api}/jobs/${submitted.id}`, {
			onUpdate: (j) => say(`Job ${j.id}: ${j.status}…`),
		});
		if (done.status === "failed") throw new Error(done.error);
		const d = liveData(done);
		// the indicator list comes from the first job and stays
		if (!indicators.length) {
			indicators = d.indicators;
			indicatorId = String(indicators[0].id);
		}
		job = done;
		data = d;
		let text = `Job ${done.id} finished in ${done.duration_s.toFixed(1)} s.`;
		try {
			if (onflows?.(done, liveText(done, catalog)))
				text += ui.mode === "whatif" ? " The map shows its flows." : " What if… shows its flows on the map.";
		} catch (e) {
			text += ` Its flows are not on the map: ${e.message}`;
		}
		say(text);
	} catch (e) {
		say(`Job failed: ${e.message}`, true);
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
	{#each items ?? [] as item (item.id)}<option value={String(item.id)}>{item.name}</option>{/each}
{/snippet}

<section id="live" aria-labelledby="live-title">
	<div class="run chosen live-card">
		<span><b id="live-title">Custom scenario</b><small>Computed live by the job API</small></span>
		<button type="button" class="change" id="live-open" aria-expanded={open} aria-controls="live-body" onclick={() => (open = !open)}>{open ? "Close" : "Set up"}</button>
	</div>
	{#if !open}{@render state()}{/if}
	<div id="live-body" class="live-body" hidden={!open}>
		<p class="live-label" id="live-label">Results in this panel are {LIVE_STATUS}.</p>
		<p class="hint">One intervention on the 2011 base year, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (a few seconds; one job runs at a time). The result is compared with the baseline computed in the same job.</p>
		<!-- the pickers need the catalog; without it the status line says why -->
		<form id="live-form" onsubmit={submit} aria-busy={running} hidden={!catalog}>
			<label for="live-product">Product</label>
			<select id="live-product" required disabled={!catalog} bind:value={pick.product}>{@render options(catalog?.products)}</select>
			<label for="live-origin">Produced in</label>
			<select id="live-origin" required disabled={!catalog} bind:value={pick.origin}>{@render options(catalog?.regions)}</select>
			<label for="live-consumer">Consumed by</label>
			<select id="live-consumer" required disabled={!catalog} bind:value={pick.consumer}>{@render options(catalog?.consumers)}</select>
			<label for="live-consumed-reg">Consumed in</label>
			<select id="live-consumed-reg" required disabled={!catalog} bind:value={pick.consumedReg}>{@render options(catalog?.regions)}</select>
			<label for="live-change">Change, %</label>
			<input id="live-change" type="number" step="any" min={range.min} max={range.max} value="-20" required aria-describedby="live-change-h" bind:this={changeInput} />
			<small class="fh" id="live-change-h">From {minus(range.min)} to +{range.max}</small>
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
				<div class="table-wrap" tabindex="0" role="region" aria-label="The job’s totals by region">
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
					<summary>Provenance (live job)</summary>
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
