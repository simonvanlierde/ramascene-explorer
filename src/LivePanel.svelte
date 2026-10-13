<script>
// Optional live panel, imported only with a valid ?api=. The only code that
// fetches from the job API. Everything from the API is rendered as text, never as markup.
import { compare, displayIndicator, fmtPct, formatValue, headline, signed } from "../explorer.js";
import { LIVE_STATUS, liveData, liveProvenance, scenarioBody, unreachableMessage, waitForJob } from "../live.js";

let { api } = $props();

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
let unreachable = $state(false);
let running = $state(false);
let data = $state.raw(null);
let job = $state.raw(null);
let indicators = $state.raw([]);
let indicatorId = $state("");

// svelte-ignore state_referenced_locally
fetchJson(`${api}/catalog`).then(
	(c) => {
		catalog = c;
		message = `Connected to ${api}.`;
	},
	(e) => {
		message = unreachableMessage(api, e);
		unreachable = true;
	},
);

const view = $derived.by(() => {
	if (!data) return null;
	const indicator = displayIndicator(data.indicators.find((i) => String(i.id) === indicatorId));
	const rows = compare(data, { scenario: "live", indicator: String(indicator.id) }, indicator.factor);
	const baseTotal = rows.reduce((s, r) => s + r.baseline, 0);
	const deltaTotal = rows.reduce((s, r) => s + r.delta, 0);
	return { indicator, rows, headline: headline(indicator, deltaTotal, baseTotal), provenance: liveProvenance(job, api) };
});

async function submit(event) {
	event.preventDefault();
	let body;
	try {
		body = scenarioBody({
			product: pick.product,
			originReg: pick.origin,
			consumedBy: pick.consumer,
			consumedReg: pick.consumedReg,
			techChange: changeInput.value,
		});
	} catch (e) {
		message = e.message;
		return;
	}
	running = true;
	try {
		const submitted = await fetchJson(`${api}/jobs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const done = await waitForJob(fetchJson, `${api}/jobs/${submitted.id}`, {
			onUpdate: (j) => {
				message = `Job ${j.id}: ${j.status}…`;
			},
		});
		if (done.status === "failed") throw new Error(done.error);
		const d = liveData(done);
		// the indicator list comes from the first job and stays
		if (!indicators.length) {
			indicators = d.indicators.map(displayIndicator);
			indicatorId = String(indicators[0].id);
		}
		job = done;
		data = d;
		message = `Job ${done.id} finished in ${done.duration_s.toFixed(1)} s.`;
	} catch (e) {
		message = `Job failed: ${e.message}`;
	} finally {
		running = false;
	}
}
</script>

{#snippet options(items)}
	{#each items ?? [] as item (item.id)}<option value={String(item.id)}>{`${item.name} (${item.id})`}</option>{/each}
{/snippet}

<section id="live" aria-labelledby="live-title">
	<h2 id="live-title">Run a custom scenario</h2>
	<p class="live-label" id="live-label">Results in this panel are {LIVE_STATUS}.</p>
	<p class="scope">One intervention on the 2011 base year, sent to the job API named in the page address and computed by the RaMa-Scene engine while you wait (about a minute; one job runs at a time). The result is compared with the baseline computed in the same job.</p>
	<form id="live-form" onsubmit={submit}>
		<label for="live-product">Product <select id="live-product" required bind:value={pick.product}>{@render options(catalog?.products)}</select></label>
		<label for="live-origin">Produced in <select id="live-origin" required bind:value={pick.origin}>{@render options(catalog?.regions)}</select></label>
		<label for="live-consumer">Consumed by <select id="live-consumer" required bind:value={pick.consumer}>{@render options(catalog?.consumers)}</select></label>
		<label for="live-consumed-reg">Consumed in <select id="live-consumed-reg" required bind:value={pick.consumedReg}>{@render options(catalog?.regions)}</select></label>
		<label for="live-change">Change (%) <input id="live-change" type="number" step="any" value="-20" required bind:this={changeInput} /></label>
		<label for="live-indicator">Indicator
			<select id="live-indicator" bind:value={indicatorId}>
				{#each indicators as i (i.id)}<option value={String(i.id)}>{`${i.name} (${i.unit})`}</option>{/each}
			</select>
		</label>
		<button type="submit" id="live-run" disabled={unreachable || running}>Run</button>
	</form>
	<p id="live-state" role="status" aria-live="polite">{message}</p>
	<div id="live-result" hidden={!view}>
		{#if view}
			<p class="headline" id="live-headline">{view.headline}</p>
			<div class="table-wrap">
				<table id="live-table">
					<thead><tr>
						{#each ["Region", `Baseline (${view.indicator.unit})`, `Intervention (${view.indicator.unit})`, "Change", "Change %"] as h}<th scope="col">{h}</th>{/each}
					</tr></thead>
					<tbody>
						{#each view.rows as r (r.region)}
							<tr>
								<th scope="row">{r.region}</th>
								<td>{formatValue(r.baseline, view.indicator.unit)}</td>
								<td>{formatValue(r.scenario, view.indicator.unit)}</td>
								<td>{signed(r.delta, view.indicator.unit)}</td>
								<td>{fmtPct(r.percent)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<details open>
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
</section>

<style>
	#live {
		border: 2px dashed var(--axis);
		padding: 16px;
		margin-top: 48px;
	}
	.live-label {
		font-weight: 700;
	}
</style>
