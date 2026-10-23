<script>
import { lookupGrid, pickerState } from "../explorer.js";
import { amountShort, capitalise, placeName, runText, wording } from "../flows.js";
import CountryBox from "./CountryBox.svelte";
import Rail from "./Rail.svelte";
import { ui } from "./view.svelte.js";

// live: {source, text, rows} while a run that is not precomputed is shown, else null
// custom: a snippet for the run list's last card (the live panel with ?api=); retry reloads a run that failed
let { data, meta, sum, whatif, live = null, loadingRun, setMode, setRun, retry, sheet = false, onclose, inert = false, custom } = $props();

let done = $state();
// a phone opens the panel as a sheet: focus its Done button
$effect(() => {
	if (sheet) queueMicrotask(() => done?.focus());
});

// svelte-ignore state_referenced_locally
const NAMED = ["vehicle-demand-europe", "steel-in-vehicles-europe", "cement-in-construction"].filter((id) =>
	meta.runs.includes(id),
);
const KIND = { "vehicle-demand-europe": "Final demand" };
const grid = $derived(data.grid);
const firstGrid = $derived.by(() => meta.runs.find((r) => data.scenarios.find((s) => s.id === r)?.grid));

// the grid's three pickers, remembered while a named run is shown
// svelte-ignore state_referenced_locally
let gridPick = $state(pickerState(data, data.scenarios.find((s) => s.id === ui.run)?.grid ? ui.run : firstGrid));
const onGrid = $derived(!NAMED.includes(ui.run));
const gridTarget = $derived(lookupGrid(data, gridPick));
const gridMissing = $derived(onGrid && !meta.runs.includes(gridTarget.id));

function pickGrid(key, value) {
	gridPick = { ...gridPick, [key]: value };
	const t = lookupGrid(data, gridPick);
	if (meta.runs.includes(t.id)) setRun(t.id);
}

// world change of a run, all sections, from the run's continental totals
const w = $derived(wording(ui.indicator));
function worldChange(id) {
	const b = data.results.baseline?.[String(ui.indicator)];
	const r = data.results[id]?.[String(ui.indicator)];
	if (!b || !r) return "";
	const d = Object.keys(b).reduce((s, k) => s + (r[k] - b[k]), 0) * w.factor;
	return `world ${d > 0 ? "+" : ""}${amountShort(d, ui.indicator)}`;
}

// radio group: arrow keys move and select, as native radios do
function radioKeys(e, list, current, choose) {
	const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
	if (!d) return;
	e.preventDefault();
	const next = list[(list.indexOf(current) + d + list.length) % list.length];
	choose(next);
	e.currentTarget.parentElement.querySelector(`[data-v="${next}"]`)?.focus();
}
const runOptions = [...NAMED, "grid"];
// The run list folds to the chosen run once one is picked, so country,
// direction, indicator and rail stay in view; a link to a run opens folded.
let showRuns = $state(!new URLSearchParams(location.search).has("scenario"));
let changeButton = $state();
function pickRun(v) {
	chooseRun(v);
	showRuns = false;
	queueMicrotask(() => changeButton?.focus());
}
// a job arriving folds the list to show it
$effect(() => {
	if (live) showRuns = false;
});
const chosenText = $derived(capitalise(live ? live.text : runText(data, ui.run)));
const chosenSub = $derived(
	live ? capitalise(live.source.status) : onGrid ? "Material efficiency, one product" : `${KIND[ui.run] ?? "Material efficiency"} · ${worldChange(ui.run)}`,
);
const chooseRun = (v) => (v === "grid" ? (gridTarget.id && meta.runs.includes(gridTarget.id) ? setRun(gridTarget.id) : setRun(firstGrid)) : setRun(v));

const directionHint = $derived(
	ui.dir === "in"
		? `Where ${w.source} to make what ${placeName(meta, ui.who)} consumes.`
		: `Where what ${placeName(meta, ui.who)} makes is consumed.`,
);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: Escape and Done are the keyboard path -->
<div class="sheet-scrim" class:on={sheet} onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions: Escape closes the sheet from anywhere inside it -->
<aside
	class="side"
	class:open={sheet}
	id="side"
	{inert}
	aria-label="Selection"
	onkeydown={(e) => sheet && e.key === "Escape" && (e.stopPropagation(), onclose())}
