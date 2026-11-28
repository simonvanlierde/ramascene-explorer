<script>
// Three numbers under the sentence in Flows. In What if… the world's change leads, every
// country's consumption and every industry, then the selected country's change split over the
// five world regions, each its change in emissions (or jobs, or ores) released there.
// With World selected, Flows has the same shape: the world total, then its split over the five regions.
import { amount, capitalise, continentLabel, displayChange, divFill, pctWords, placeName, SECTION_SHORT, share, theName, WORLD, wording } from "./lib/flows.js";
import { msg } from "./lib/messages.js";
import { themeName, ui } from "./view.svelte.js";

let { meta, sum, conts, worldCard, whatif, extent } = $props();

const isWorld = $derived(ui.who === WORLD);
const name = $derived(placeName(meta, ui.who));
// inside a phrase: "the United States"
const nameIn = $derived(theName(meta, ui.who));
const sections = $derived(
	ui.on.size === SECTION_SHORT.length ? msg.strip.allSections : msg.someSections(ui.on.size),
);
const total = $derived(amount(sum.total, ui.indicator));
const abroad = $derived(amount(sum.total - sum.home, ui.indicator));
const k = $derived(sum.others[0]);
const largest = $derived(amount(sum.vals[k] ?? 0, ui.indicator));
const fill = $derived(divFill(extent, themeName()));
const wd = $derived(worldCard ? displayChange(worldCard.delta, worldCard.base) : 0);
const wa = $derived(amount(wd, ui.indicator));
const where = $derived(ui.dir === "in" ? wording(ui.indicator).made.is : wording(ui.indicator).consumed);
// the five cells share one unit, stated once in their heading, so a narrow cell never wraps it
const regionChanges = $derived(conts?.map((c) => (whatif ? displayChange(c.change, sum.total) : c.base)) ?? []);
const regionRef = $derived(Math.max(0, ...regionChanges.map(Math.abs)));
// The heaviest cell: the largest |change relative to 2011| in What if… (the map's labels show
// only that percentage), the largest amount in Flows. None when every cell is zero.
const cellSize = $derived(regionChanges.map((v, i) => Math.abs(whatif ? (conts[i].base ? v / conts[i].base : 0) : v)));
const topCell = $derived(cellSize.some((s) => s > 0) ? cellSize.indexOf(Math.max(...cellSize)) : -1);
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
			<div class="kl">{ui.dir === "in" ? msg.strip.abroad : msg.strip.forAbroad}</div>
			<div class="kv num">{share(sum.total - sum.home, sum.total)}</div>
			<div class="ks">{msg.strip.outside(abroad.join(" "), nameIn)}</div>
		</div>
		<div class="kpi">
			<div class="kl">{msg.strip.largest}</div>
			<div class="kv num">{largest[0]}<small>{largest[1]}</small></div>
			<div class="ks">
				{#if k != null}{ui.dir === "in" ? `${placeName(meta, k)} → ${name}` : `${name} → ${placeName(meta, k)}`} · {share(sum.vals[k], sum.total)}{:else}{msg.strip.noneAbroad}{/if}
			</div>
		</div>
	</div>
{:else}
	<div class="wstrip">
		{#if !whatif}
			<div class="kpi world">
				<div class="kl">{msg.strip.worldTotal}</div>
				<div class="kv num">{total[0]}<small>{total[1]}</small></div>
				<div class="ks">{sections}, 2011</div>
			</div>
		{:else if worldCard}
			<div class="kpi world">
				<div class="kl">{msg.strip.worldTotal}</div>
				<div class="kv num">{wd > 0 ? "+" : ""}{wa[0]}<small>{wa[1]}</small></div>
				<div class="ks">{worldCard.base ? pctWords((wd / worldCard.base) * 100) : msg.strip.noTotal}{msg.strip.everywhere}</div>
			</div>
		{/if}
		<div class="regions">
			<div class="gl">{whatif ? msg.strip.changeBy(capitalise(nameIn), where) : msg.strip.by(where)} <small>({regionUnit})</small></div>
			<div class="kpis k5" role="group" aria-label={msg.strip.regions(whatif, nameIn, ui.dir === "in", where)}>
				{#each conts as c, i (c.name)}
					{@const v = regionChanges[i]}
					{@const p = c.base ? (v / c.base) * 100 : 0}
					<div class="kpi" class:lead={i === topCell}>
						<div class="kl">{#if whatif}<span class="sw" style="background:{fill(p)}"></span>{/if}<span><span class="pre">{`${ui.dir === "in" ? wording(ui.indicator).made.col : msg.consumedIn} `}</span>{continentLabel(c.name)}</span></div>
						<div class="kv num">{whatif && v > 0 ? "+" : ""}{amount(v, ui.indicator, regionRef)[0]}<span class="sr-only"> {regionUnit}</span></div>
						<div class="ks">{whatif ? (c.base ? pctWords(p) : msg.strip.noFlow) : msg.strip.ofTotal(share(c.base, sum.total))}</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
