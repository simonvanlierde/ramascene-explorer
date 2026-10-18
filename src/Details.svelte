<script>
// The slide-over: the selection taken apart as a Sankey (released in →
// industry → consumed in), the same flows as a sortable table, and the
// method with every check. Provenance and the verification stay in its footer.
import { shortCommit } from "../explorer.js";
import {
	amount,
	amountText,
	flowPct,
	pct,
	runText,
	SECTION_COLOURS,
	SECTION_SHORT,
	sankeyLayout,
	share,
	wording,
} from "../flows.js";
import Provenance from "./Provenance.svelte";
import { ui } from "./view.svelte.js";

let { data, meta, sum, whatif, run } = $props();

const TABS = [
	["sankey", "Sankey"],
	["table", "Table"],
	["method", "Method"],
];
const open = $derived(ui.panel !== null);
const name = $derived(meta.countries[ui.who]);
const w = $derived(wording(ui.indicator));
const unit = $derived(amount(sum.total, ui.indicator)[1]);
const all = $derived(ui.on.size === SECTION_SHORT.length);
const scenario = $derived(data.scenarios.find((s) => s.id === (whatif ? run : "baseline")));

let panel = $state();
let lastFocus = null;
$effect(() => {
	if (open) {
		lastFocus ??= document.activeElement;
		queueMicrotask(() => panel?.querySelector(".x")?.focus({ preventScroll: true }));
	}
});
function close() {
	ui.panel = null;
	// opened from a link, nothing had focus: return to the Details chip
	(lastFocus && lastFocus !== document.body ? lastFocus : document.querySelector(".sel-chip button"))?.focus({ preventScroll: true });
	lastFocus = null;
}
function tabKeys(e, i) {
	if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
	const next = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length][0];
	ui.panel = next;
	queueMicrotask(() => panel.querySelector(`#tab-${next}`)?.focus());
}

// --- Sankey -------------------------------------------------------------------
const lay = $derived(open && ui.panel === "sankey" ? sankeyLayout(meta, sum, ui) : null);
const heads = $derived(
	ui.dir === "in"
		? [
				[lay?.x.L + lay?.nw, "end", "Released in"],
				[lay?.x.M, "start", "Industry"],
				[lay?.x.R + lay?.nw, "end", "Consumed in"],
			]
		: [
				[lay?.x.L, "start", "Released in"],
				[lay?.x.M, "start", "Industry"],
				[lay?.x.R, "start", "Consumed in"],
			],
);
const fmtV = (v) => amount(v, ui.indicator)[0];

