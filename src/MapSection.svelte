<script>
import { flushSync } from "svelte";
import { fmtPct, formatValue, signed } from "../explorer.js";
import {
	classFill,
	classify,
	divergingExtent,
	EXIOBASE_REGIONS,
	isRestOf,
	legendClasses,
	project,
	REST_OF,
	regionForIso,
	regionValues,
} from "../map.js";

let { data, docs, selection, indicator, region, baseline, motion, onselect, onreplay } = $props();

let measured = $state(0);
let svg = $state();
let tipEl = $state();
let tip = $state(null);

const unit = $derived(indicator.unit);
const features = $derived(docs.features);
const codes = $derived(features?.map((f) => regionForIso(f.iso)));
const geometry = $derived(features && project(features, Math.max(320, measured || 960)));
// the 49-region sidecar when it has this scenario, else the continental aggregates
const detailed = $derived(docs.regions && regionValues(docs.regions, selection, indicator.factor));
const view = $derived(detailed ?? regionValues(data, selection, indicator.factor));
const source = $derived(detailed ? docs.regions : data);
const values = $derived(
	baseline
		? Object.fromEntries(
				Object.entries(view.values).map(([k, v]) => [k, { ...v, delta: 0, percent: 0, scenario: v.baseline }]),
			)
		: view.values,
);
const extent = $derived(divergingExtent(Object.values(view.values).map((v) => v.percent)));
const scenario = $derived(data.scenarios.find((s) => s.id === selection.scenario));

// Only the arms the data reach: a map of decreases lists no red classes.
const legend = $derived.by(() => {
	const percents = Object.values(view.values).map((v) => v.percent ?? 0);
	const negatives = Math.min(0, ...percents) < 0;
	const positives = Math.max(0, ...percents) > 0;
	const fmt = (v) => fmtPct(v).replace("−", "-").replace("-", "−");
	return legendClasses(extent)
		.filter((r) => (r.cls >= 0 || negatives) && (r.cls <= 0 || positives))
		.map((r) => ({
			fill: classFill(r.cls),
			label: r.cls === 0 ? `within ±${fmtPct(r.to).replace("+", "")}` : `${fmt(r.from)} to ${fmt(r.to)}`,
		}));
});

