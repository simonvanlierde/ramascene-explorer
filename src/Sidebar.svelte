<script>
import { lookupGrid, pickerState } from "./lib/explorer.js";
import { amountShort, capitalise, continentLabel, FEATURED, RUN_KIND, runText, wording, worldTotal } from "./lib/flows.js";
import { msg } from "./lib/messages.js";
import CountryBox from "./CountryBox.svelte";
import Rail from "./Rail.svelte";
import { ui } from "./view.svelte.js";

// live: {source, text, rows, job} while a run that is not precomputed is shown, else null
// custom: a snippet for the run list's last card (the custom-scenario panel); retry reloads a run that failed
// tools: the header's theme toggle and source link, which a phone shows at the sheet's end instead
let { data, meta, sum, whatif, live = null, loadingRun, setMode, setRun, retry, sheet = false, onclose, inert = false, custom, tools } = $props();

let done = $state();
// a phone opens the panel as a sheet: focus its Done button
$effect(() => {
	if (sheet) queueMicrotask(() => done?.focus());
});

// svelte-ignore state_referenced_locally
const NAMED = FEATURED.filter((id) => meta.runs.includes(id));
const grid = $derived(data.grid);
const firstGrid = $derived.by(() => meta.runs.find((r) => data.scenarios.find((s) => s.id === r)?.grid));

// the grid's three pickers, remembered while a named run is shown
// svelte-ignore state_referenced_locally
let gridPick = $state(pickerState(data, data.scenarios.find((s) => s.id === ui.run)?.grid ? ui.run : firstGrid));
// the run the grid card or its pickers last chose: the grid card stays checked on it,
// also on the grid cell the list features
let gridRun = $state(null);
const onGrid = $derived(!!data.scenarios.find((s) => s.id === ui.run)?.grid && (gridRun === ui.run || !NAMED.includes(ui.run)));
// the checked card; null for a run outside the list (an original intervention, opened by link)
const current = $derived(onGrid ? "grid" : NAMED.includes(ui.run) ? ui.run : null);
const gridTarget = $derived(lookupGrid(data, gridPick));
const gridMissing = $derived(onGrid && !meta.runs.includes(gridTarget.id));

function pickGrid(key, value) {
	gridPick = { ...gridPick, [key]: value };
	const t = lookupGrid(data, gridPick);
	if (!meta.runs.includes(t.id)) return;
	gridRun = t.id;
	setRun(t.id);
}

const w = $derived(wording(ui.indicator));
// a run's world change, every industry, in the scenario list
function worldChange(id) {
	const t = worldTotal(data.results, id, ui.indicator);
	return t ? msg.side.worldChange(`${t.delta > 0 ? "+" : ""}${amountShort(t.delta, ui.indicator)}`) : "";
}

