<script>
import { tick } from "svelte";
import {
	compare,
	displayIndicator,
	fmtPct,
	formatValue,
	headline,
	lookupGrid,
	parseState,
	pickerState,
	scenarioMenu,
	signed,
	stateToSearch,
} from "../explorer.js";
import { regionParam, withRegion } from "../map.js";
import { loadVisuals } from "../visuals.js";
import BarChart from "./BarChart.svelte";
import MapSection from "./MapSection.svelte";
import Provenance from "./Provenance.svelte";
import SankeySection from "./SankeySection.svelte";

let { data, dataPath } = $props();

// data and dataPath never change: the page mounts this once per load
// svelte-ignore state_referenced_locally
const menu = scenarioMenu(data);
let docs = $state.raw({});
// svelte-ignore state_referenced_locally
loadVisuals(dataPath, data).then((d) => {
	docs = d;
});

// the last published selection; the pickers may point at an excluded or never-run cell
// svelte-ignore state_referenced_locally
let selection = $state.raw(parseState(location.search, data));
// svelte-ignore state_referenced_locally
let picker = $state.raw(pickerState(data, selection.scenario));
// the map's region highlight: its own ?region= parameter, next to the selection
let region = $state(regionParam(location.search));

const target = $derived(lookupGrid(data, picker));
const shown = $derived(target.id === selection.scenario);
const failed = $derived((data.failed ?? []).find((f) => f.id === target.id));
const onGrid = $derived(picker.scenario.startsWith("grid:"));
const scenarioName = $derived(
	[...menu.interventions, ...menu.grid].find((o) => o.value === picker.scenario)?.label ?? "",
);
const scenario = $derived(data.scenarios.find((s) => s.id === selection.scenario));
const indicator = $derived(displayIndicator(data.indicators.find((i) => String(i.id) === selection.indicator)));
const rows = $derived(compare(data, selection, indicator.factor));
const baseTotal = $derived(rows.reduce((s, r) => s + r.baseline, 0));
const deltaTotal = $derived(rows.reduce((s, r) => s + r.delta, 0));
const caption = $derived(
	`Change in ${indicator.name} (${indicator.unit}) by region where the impact occurs, ` +
		`intervention minus the ${data.base_year} baseline. ${barKey(rows)} ` +
		"Regions are the five continental aggregates of the RaMa-Scene database.",
);

function update(key, value) {
	const next = { ...picker, indicator: selection.indicator, [key]: value };
	picker = { scenario: next.scenario, region: next.region, cut: next.cut };
	const t = lookupGrid(data, picker);
	// an excluded or never-run cell is shown as such and does not enter the URL
	selection = { scenario: t.id in data.results ? t.id : selection.scenario, indicator: next.indicator };
	history.replaceState(null, "", stateToSearch(selection, location.search) + location.hash);
	stopReplay();
}

function selectRegion(code) {
	region = code;
	history.replaceState(null, "", withRegion(location.search, code) + location.hash);
	stopReplay();
}

// the colour key names only the directions the bars show, as the Sankey's does
function barKey(rows) {
	const down = rows.some((r) => r.delta < 0);
	const up = rows.some((r) => r.delta > 0);
	if (down && up) return "Blue bars are decreases, red bars increases.";
	if (down) return "Every bar is a decrease.";
	return up ? "Every bar is an increase." : "No region changes.";
}