// one row per distinct value: an aggregate-level view lists the five aggregates once
const tableRows = $derived.by(() => {
	const seen = new Set();
	return EXIOBASE_REGIONS.filter((r) => view.values[r.code])
		.map((r) => ({ r, v: view.values[r.code] }))
		.sort((a, b) => a.v.delta - b.v.delta)
		.filter(({ r }) => {
			const key = view.level === "aggregate" ? r.aggregate : r.code;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
});

function show(event) {
	const path = event.target.closest?.("path.country");
	if (!path) {
		tip = null;
		return;
	}
	const code = path.dataset.code;
	const v = values[code];
	let lines;
	if (!code) lines = [path.dataset.name, "Not assigned to an EXIOBASE region"];
	else if (!v) lines = [path.dataset.name, "No value"];
	else {
		const r = EXIOBASE_REGIONS.find((x) => x.code === code);
		const shared =
			v.level === "aggregate"
				? `${r.aggregate}, continental aggregate`
				: isRestOf(code)
					? `${r.name}, one value for ${REST_OF[code].split(" ").length} mapped countries`
					: r.name;
		lines = [
			fmtPct(v.percent),
			`${signed(v.delta, unit)} ${unit}, of ${formatValue(v.baseline, unit)}`,
			`${path.dataset.name} · ${shared}`,
		];
	}
	const box = svg.getBoundingClientRect();
	tip = { lines, left: 0, top: event.clientY - box.top + 16 };
	flushSync(); // the tip's width, for keeping it inside the map
	tip.left = Math.min(event.clientX - box.left + 12, box.width - tipEl.offsetWidth - 4);
}

function click(event) {
	const code = event.target.closest?.("path.country")?.dataset.code;
	if (code) onselect(code === region ? null : code);
}
</script>

{#if features}
	<section class="part" id="map-section" aria-labelledby="map-heading">
		<h2 id="map-heading">Where the change occurs, by EXIOBASE region</h2>
		<p>The change in Fig. 1 at finer grain: each of the 49 regions as a percentage of its own 2011 baseline.</p>
		<div class="map-controls">
			<label for="map-region">Highlight a region
				<select id="map-region" value={region ?? ""} onchange={(e) => onselect(e.currentTarget.value || null)}>
					<option value="">None</option>
					{#each EXIOBASE_REGIONS as r (r.code)}<option value={r.code}>{r.name}</option>{/each}
				</select>
			</label>
			<button type="button" class="replay" id="replay" onclick={onreplay}>Animate from the baseline</button>
		</div>
		<figure bind:clientWidth={measured}>
			<!-- the region picker above is the keyboard path; clicking the map is a shortcut -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<svg
				bind:this={svg}
				id="map"
				class:slow={motion === "slow"}
				class:instant={motion === "instant"}
				role="img"
				aria-labelledby="map-heading"
				aria-describedby="map-caption"
				viewBox="0 0 {Math.max(320, measured || 960)} {geometry.height}"
				height={geometry.height}
				onpointermove={show}
				onpointerleave={() => (tip = null)}
				onclick={click}
			>
				<defs>
					<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
						<line x1="0" y1="0" x2="0" y2="6" class="hatch-line" />
					</pattern>
				</defs>
				<g>
					{#each features as f, i}
						{@const v = codes[i] ? values[codes[i]] : null}
						<path
							class="country"
							class:selected={codes[i] !== null && codes[i] === region}
							d={geometry.paths[i]}
							data-code={codes[i] ?? ""}
							data-name={f.name}
							style:fill={classFill(v ? classify(v.percent, extent) : null)}
						/>
					{/each}
				</g>
				<g aria-hidden="true">
					{#each features as f, i}
						{#if codes[i]}
							<!-- every country shares a value with others: all of them at aggregate level -->
							<path
								class="hatch"
								class:selected={codes[i] === region}
								d={geometry.paths[i]}
								fill="url(#hatch)"
								style:display={view.level === "aggregate" || isRestOf(codes[i]) ? "" : "none"}
							/>
						{/if}
					{/each}
				</g>
			</svg>
			<div id="map-tip" class="tip" hidden={!tip} bind:this={tipEl} style:left="{tip?.left ?? 0}px" style:top="{tip?.top ?? 0}px">
				{#if tip}<strong>{tip.lines[0]}</strong>{#each tip.lines.slice(1) as line}<span>{line}</span>{/each}{/if}
			</div>
			<div id="map-legend" class="legend" role="group" aria-label="Map legend">
				<div class="legend-scale">
					{#each legend as row}
						<span class="legend-item"><span class="swatch" style:background={row.fill}></span><span>{row.label}</span></span>
					{/each}
				</div>
				<div class="legend-extra">
					<span class="legend-item"><span class="swatch hatched"></span><span>{view.level === "region" ? "rest-of-world aggregate (one value)" : "continental aggregate (one value)"}</span></span>
					<span class="legend-item"><span class="swatch" style:background="var(--map-nodata)"></span><span>not assigned</span></span>
				</div>
			</div>
			<p class="source" id="map-source">
				{detailed
					? `Source: ${source.breakdown}. Engine ${source.provenance.engine.branch ?? ""} ${String(source.provenance.engine.commit).slice(0, 12)}.`
					: `Source: ${source.breakdown}.`}
			</p>
			<figcaption><b>Fig. 2</b> <span id="map-caption">
				{`Change in ${indicator.name} by region where the impact occurs, as a percentage of that region's own ${data.base_year} baseline: `}{`${scenario.label}${baseline ? " (showing the baseline: no change)" : ""}. `}{view.level === "region"
					? "44 EXIOBASE countries and 5 rest-of-world aggregates; a hatched area is one of those aggregates, so all its countries share one value. "
					: "This scenario has no 49-region breakdown here, so every country shows its continental aggregate, as in Fig. 1 (all hatched). "}The countries in each rest-of-world aggregate follow Natural Earth continents. EXIOBASE's own list may differ at the edges (Greenland, the Caucasus, Central Asia). Malta is too small to draw at this scale; N. Cyprus is not assigned. Values for every region are in the table below the map.</span></figcaption>
		</figure>
		<details class="more table-fallback">
			<summary>Map values as a table</summary>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="table-wrap" tabindex="0" role="region" aria-label="Map values table">
				<table id="map-table">
					<thead><tr>
						{#each ["Region", "Level", `Baseline (${unit})`, `Change (${unit})`, "Change %"] as h}<th scope="col">{h}</th>{/each}
					</tr></thead>
					<tbody>
						{#each tableRows as { r, v } (r.code)}
							<tr class:selected={r.code === region} aria-current={r.code === region ? "true" : undefined}>
								<th scope="row">{view.level === "aggregate" ? r.aggregate : r.name}</th>
								<td>{view.level === "aggregate" ? "continental aggregate" : isRestOf(r.code) ? "rest-of-world aggregate" : "country"}</td>
								<td>{formatValue(v.baseline, unit)}</td>
								<td>{signed(v.delta, unit)}</td>
								<td>{fmtPct(v.percent)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	</section>
{/if}

<style>
	path.country {
		stroke: var(--map-edge);
		stroke-width: 0.6;
		transition: fill 0.6s ease;
		cursor: pointer;
	}
	path.hatch {
		pointer-events: none;
	}
	.hatch-line {
		stroke: var(--hatch);
		stroke-width: 1.2;
	}
	path.selected {
		stroke: var(--mark);
		stroke-width: 2.5;
	}
	path.country:hover {
		stroke: var(--text-2);
		stroke-width: 1.2;
	}
	/* replay: 1.4 s ease-out cubic, the curve the Sankey's frames follow */
	.slow path.country {
		transition-duration: 1.4s;
		transition-timing-function: cubic-bezier(0.33, 1, 0.68, 1);
	}
	.instant path.country {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		path.country {
			transition: none;
		}
	}
	.tip {
		position: absolute;
		pointer-events: none;
		display: grid;
		max-width: 18rem;
		padding: 4px 8px;
		background: var(--surface);
		border: 1px solid var(--text);
		z-index: 2;
	}
</style>
