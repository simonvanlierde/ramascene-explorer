<script>
import { fmtPct, signed } from "../explorer.js";
import { EXIOBASE_REGIONS } from "../map.js";
import { sankeyCaption, sankeyLayout, tween } from "../sankey.js";
import { sankeyLabels } from "../visuals.js";

// t is the replay position: 1 is the intervention, towards 0 the baseline
let { data, docs, selection, indicator, region, t } = $props();
let measured = $state(0);

const unit = $derived(indicator.unit);
const f = $derived(indicator.factor);
const regionName = $derived(EXIOBASE_REGIONS.find((r) => r.code === region)?.name);
const result = $derived(docs.flows?.results?.[selection.scenario]?.[selection.indicator]);
const flows = $derived(result?.flows.map((x) => ({ ...x, delta: x.delta * f })) ?? []);

const drawing = $derived.by(() => {
	const width = Math.max(320, measured || 960);
	const narrow = width < 560;
	const labelW = narrow ? 118 : 250;
	const rows = Math.max(new Set(flows.map((x) => x.sector)).size, new Set(flows.map((x) => x.region)).size);
	const height = Math.max(narrow ? 420 : 380, rows * (narrow ? 34 : 38) + 40);
	const scaleAbs = flows.reduce((s, x) => s + Math.abs(x.delta), 0);
	const layout = sankeyLayout(t === 1 ? flows : tween(flows, t), {
		width,
		height,
		left: labelW,
		right: labelW,
		nodeWidth: narrow ? 8 : 12,
		gap: narrow ? 12 : 10,
		scaleAbs,
	});
	const opts = { narrow, height, t };
	return {
		width,
		height,
		narrow,
		links: layout.links,
		labels: [
			...sankeyLabels(layout.sources, { ...opts, anchorLeft: true }),
			...sankeyLabels(layout.targets, { ...opts, anchorLeft: false }),
		],
	};
});

const sum = $derived(result ? result.flows.reduce((s, x) => s + x.delta, 0) : 0);
const scenario = $derived(data.scenarios.find((s) => s.id === selection.scenario));
</script>

{#if result}
	<section class="part" id="sankey-section" aria-labelledby="sankey-heading">
		<h2 id="sankey-heading">Where the change comes from: sector to region</h2>
		<p>The industries whose output changes (left) and the regions where that happens (right), in the indicator's own unit.</p>
		<figure bind:clientWidth={measured}>
			<svg id="sankey" role="img" aria-labelledby="sankey-heading" aria-describedby="sankey-caption" viewBox="0 0 {drawing.width} {drawing.height}" height={drawing.height}>
				<g>
					{#each drawing.links as l}
						<path d={l.path} class="band {l.delta < 0 ? 'decrease' : 'increase'}" class:selected={l.region === regionName}>
							<title>{`${l.sector} → ${l.region}: ${signed(l.delta, unit)} ${unit}${l.named ? "" : ` (${l.cells} cells lumped)`}`}</title>
						</path>
					{/each}
				</g>
				<g>
					{#each drawing.labels as { node: n, x, y, anchor, name, leader }}
						<rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(1, n.y1 - n.y0)} class="node" />
						{#if leader}<path d={leader} class="leader" />{/if}
						<text {x} y={y - 2} text-anchor={anchor} class="label">{name}</text>
						<!-- mid-replay a band's width is an interpolation, not an engine result: no value until the end state -->
						{#if t === 1}<text {x} y={y + (drawing.narrow ? 14 : 15)} text-anchor={anchor} class="value">{signed(n.net, unit)}</text>{/if}
					{/each}
				</g>
			</svg>
			<div class="legend" role="group" aria-label="Sankey legend">
				<div class="legend-extra">
					<span class="legend-item" id="sankey-decrease" hidden={!flows.some((x) => x.delta < 0)}><span class="swatch decrease"></span><span>decrease</span></span>
					<span class="legend-item" id="sankey-increase" hidden={!flows.some((x) => x.delta > 0)}><span class="swatch increase"></span><span>increase</span></span>
				</div>
			</div>
			<p class="source" id="sankey-source">{`Method: ${docs.flows.breakdown}. ${docs.flows.method}`}</p>
			<figcaption><b>Fig. 3</b> <span id="sankey-caption">{sankeyCaption({
				indicator: indicator.name,
				unit,
				scenario: scenario.label,
				anyIncrease: flows.some((x) => x.delta > 0),
				named: result.flows.filter((x) => x.named).length,
				cells: result.cells,
				total: signed(result.total_delta * f, unit),
			})}</span></figcaption>
		</figure>
		<details class="more table-fallback">
			<summary>Sankey flows as a table</summary>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="table-wrap" tabindex="0" role="region" aria-label="Sankey flows table">
				<table id="sankey-table">
					<thead><tr>
						{#each ["Sector", "Region", `Change (${unit})`, "Share of total", "Cells"] as h}<th scope="col">{h}</th>{/each}
					</tr></thead>
					<tbody>
						{#each result.flows as x}
							<tr>
								<th scope="row">{x.sector}</th>
								<td>{x.region}</td>
								<td>{signed(x.delta * f, unit)}</td>
								<td>{result.total_delta ? fmtPct((100 * x.delta) / result.total_delta).replace("+", "") : "—"}</td>
								<td>{x.named ? "1" : String(x.cells)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<th scope="row">Sum of the bands</th>
							<td></td>
							<td>{`${signed(sum * f, unit)} (total ${signed(result.total_delta * f, unit)})`}</td>
							<td>100%</td>
							<td>{String(result.cells)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</details>
	</section>
{/if}

<style>
	.band {
		opacity: 0.55;
	}
	.band.decrease {
		fill: var(--decrease);
	}
	.band.increase {
		fill: var(--increase);
	}
	.band:hover {
		opacity: 0.85;
	}
	@media (prefers-color-scheme: dark) {
		.band:not(:hover, .selected) {
			opacity: 0.72;
		}
	}
	.band.selected {
		opacity: 0.9;
		stroke: var(--mark);
		stroke-width: 1.5;
	}
	.node {
		fill: var(--text);
	}
	.leader {
		stroke: var(--axis);
		stroke-width: 1;
		fill: none;
	}
	text {
		font-size: 15px;
	}
	.label {
		fill: var(--text);
		font-weight: 600;
	}
	.value {
		fill: var(--text-2);
	}
	@media (max-width: 560px) {
		text {
			font-size: 13px;
		}
	}
</style>