// --- baseline → intervention -------------------------------------------------------
// The map's fills tween from the neutral baseline (CSS transition on fill)
// while the Sankey bands grow from nothing, both on the same ease-out over
// the same duration. With reduced motion there is no tween: the baseline is
// held for a moment, then the intervention replaces it in one step.
let mapBaseline = $state(false);
let mapMotion = $state("");
let sankeyT = $state(1);
// One replay at a time: a new replay, or any change of the selection, cancels
// the running one (its frames would otherwise draw a stale scenario).
let replay = 0;
function stopReplay() {
	replay++;
	mapBaseline = false;
	mapMotion = "";
	sankeyT = 1;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// forces style and layout, so the fills set so far are committed before the next change
const commit = () => document.body.getBoundingClientRect();

async function animateFromBaseline(ms = 1400) {
	stopReplay();
	const id = replay;
	// jump to the baseline without a transition (a reversed one would be cut short to ~0 s)
	mapMotion = "instant";
	mapBaseline = true;
	if (reduced()) sankeyT = 0.001;
	await tick();
	commit();
	if (reduced()) {
		setTimeout(() => {
			if (id === replay) stopReplay();
		}, 700);
		return;
	}
	// then let the fills transition to the intervention
	mapMotion = "slow";
	await tick();
	commit();
	requestAnimationFrame(() => {
		if (id === replay) mapBaseline = false;
	});
	setTimeout(() => {
		if (id === replay) mapMotion = "";
	}, ms + 100);
	const start = performance.now();
	const frame = (now) => {
		if (id !== replay) return;
		const p = Math.min(1, (now - start) / ms);
		const t = 1 - (1 - p) ** 3; // ease-out cubic, as the map's CSS curve
		sankeyT = p < 1 ? Math.max(t, 0.001) : 1;
		if (p < 1) requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
}
</script>

<div id="app">
	<div class="controls" role="group" aria-label="Selection">
		<label for="scenario">Intervention, compared with the 2011 baseline
			<select id="scenario" aria-describedby="scenario-name" value={picker.scenario} onchange={(e) => update("scenario", e.currentTarget.value)}>
				<optgroup label="Interventions">
					{#each menu.interventions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
				</optgroup>
				{#if menu.grid.length}
					<optgroup label="Material-efficiency grid: less of this product in every industry of a region">
						{#each menu.grid as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
					</optgroup>
				{/if}
			</select>
			<!-- the select clips a long name on a phone; the full name is repeated under it -->
			<span class="scenario-name" id="scenario-name">{scenarioName}</span>
		</label>
		<!-- region and cut belong to the grid only; a named intervention hides them -->
		<div id="grid-controls" hidden={!onGrid}>
			<label for="region">Region that uses less
				<select id="region" value={picker.region} onchange={(e) => update("region", e.currentTarget.value)}>
					{#each data.grid?.regions ?? [] as r (r.slug)}<option value={r.slug}>{r.name}</option>{/each}
				</select>
			</label>
			<label for="cut">Cut
				<select id="cut" value={picker.cut} onchange={(e) => update("cut", e.currentTarget.value)}>
					{#each data.grid?.cuts ?? [] as c (c)}<option value={String(c)}>{`${c}%`.replace("-", "−")}</option>{/each}
				</select>
			</label>
		</div>
		<label for="indicator">Indicator
			<select id="indicator" value={selection.indicator} onchange={(e) => update("indicator", e.currentTarget.value)}>
				{#each data.indicators.map(displayIndicator) as i (i.id)}<option value={String(i.id)}>{`${i.short} (${i.unit})`}</option>{/each}
			</select>
		</label>
	</div>
	<p class="notice" id="notice" role="status" hidden={shown}>
		{#if !shown}
			{target.failed
				? `${failed?.label ?? target.id} was run but failed a check and is not published: ${target.failed}`
				: `${target.id} was not part of this run.`}
		{/if}
	</p>
	<div id="result" hidden={!shown}>
		<div>
			<p class="big" id="big" aria-hidden="true"><span>{signed(deltaTotal, indicator.unit)}</span> <span class="unit">{indicator.unit}</span></p>
			<p class="headline" id="headline">{shown ? headline(indicator, deltaTotal, baseTotal) : ""}</p>
			<dl class="declaration"><dt>Declared change</dt><dd id="scenario-text">{shown ? scenario.description : ""}</dd></dl>
		</div>
		<BarChart {rows} unit={indicator.unit} {caption} />
		<details class="more">
			<summary>Values by continental region</summary>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="table-wrap" tabindex="0" role="region" aria-label="Values table">
				<table id="table">
					<thead><tr>
						{#each ["Region", `Change (${indicator.unit})`, "Change %", `Baseline (${indicator.unit})`, `Intervention (${indicator.unit})`] as h}<th scope="col">{h}</th>{/each}
					</tr></thead>
					<tbody>
						{#each rows as r (r.region)}
							<tr>
								<th scope="row">{r.region}</th>
								<td>{signed(r.delta, indicator.unit)}</td>
								<td>{fmtPct(r.percent)}</td>
								<td>{formatValue(r.baseline, indicator.unit)}</td>
								<td>{formatValue(r.scenario, indicator.unit)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>

		{#if shown}
			<MapSection
				{data}
				{docs}
				{selection}
				{indicator}
				{region}
				baseline={mapBaseline}
				motion={mapMotion}
				onselect={selectRegion}
				onreplay={() => animateFromBaseline()}
			/>
			<SankeySection {data} {docs} {selection} {indicator} {region} t={sankeyT} />
		{/if}
	</div>

	<Provenance {data} scenario={shown ? scenario : (failed ?? { model_details: [] })} />
</div>

<style>
	@media (min-width: 561px) {
		.scenario-name {
			display: none;
		}
	}
</style>