>
	<div class="sheet-head">
		<h2>Choose what to show</h2>
		<button type="button" bind:this={done} onclick={onclose}>Done</button>
	</div>
	<div class="grp mode" class:flows={ui.mode === "flows"}>
		<div class="lab">Mode</div>
		<div class="seg big" role="group" aria-label="Mode">
			<button type="button" aria-pressed={ui.mode === "flows"} onclick={() => setMode("flows")}>Flows, {data.base_year}</button>
			<button type="button" aria-pressed={ui.mode === "whatif"} onclick={() => setMode("whatif")}>What if…</button>
		</div>
		{#if ui.mode === "whatif"}
			<div class="lab sub"><span id="run-l">Intervention</span><small>{meta.runs.length - 1} precomputed runs</small></div>
			{#if !showRuns}
				<div class="run chosen">
					<span><b>{chosenText}</b><small>{chosenSub}</small></span>
					<button type="button" class="change" bind:this={changeButton} aria-expanded="false" aria-controls="run-list" aria-label="Change the intervention" onclick={() => (showRuns = true)}>Change</button>
				</div>
			{:else}
			<div class="runs" id="run-list" role="radiogroup" aria-labelledby="run-l">
				{#each runOptions as v (v)}
					{@const checked = v === "grid" ? onGrid : ui.run === v}
					<button
						type="button"
						class="run"
						role="radio"
						data-v={v}
						aria-checked={checked}
						tabindex={checked ? 0 : -1}
						onclick={() => pickRun(v)}
						onkeydown={(e) => radioKeys(e, runOptions, onGrid ? "grid" : ui.run, chooseRun)}
					>
						<span class="dot"></span>
						{#if v === "grid"}
							<span><b>Material efficiency, one product</b><small>{grid?.products.length ?? 0} products × 5 regions × {grid?.cuts.length ?? 0} cuts</small></span>
						{:else}
							<span><b>{capitalise(runText(data, v))}</b><small>{KIND[v] ?? "Material efficiency"} · {worldChange(v)}</small></span>
						{/if}
					</button>
				{/each}
			</div>
			{/if}
			{#if onGrid && grid}
				<div class="gridpick">
					<label for="g-product">Product used less</label>
					<select id="g-product" value={gridPick.scenario} onchange={(e) => pickGrid("scenario", e.currentTarget.value)}>
						{#each grid.products as p (p.slug)}<option value="grid:{p.slug}">{p.short}</option>{/each}
					</select>
					<div class="lab sub2" id="g-region-l">In every industry of</div>
					<div class="seg wrap" role="group" aria-labelledby="g-region-l">
						{#each grid.regions as r (r.slug)}
							<button type="button" aria-pressed={gridPick.region === r.slug} onclick={() => pickGrid("region", r.slug)}>{r.name.replace("-", " ")}</button>
						{/each}
					</div>
					<div class="lab sub2" id="g-cut-l">By</div>
					<div class="seg" role="group" aria-labelledby="g-cut-l">
						{#each grid.cuts as c (c)}
							<button type="button" aria-pressed={gridPick.cut === String(c)} onclick={() => pickGrid("cut", String(c))}>{Math.abs(c)}%</button>
						{/each}
					</div>
					{#if gridMissing}
						<p class="note" role="status">
							{gridTarget.failed ? `This combination was run but failed a check, so it is not shown: ${gridTarget.failed}` : "This combination was not precomputed."}
						</p>
					{/if}
				</div>
			{/if}
			{#if loadingRun.startsWith("failed:")}
				<p class="hint" role="status">That run could not be loaded. <button type="button" class="chipb" onclick={retry}>Try again</button> or pick another.</p>
			{:else if loadingRun}
				<p class="hint" role="status">Loading the run’s flows…</p>
			{/if}
		{/if}
		<!-- mounted in both modes, so a job keeps running while Flows is shown -->
		{#if custom}<div class="custom" hidden={ui.mode !== "whatif"}>{@render custom()}</div>{/if}
	</div>

	<div class="grp">
		<div class="lab"><span id="cty-l">Country</span><small>{meta.countries.length} regions</small></div>
		<CountryBox {meta} labelledby="cty-l" />
	</div>

	<div class="grp">
		<div class="lab">Direction</div>
		<div class="seg" role="group" aria-label="Direction">
			<button type="button" aria-pressed={ui.dir === "in"} onclick={() => (ui.dir = "in")}>Its consumption</button>
			<button type="button" aria-pressed={ui.dir === "out"} onclick={() => (ui.dir = "out")}>Its production</button>
		</div>
		<p class="hint">{directionHint}</p>
	</div>

	<div class="grp">
		<div class="lab">Indicator</div>
		<div class="seg" role="group" aria-label="Indicator">
			{#each meta.indicators as i (i.id)}
				<button type="button" aria-pressed={ui.indicator === i.id} onclick={() => (ui.indicator = i.id)}>{wording(i.id).label}</button>
			{/each}
		</div>
	</div>

	<div class="grp">
		<div class="lab"><span id="rail-l">Industry sections</span><small>share of the {whatif ? "2011 " : ""}flows</small></div>
		<Rail {sum} labelledby="rail-l" />
	</div>
</aside>