// --- table --------------------------------------------------------------------
let sortK = $state("v");
let sortD = $state(-1);
const rows = $derived.by(() => {
	const secs = [...ui.on];
	const list = [...sum.vals.keys()]
		.filter((k) => sum.vals[k] > sum.total * 1e-6)
		.map((k) => {
			const ts = secs.reduce((a, q) => (sum.cell(k, q) > sum.cell(k, a) ? q : a), secs[0]);
			return { k, n: meta.countries[k], v: sum.vals[k], ind: SECTION_SHORT[ts], ts, c: whatif ? flowPct(sum, k) : null };
		});
	const key = sortK === "sh" ? "v" : sortK;
	return list.sort((a, b) => {
		const x = a[key];
		const y = b[key];
		return (typeof x === "string" ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * sortD;
	});
});
const maxV = $derived(Math.max(...rows.map((r) => r.v), 1e-12));
const cols = $derived([
	["n", ui.dir === "in" ? "Released in" : "Consumed in"],
	["v", unit],
	["sh", "Share"],
	["ind", "Largest industry"],
	...(whatif ? [["c", "Change"]] : []),
]);
function sortBy(k) {
	if (sortK === k) sortD = -sortD;
	else {
		sortK = k;
		sortD = k === "n" || k === "ind" ? 1 : -1;
	}
}

// --- footer ---------------------------------------------------------------------
const d = $derived(data.provenance.dataset);
const e = $derived(data.provenance.engine);
const worst = $derived(meta.checks?.producer_by_country?.max_relative_difference);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: Escape and the close button are the keyboard path -->
<div class="scrim" class:on={open} onclick={close}></div>
<div
	class="pan"
	class:on={open}
	bind:this={panel}
	role="dialog"
	aria-modal="false"
	aria-labelledby="pan-title"
	aria-hidden={!open}
	inert={!open}
	onkeydown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
>
	<div class="ph">
		<div>
			<h2 class="pt" id="pan-title">{name}</h2>
			<p class="ps">
				{ui.dir === "in" ? `What ${name} consumes` : `What ${name} releases`}{whatif ? ` · if ${runText(data, run)}` : ""} · {amountText(sum.total, ui.indicator)} · {all ? "all industries" : `${ui.on.size} of 15 industries`} · {data.base_year}
			</p>
		</div>
		<button type="button" class="x" aria-label="Close details" onclick={close}>
			<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
		</button>
	</div>
	<div class="tabs" role="tablist" aria-label="Detail view">
		{#each TABS as [id, label], i (id)}
			<button
				type="button"
				role="tab"
				id="tab-{id}"
				aria-controls="tp-{id}"
				aria-selected={ui.panel === id}
				tabindex={ui.panel === id ? 0 : -1}
				onclick={() => (ui.panel = id)}
				onkeydown={(e) => tabKeys(e, i)}>{label}</button
			>
		{/each}
	</div>

	<div class="pb" id="tp-sankey" role="tabpanel" aria-labelledby="tab-sankey" hidden={ui.panel !== "sankey"}>
		{#if lay}
			<svg class="sk" viewBox="0 0 {lay.width} {lay.height}" width="100%" role="img" aria-label="Sankey of {amountText(sum.total, ui.indicator)}: released in, industry, consumed in. The Table tab lists the same flows.">
				{#each heads as [x, a, t] (t)}<text class="h" {x} y="11" text-anchor={a}>{t}</text>{/each}
				{#each lay.links as l, i (i)}<path class="lk" d={l.d} fill={SECTION_COLOURS[l.q]}><title>{l.from} → {l.to}: {amountText(l.v, ui.indicator)}</title></path>{/each}
				{#each lay.left as n (n.name)}<rect x={lay.x.L} y={n.y} width={lay.nw} height={n.h} fill="var(--slate)"><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each lay.mid as n (n.q)}<rect x={lay.x.M} y={n.y} width={lay.nw} height={n.h} fill={SECTION_COLOURS[n.q]}><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each lay.right as n (n.name)}<rect x={lay.x.R} y={n.y} width={lay.nw} height={n.h} fill="var(--slate)"><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each [["L", lay.left], ["R", lay.right]] as [side, col] (side)}
					{#each col as n (n.name)}
						{#if n.me}
							<text class="me" x={side === "L" ? lay.x.L + lay.nw + 4 : lay.x.R - 4} y={lay.top0 - 6} text-anchor={side === "L" ? "start" : "end"}>{n.name} {amountText(n.v, ui.indicator)}</text>
						{:else if n.h >= 7}
							<text x={side === "L" ? lay.x.L - 5 : lay.x.R + lay.nw + 5} y={n.y + n.h / 2 + 3.5} text-anchor={side === "L" ? "end" : "start"}>{n.name} <tspan class="v">{fmtV(n.v)}</tspan></text>
						{/if}
					{/each}
				{/each}
				{#each lay.mid as n (n.q)}
					{#if n.h >= 7}<text class="halo" x={lay.x.M + lay.nw + 4} y={n.y + n.h / 2 + 3.5}>{n.name} <tspan class="v">{fmtV(n.v)}</tspan></text>{/if}
				{/each}
			</svg>
			<p class="skc">{unit}, {data.base_year}{whatif ? " baseline flows" : ""}. Middle column: {all ? "the 15" : `${lay.mid.length} of the 15`} industry sections, in the rail's colours. Hover a band for its value.</p>
		{/if}
	</div>

	<div class="pb" id="tp-table" role="tabpanel" aria-labelledby="tab-table" hidden={ui.panel !== "table"}>
		{#if ui.panel === "table"}
			<table id="flows-table">
				<caption>{rows.length} regions · {unit}, {data.base_year}{whatif ? " · change: this run" : ""}{all ? "" : ` · ${ui.on.size} of 15 sections`}</caption>
				<thead>
					<tr>
						{#each cols as [k, label] (k)}
							<th scope="col" aria-sort={sortK === k ? (sortD < 0 ? "descending" : "ascending") : undefined}>
								<button type="button" onclick={() => sortBy(k)}>{label}<span class="ar" aria-hidden="true">{sortK === k ? (sortD < 0 ? "↓" : "↑") : ""}</span></button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.k)}
						<tr class:me={r.k === ui.who}>
							<th scope="row">{r.n}{r.k === ui.who ? " (home)" : ""}</th>
							<td class="num"><span class="mb" style="width:{(r.v / maxV) * 42}px"></span>{fmtV(r.v)}</td>
							<td class="num">{share(r.v, sum.total)}</td>
							<td class="ind2"><i style="background:{SECTION_COLOURS[r.ts]}"></i>{r.ind}</td>
							{#if whatif}<td class="num {r.c < 0 ? 'neg' : r.c > 0 ? 'pos' : ''}">{r.c === null ? "–" : pct(r.c)}</td>{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="pb" id="tp-method" role="tabpanel" aria-labelledby="tab-method" hidden={ui.panel !== "method"}>
		<Provenance {data} {scenario} />
	</div>

	<footer class="pf">
		<p>{d.name} {d.year} (<a href="https://doi.org/{d.doi}">doi:{d.doi}</a>) · RaMa-Scene engine {e.label ?? shortCommit(e.commit)} · demand-pull Leontief model · {w.noun}</p>
		{#if worst != null}
			<p class="vf">
				<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Verified: flows sum to the engine's per-country totals (worst relative difference {worst.toExponential(0)})
			</p>
		{/if}
	</footer>
</div>
