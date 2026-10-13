<script>
import { fmtPct, formatValue, niceTicks, signed } from "../explorer.js";

let { rows, unit, caption } = $props();
let measured = $state(0);

const chart = $derived.by(() => {
	const width = Math.max(320, measured || 720);
	const narrow = width < 520;
	const labelW = narrow ? 104 : 140;
	const pad = narrow ? 52 : 72;
	const row = 44;
	const bar = 24;
	const ticks = niceTicks(Math.min(...rows.map((r) => r.delta)), Math.max(...rows.map((r) => r.delta)), narrow ? 3 : 4);
	const [t0, t1] = [ticks[0], ticks.at(-1)];
	const left = labelW + pad;
	const right = width - pad;
	const x = (v) => left + ((v - t0) / (t1 - t0)) * (right - left);
	const plotH = rows.length * row;
	const bars = rows.map((r, i) => {
		const y = i * row + (row - bar) / 2;
		const x0 = x(Math.min(0, r.delta));
		const x1 = x(Math.max(0, r.delta));
		const len = x1 - x0;
		const rad = Math.min(4, len);
		const neg = r.delta < 0;
		// 4px rounded data end, square at the zero baseline
		const d =
			len < 1
				? null
				: neg
					? `M${x1},${y} H${x0 + rad} Q${x0},${y} ${x0},${y + rad} V${y + bar - rad} Q${x0},${y + bar} ${x0 + rad},${y + bar} H${x1} Z`
					: `M${x0},${y} H${x1 - rad} Q${x1},${y} ${x1},${y + rad} V${y + bar - rad} Q${x1},${y + bar} ${x1 - rad},${y + bar} H${x0} Z`;
		return { r, mid: y + bar / 2, d, neg, valueX: neg ? x0 - 8 : x1 + 8 };
	});
	return { width, height: plotH + 32, plotH, ticks: ticks.map((t) => ({ t, x: x(t) })), bars };
});
</script>

<figure bind:clientWidth={measured}>
	<svg id="chart" role="img" aria-labelledby="headline" aria-describedby="caption" viewBox="0 0 {chart.width} {chart.height}" height={chart.height}>
		{#each chart.ticks as { t, x } (t)}
			<line x1={x} x2={x} y1="0" y2={chart.plotH} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} stroke-width={t === 0 ? 1.5 : 1} />
			<!-- compact ticks (−800K), so a wide axis in persons never runs its labels together -->
			<text x={x} y={chart.plotH + 22} text-anchor="middle">{formatValue(t)}</text>
		{/each}
		{#each chart.bars as { r, mid, d, neg, valueX } (r.region)}
			<text class="region" x="0" y={mid} dominant-baseline="middle">{r.region}</text>
			{#if d}
				<path {d} fill={neg ? "var(--decrease)" : "var(--increase)"}><title>{`${r.region}: ${signed(r.delta, unit)} ${unit} (${fmtPct(r.percent)})`}</title></path>
			{/if}
			<text class="value" x={valueX} y={mid} dominant-baseline="middle" text-anchor={neg ? "end" : "start"}>{r.delta === 0 ? "0" : signed(r.delta, unit)}</text>
		{/each}
	</svg>
	<figcaption><b>Fig. 1</b> <span id="caption">{caption}</span></figcaption>
</figure>

<style>
	text {
		fill: var(--text-2);
		font-size: 15px;
	}
	.region,
	.value {
		fill: var(--text);
	}
</style>
