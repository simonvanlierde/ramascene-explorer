<script>
// A custom run's totals by producing region, against the run's own baseline.
// Details shows it for a run on the map; the live panel for a job the map cannot draw.
import { compare } from "../explorer.js";
import { BROWSER_STATUS } from "../browser-results.js";
import { amountText, displayChange, pct, wording } from "../flows.js";
import { LIVE_STATUS, liveData } from "../live.js";

// indicator: the page's indicator; without it, the table has its own select.
// ids: prefix for element ids, distinct per place, since both places can show at once
let { job, browser = false, indicator = null, ids = "live" } = $props();
const data = $derived(liveData(job, browser ? BROWSER_STATUS : LIVE_STATUS));
// svelte-ignore state_referenced_locally
let own = $state(String(data.indicators[0].id));
const id = $derived(indicator ?? Number(own));

// Signed amount and percentage in the page's units; a zero baseline has no percentage.
const signedText = (v, id) => (v > 0 ? "+" : "") + amountText(v, id);
const pctText = (p) => (p === null ? "—" : pct(p));

const view = $derived.by(() => {
	const w = wording(id);
	const rows = compare(data, { scenario: "live", indicator: String(id) }, w.factor);
	const baseTotal = rows.reduce((s, r) => s + r.baseline, 0);
	const deltaTotal = displayChange(rows.reduce((s, r) => s + r.delta, 0), baseTotal);
	const share = pctText(baseTotal ? (100 * deltaTotal) / baseTotal : null);
	return {
		rows,
		headline: `Summed over all regions, ${w.noun} would change by ${signedText(deltaTotal, id)} (${share}) against ${browser ? "its baseline" : "the job’s own baseline"} of ${amountText(baseTotal, id)}.`,
	};
});
</script>

<div class="live-totals">
<p class="headline" id="{ids}-headline">{view.headline}</p>
{#if indicator === null && data.indicators.length > 1}
	<label for="{ids}-indicator">Indicator</label>
	<select id="{ids}-indicator" bind:value={own}>
		{#each data.indicators as i (i.id)}<option value={String(i.id)}>{`${wording(i.id).label} (${wording(i.id).unit})`}</option>{/each}
	</select>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex: horizontal table scrolling needs keyboard focus -->
<div class="table-wrap" tabindex="0" role="region" aria-label={browser ? "The browser scenario’s totals by region" : "The job’s totals by region"}>
	<table id="{ids}-table">
		<thead><tr>
			{#each ["Region", "Baseline", "Scenario", "Change", "Change %"] as h}<th scope="col">{h}</th>{/each}
		</tr></thead>
		<tbody>
			{#each view.rows as r (r.region)}
				{@const change = displayChange(r.delta, r.baseline)}
				<tr>
					<th scope="row">{r.region}</th>
					<td>{amountText(r.baseline, id)}</td>
					<td>{amountText(r.scenario, id)}</td>
					<td>{signedText(change, id)}</td>
					<td>{pctText(r.baseline ? (100 * change) / r.baseline : null)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
</div>
