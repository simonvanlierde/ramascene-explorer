<script>
// Three numbers under the sentence in Flows. In What if… the world's change leads, every
// country's consumption and every industry, then the selected country's change split over the
// five world regions, each its change in emissions (or jobs, or ores) released there.
// With World selected, Flows has the same shape: the world total, then its split over the five regions.
import { amount, capitalise, displayChange, divFill, pct, placeName, SECTION_SHORT, share, theName, WORLD, wording } from "./lib/flows.js";
import { themeName, ui } from "./view.svelte.js";

let { meta, sum, conts, world, whatif, extent } = $props();

const isWorld = $derived(ui.who === WORLD);
const name = $derived(placeName(meta, ui.who));
// inside a phrase: "the United States"
const nameIn = $derived(theName(meta, ui.who));
const sections = $derived(
	ui.on.size === SECTION_SHORT.length ? "All 15 industry sections" : `${ui.on.size} of 15 industry sections`,
);
const total = $derived(amount(sum.total, ui.indicator));
const abroad = $derived(amount(sum.total - sum.home, ui.indicator));
const k = $derived(sum.others[0]);
const largest = $derived(amount(sum.vals[k] ?? 0, ui.indicator));
const fill = $derived(divFill(extent, themeName()));
const wd = $derived(world ? displayChange(world.delta, world.base) : 0);
const wa = $derived(amount(wd, ui.indicator));
const where = $derived(ui.dir === "in" ? wording(ui.indicator).made.is : wording(ui.indicator).consumed);
// the five cells share one unit, stated once in their heading, so a narrow cell never wraps it
const regionChanges = $derived(conts?.map((c) => (whatif ? displayChange(c.change, sum.total) : c.base)) ?? []);
const regionRef = $derived(Math.max(0, ...regionChanges.map(Math.abs)));
// the cell with the largest change is the heaviest
const topCell = $derived(regionChanges.reduce((best, v, i) => (Math.abs(v) > Math.abs(regionChanges[best]) ? i : best), 0));
const regionUnit = $derived(amount(regionRef, ui.indicator)[1]);
</script>

{#if !whatif && !isWorld}
	<div class="kpis k3">
		<div class="kpi">
			<div class="kl">{wording(ui.indicator).total[ui.dir]}</div>
			<div class="kv num">{total[0]}<small>{total[1]}</small></div>
			<div class="ks">{sections}, 2011</div>
		</div>
		<div class="kpi">
			<div class="kl">{ui.dir === "in" ? "Abroad" : "For consumption abroad"}</div>
			<div class="kv num">{share(sum.total - sum.home, sum.total)}</div>
			<div class="ks">{abroad.join(" ")} outside {nameIn}</div>
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
	<div class="wstrip">
		{#if !whatif}
			<div class="kpi world">
				<div class="kl">World total</div>
				<div class="kv num">{total[0]}<small>{total[1]}</small></div>
				<div class="ks">{sections}, 2011</div>
			</div>
		{:else if world}
			<div class="kpi world">
				<div class="kl">World total</div>
				<div class="kv num">{wd > 0 ? "+" : ""}{wa[0]}<small>{wa[1]}</small></div>
				<div class="ks">{world.base ? `${pct((wd / world.base) * 100)} relative to 2011` : "no 2011 total"}, all countries and industries</div>
			</div>
		{/if}
		<div class="regions">
			<div class="gl">{whatif ? `${capitalise(nameIn)}’s change, by where ${where}` : `By where ${where}`} <small>({regionUnit})</small></div>
			<div class="kpis k5" role="group" aria-label="{whatif ? `The change in ${nameIn}${ui.dir === 'in' ? '’s consumption' : ''}` : 'The world total'}, by the world region where {ui.dir === 'in' ? wording(ui.indicator).made.is : 'it is consumed'}">
				{#each conts as c, i (c.name)}
					{@const v = regionChanges[i]}
					{@const p = c.base ? (v / c.base) * 100 : 0}
					<div class="kpi" class:lead={i === topCell}>
						<div class="kl">{#if whatif}<span class="sw" style="background:{fill(p)}"></span>{/if}<span><span class="pre">{ui.dir === "in" ? `${wording(ui.indicator).made.col} ` : "Consumed in "}</span>{c.name.replace("-", " ")}</span></div>
						<div class="kv num">{whatif && v > 0 ? "+" : ""}{amount(v, ui.indicator, regionRef)[0]}<span class="sr-only"> {regionUnit}</span></div>
						<div class="ks">{whatif ? (c.base ? `${pct(p)} relative to 2011` : "no 2011 flow") : `${share(c.base, sum.total)} of the total`}</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
