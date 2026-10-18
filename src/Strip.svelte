<script>
// Three numbers under the sentence in Flows; in What if… the five continents,
// each its change in emissions (or jobs, or ores) released there.
import { amount, divFill, pct, placeName, SECTION_SHORT, share } from "../flows.js";
import { ui } from "./view.svelte.js";

let { meta, sum, conts, whatif, extent } = $props();

const name = $derived(meta.countries[ui.who]);
const sections = $derived(
	ui.on.size === SECTION_SHORT.length ? "All 15 sections" : `${ui.on.size} of 15 sections`,
);
const total = $derived(amount(sum.total, ui.indicator));
const abroad = $derived(amount(sum.total - sum.home, ui.indicator));
const k = $derived(sum.others[0]);
const largest = $derived(amount(sum.vals[k] ?? 0, ui.indicator));
const LABEL = {
	5: { in: "Consumption footprint", out: "Emissions released" },
	3: { in: "Jobs behind consumption", out: "Jobs located here" },
	7: { in: "Ores behind consumption", out: "Ores extracted here" },
};
const fill = $derived(divFill(extent));
</script>

{#if !whatif}
	<div class="kpis k3">
		<div class="kpi">
			<div class="kl">{LABEL[ui.indicator]?.[ui.dir] ?? "Total"}</div>
			<div class="kv num">{total[0]}<small>{total[1]}</small></div>
			<div class="ks">{sections}, 2011</div>
		</div>
		<div class="kpi">
			<div class="kl">{ui.dir === "in" ? "Abroad" : "For consumption abroad"}</div>
			<div class="kv num">{share(sum.total - sum.home, sum.total)}</div>
			<div class="ks">{abroad.join(" ")} outside {name}</div>
		</div>
		<div class="kpi">
			<div class="kl">Largest flow</div>
			<div class="kv num">{largest[0]}<small>{largest[1]}</small></div>
			<div class="ks">
				{#if k != null}{ui.dir === "in" ? `${placeName(meta, k)} → ${name}` : `${name} → ${placeName(meta, k)}`} · {share(sum.vals[k], sum.total)}{:else}No flow abroad{/if}
			</div>
		</div>
	</div>
{:else}
	<div class="kpis k5" role="group" aria-label="The change in {name}{ui.dir === 'in' ? '’s consumption' : ''}, by the continent where it is {ui.dir === 'in' ? 'released' : 'consumed'}">
		{#each conts as c (c.name)}
			{@const v = c.change}
			{@const p = c.base ? (v / c.base) * 100 : 0}
			{@const a = amount(v, ui.indicator)}
			<div class="kpi">
				<div class="kl"><span class="sw" style="background:{fill(p)}"></span>{ui.dir === "in" ? "Released in" : "Consumed in"} {c.name.replace("-", " ")}</div>
				<div class="kv num">{v > 0 ? "+" : ""}{a[0]}<small>{a[1]}</small></div>
				<div class="ks">{c.base ? `${pct(p)} of the 2011 flow` : "no 2011 flow"}</div>
			</div>
		{/each}
	</div>
{/if}