// radio group: arrow keys move and select, as native radios do
function radioKeys(e, list, choose) {
	const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
	if (!d) return;
	e.preventDefault();
	const next = list[(list.indexOf(e.currentTarget.dataset.v) + d + list.length) % list.length];
	choose(next);
	e.currentTarget.parentElement.querySelector(`[data-v="${next}"]`)?.focus();
}
const runOptions = [...NAMED, "grid"];
// The run list is folded to the chosen run (a link's, or the default) until Change opens it,
// so country, direction, indicator and rail stay in view.
// The grid's pickers show only while the list is open: picking the grid keeps
// it open for them, and their Done folds it.
let showRuns = $state(false);
let changeButton = $state();
function pickRun(v) {
	chooseRun(v);
	if (v === "grid") return;
	foldRuns();
}
// the Try again button goes while the run loads: focus the chosen run instead
function retryHere() {
	retry();
	queueMicrotask(() => (changeButton ?? document.querySelector('#run-list [aria-checked="true"]'))?.focus());
}
function foldRuns() {
	showRuns = false;
	queueMicrotask(() => changeButton?.focus());
}
// What if… always opens folded, also after Change was used before a trip to Flows
$effect(() => {
	if (ui.mode === "whatif") showRuns = false;
});
// a job arriving, or opening the custom form, folds the list
$effect(() => {
	if (live || ui.custom) showRuns = false;
});
const chosenText = $derived(capitalise(live ? live.text : runText(data, ui.run)));
const chosenSub = $derived(
	live ? capitalise(live.source.status) : `${RUN_KIND[ui.run] ?? msg.side.efficiency} · ${worldChange(ui.run)}`,
);
// a custom run is not a run of the list: ui.run still holds the last published one
function backToPublished() {
	showRuns = false;
	setRun(ui.run);
	queueMicrotask(() => changeButton?.focus());
}
function chooseRun(v) {
	gridRun = null;
	if (v !== "grid") return setRun(v);
	// a picked cell that was never computed: show the first one, and point the pickers at it
	if (!meta.runs.includes(gridTarget.id)) gridPick = pickerState(data, firstGrid);
	gridRun = lookupGrid(data, gridPick).id;
	setRun(gridRun);
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: Escape and Done are the keyboard path -->
<div class="sheet-scrim" class:on={sheet} onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions: Escape closes the sheet from anywhere inside it -->
<aside
	class="side"
	class:open={sheet}
	id="side"
	{inert}
	aria-label={msg.side.label}
	onkeydown={(e) => sheet && e.key === "Escape" && (e.stopPropagation(), onclose())}
>
	<div class="sheet-head">
		<h2>{msg.side.heading}</h2>
		<button type="button" bind:this={done} onclick={onclose}>{msg.side.done}</button>
	</div>
	<div class="grp mode" class:flows={ui.mode === "flows"}>
		<div class="lab">{msg.mode.label}</div>
		<div class="seg big" role="group" aria-label={msg.mode.label}>
			<button type="button" aria-pressed={ui.mode === "flows"} onclick={() => setMode("flows")}>{msg.mode.flows(data.base_year)}</button>
			<button type="button" aria-pressed={ui.mode === "whatif"} onclick={() => setMode("whatif")}>{msg.mode.whatif}</button>
		</div>
		{#if ui.mode === "whatif"}
			<div class="lab sub"><span id="run-l">{msg.side.scenario}</span><small>{live ? msg.side.customShown : msg.side.published(meta.runs.length - 1)}</small></div>
			{#if !showRuns}
				<div class="run chosen">
					<span><b>{chosenText}</b><small>{chosenSub}</small></span>
					<button type="button" class="change" bind:this={changeButton} aria-expanded="false" aria-controls="run-list" aria-label={msg.side.changeLabel} onclick={() => (showRuns = true)}>{msg.side.change}</button>
				</div>
			{:else}
			<div class="runs" id="run-list" role="radiogroup" aria-labelledby="run-l">
				{#each runOptions as v (v)}
					{@const checked = v === current}
					<button
						type="button"
						class="run"
						role="radio"
						data-v={v}
						aria-checked={checked}
						tabindex={checked || (current === null && v === runOptions[0]) ? 0 : -1}
						onclick={() => pickRun(v)}
						onkeydown={(e) => radioKeys(e, runOptions, chooseRun)}
					>
						<span class="dot"></span>
						{#if v === "grid"}
							<span><b>{msg.side.gridTitle}</b><small>{msg.side.gridSize(grid?.products.length ?? 0, grid?.cuts.length ?? 0)}</small></span>
						{:else}
							<span><b>{capitalise(runText(data, v))}</b><small>{RUN_KIND[v] ?? msg.side.efficiency} · {worldChange(v)}</small></span>
						{/if}
					</button>
				{/each}
			</div>
			{/if}
			{#if live}
				<button type="button" class="chipb back" onclick={backToPublished}>{msg.side.back}</button>
			{/if}
			{#if onGrid && grid && showRuns}
				<div class="gridpick">
					<label for="g-product">{msg.side.product}</label>
					<select id="g-product" value={gridPick.scenario} onchange={(e) => pickGrid("scenario", e.currentTarget.value)}>
						{#each grid.products as p (p.slug)}<option value="grid:{p.slug}">{p.short}</option>{/each}
					</select>
					<div class="lab sub2" id="g-region-l">{msg.side.region}</div>
					<div class="seg wrap" role="group" aria-labelledby="g-region-l">
						{#each grid.regions as r (r.slug)}
							<button type="button" aria-pressed={gridPick.region === r.slug} onclick={() => pickGrid("region", r.slug)}>{continentLabel(r.name)}</button>
						{/each}
					</div>
					<div class="lab sub2" id="g-cut-l">{msg.side.cut}</div>
					<div class="seg" role="group" aria-labelledby="g-cut-l">
						{#each grid.cuts as c (c)}
							<button type="button" aria-pressed={gridPick.cut === String(c)} onclick={() => pickGrid("cut", String(c))}>{Math.abs(c)}%</button>
						{/each}
					</div>
					{#if gridMissing}
						<p class="note" role="status">
							{gridTarget.failed ? msg.side.gridFailed(gridTarget.failed) : msg.side.gridMissing}
						</p>
					{/if}
					<button type="button" class="chipb done" aria-label={msg.side.doneLabel} onclick={foldRuns}>{msg.side.done}</button>
				</div>
			{/if}
			<!-- the map's legend has the same note as a status region, read out also while this sheet is closed -->
			{#if loadingRun.startsWith("failed:")}
				<p class="hint">{msg.run.failed} <button type="button" class="chipb" onclick={retryHere}>{msg.tryAgain}</button> {msg.run.orAnother}</p>
			{:else if loadingRun}
				<p class="hint">{msg.run.loading}</p>
			{/if}
		{/if}
		<!-- mounted in both modes, so a job keeps running while Flows is shown -->
		{#if custom}<div class="custom" hidden={ui.mode !== "whatif"}>{@render custom()}</div>{/if}
	</div>

	<div class="grp">
		<div class="lab"><span id="cty-l">{msg.side.country}</span><small>{msg.side.regions(meta.countries.length)}</small></div>
		<CountryBox {meta} labelledby="cty-l" />
	</div>

	<div class="grp">
		<div class="lab">{msg.side.direction}</div>
		<div class="seg" role="group" aria-label={msg.side.direction}>
			<button type="button" aria-pressed={ui.dir === "in"} onclick={() => (ui.dir = "in")}>{msg.side.consumption}</button>
			<button type="button" aria-pressed={ui.dir === "out"} onclick={() => (ui.dir = "out")}>{msg.side.production}</button>
		</div>
	</div>

	<div class="grp">
		<div class="lab">{msg.indicator}</div>
		<div class="seg" role="group" aria-label={msg.indicator}>
			{#each meta.indicators as i (i.id)}
				<button type="button" aria-pressed={ui.indicator === i.id} onclick={() => (ui.indicator = i.id)}>{wording(i.id).label}</button>
			{/each}
		</div>
	</div>

	<div class="grp">
		<div class="lab"><span id="rail-l">{msg.side.sections}</span><small>{msg.side.sectionsShare(whatif)}</small></div>
		<Rail {sum} labelledby="rail-l" />
	</div>

	{#if tools}
		<div class="grp sheet-foot">
			<div class="lab">{msg.side.tools}</div>
			<div class="icons">{@render tools()}</div>
		</div>
	{/if}
</aside>
