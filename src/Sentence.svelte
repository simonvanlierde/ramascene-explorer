<script>
// The live sentence: the page's headline, with the country and the indicator
// as controls inside it. Numbers ease from their last value; a hidden copy
// tells screen readers the settled sentence once, not every frame.
import { cubicOut } from "svelte/easing";
import { Tween } from "svelte/motion";
import { amount, amountText, capitalise, pct, possessive, runText, SECTION_SHORT, wording } from "../flows.js";
import { reducedMotion, ui } from "./view.svelte.js";

let { data, meta, sum, whatif, run } = $props();

const S = SECTION_SHORT.length;
const name = $derived(meta.countries[ui.who]);
const w = $derived(wording(ui.indicator));
const out = $derived(ui.dir === "out");
const scope = $derived(
	ui.on.size === S
		? " across all 15 industry sections"
		: ui.on.size === 1
			? ` through ${SECTION_SHORT[[...ui.on][0]].toLowerCase()}`
			: ` through ${ui.on.size} of 15 industry sections`,
);
const year = $derived(data.base_year);
const top = $derived(meta.countries[sum.others[0]] ?? name);
const abroad = $derived(sum.total ? ((sum.total - sum.home) / sum.total) * 100 : 0);
const dTot = $derived(whatif ? sum.dTotal * ui.s : 0);
const changed = $derived(sum.changed != null ? meta.countries[sum.changed] : "");

// eased numbers; the scrubber drives the What if… ones directly
const opts = { duration: 450, easing: cubicOut };
const tTotal = new Tween(0, opts);
const tShare = new Tween(0, opts);
$effect(() => {
	const instant = whatif || reducedMotion();
	tTotal.set(sum.total + dTot, instant ? { duration: 0 } : undefined);
	tShare.set(abroad, instant ? { duration: 0 } : undefined);
});
const shown = $derived(amount(tTotal.current, ui.indicator));
const delta = $derived(amount(dTot, ui.indicator));
const dPct = $derived(sum.total ? (dTot / sum.total) * 100 : 0);
const tone = $derived(dTot < 0 ? "neg" : dTot > 0 ? "pos" : "");

// the settled sentence, for the live region
const plain = $derived.by(() => {
	const [n, u] = amount(sum.total + (whatif ? sum.dTotal : 0), ui.indicator);
	const thing = w.unit === "jobs" ? `${n} ${u}` : `${n} ${u} of ${w.noun}`;
	if (!whatif)
		return `${name}${out ? "" : possessive(name)}${out ? w.out.verb : w.in.verb} ${thing} in ${year}${scope}; ${Math.round(abroad)}% ${out ? w.out.abroad : w.in.abroad}, most in ${top}.`;
	const d = `${sum.dTotal > 0 ? "+" : ""}${amountText(sum.dTotal, ui.indicator)}`;
	return `In the ${year} economy, if ${runText(data, run)}, ${out ? `${w.out.would}${name}${w.out.come}` : `${name}${possessive(name)}${w.in.would}`} ${n} ${u}, ${d} (${pct((sum.dTotal / sum.total) * 100)}), the largest change ${out ? w.out.where : w.in.where} ${changed}.`;
});

// --- the two popovers -----------------------------------------------------------
let pop = $state(null); // null | "country" | "indicator"
let opener = null;
const byName = $derived([...meta.countries.keys()].sort((a, b) => meta.countries[a].localeCompare(meta.countries[b])));
function openPop(kind, e) {
	e.stopPropagation();
	opener = e.currentTarget;
	pop = pop === kind ? null : kind;
	if (pop)
		queueMicrotask(() =>
			document.querySelector(`.pop.${kind} [aria-pressed="true"], .pop.${kind} button`)?.focus(),
		);
}
function closePop(back = true) {
	pop = null;
	if (back) opener?.focus();
}
function onKey(e) {
	if (e.key === "Escape" && pop) {
		e.stopPropagation();
		closePop();
	}
}
function onDocClick(e) {
	if (pop && !e.target.closest(".pop")) closePop(false);
}
</script>

<svelte:window onkeydown={onKey} onclick={onDocClick} />

{#snippet country()}
	<button type="button" class="tok" aria-haspopup="true" aria-expanded={pop === "country"} aria-label="Country: {name}. Change" onclick={(e) => openPop("country", e)}>{name}</button>
{/snippet}

<div class="hl">
	{#if !whatif}
		<p id="headline">
			{@render country()}{out ? "" : possessive(name)}{out ? w.out.verb : w.in.verb}
			{#if w.unit === "jobs"}
				<span class="u"><span class="n">{shown[0]}</span></span>
				<button type="button" class="tok" aria-haspopup="true" aria-expanded={pop === "indicator"} aria-label="Indicator: {w.noun}. Change" onclick={(e) => openPop("indicator", e)}>{shown[1]}</button>
			{:else}
				<span class="u"><span class="n">{shown[0]}</span> {shown[1]}</span> of
				<button type="button" class="tok" aria-haspopup="true" aria-expanded={pop === "indicator"} aria-label="Indicator: {w.noun}. Change" onclick={(e) => openPop("indicator", e)}>{w.noun}</button>
			{/if}
			in {year}{scope}; <span class="n">{Math.round(tShare.current)}%</span>
			{out ? w.out.abroad : w.in.abroad}, most in <b>{top}</b>.
		</p>
	{:else}
		<p id="headline">
			In the {year} economy, if <b>{runText(data, run)}</b>,
			{#if out}{w.out.would}{@render country()}{w.out.come}{:else}{@render country()}{possessive(name)}{w.in.would}{/if}
			<span class="u"><span class="n">{shown[0]}</span> {shown[1]}</span>{ui.on.size === S ? "" : scope},
			<span class="u"><span class="n {tone}">{dTot > 0 ? "+" : ""}{delta[0]}</span> {delta[1]}</span>
			(<span class="n {tone}">{pct(dPct)}</span>), the largest change {out ? w.out.where : w.in.where}
			<b>{changed}</b>.
		</p>
	{/if}
	<p class="sr-only" aria-live="polite">{ui.s === 1 || !whatif ? plain : ""}</p>

	{#if pop === "country"}
		<div class="pop country" role="group" aria-label="Choose a country">
			{#each byName as i (i)}
				<button
					type="button"
					aria-pressed={i === ui.who}
					onclick={() => {
						ui.who = i;
						closePop();
					}}>{meta.countries[i]}</button
				>
			{/each}
		</div>
	{:else if pop === "indicator"}
		<div class="pop indicator" role="group" aria-label="Choose an indicator">
			{#each meta.indicators as i (i.id)}
				{@const iw = wording(i.id)}
				<button
					type="button"
					aria-pressed={i.id === ui.indicator}
					onclick={() => {
						ui.indicator = i.id;
						closePop();
					}}>{capitalise(iw.noun)} <small>({iw.unit})</small></button
				>
			{/each}
		</div>
	{/if}
</div>
