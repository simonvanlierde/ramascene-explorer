<script>
import { tick } from "svelte";
// The slide-over: the selection taken apart as a Sankey (released in →
// industry → consumed in), the same flows as a sortable table, and the
// method with every check. Provenance and the verification stay in its footer.
import { shortCommit } from "../explorer.js";
import {
	amount,
	amountText,
	flowsCsv,
	pct,
	placeName,
	SECTION_COLOURS,
	SECTION_SHORT,
	sankeyLayout,
	share,
	tableRows,
	wording,
} from "../flows.js";
import Provenance from "./Provenance.svelte";
import { ui } from "./view.svelte.js";

// text: the shown run's "if …" clause; live: {source, text, rows} for a run that is not precomputed, else null
let { data, meta, sum, whatif, run, text, live } = $props();

const TABS = [
	["sankey", "Sankey"],
	["table", "Table"],
	["method", "Method"],
];
const open = $derived(ui.panel !== null);
const name = $derived(placeName(meta, ui.who));
const w = $derived(wording(ui.indicator));
const unit = $derived(amount(sum.total, ui.indicator)[1]);
const all = $derived(ui.on.size === SECTION_SHORT.length);
// a live run's parameters are in its own provenance rows
const scenario = $derived(data.scenarios.find((s) => s.id === (whatif && !live ? run : "baseline")));

let panel = $state();
let lastFocus = null;
$effect(() => {
	if (open) {
		lastFocus ??= document.activeElement;
		queueMicrotask(() => panel?.querySelector(".x")?.focus({ preventScroll: true }));
	}
});
async function close() {
	const back = lastFocus && lastFocus !== document.body ? lastFocus : null;
	lastFocus = null;
	ui.panel = null;
	// the page is inert until this render lands, and an inert element takes no focus
	await tick();
	// opened from a link, nothing had focus: return to the Details chip
	(back ?? document.querySelector(".sel-chip button"))?.focus({ preventScroll: true });
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
				[lay?.x.L + lay?.nw, "end", w.made.col],
				[lay?.x.M, "start", "Industry"],
				[lay?.x.R + lay?.nw, "end", "Consumed in"],
			]
		: [
				[lay?.x.L, "start", w.made.col],
				[lay?.x.M, "start", "Industry"],
				[lay?.x.R, "start", "Consumed in"],
			],
);
const fmtV = (v) => amount(v, ui.indicator)[0];
// A Sankey drawn narrower than its layout scales its text down with it; k sets
// the text back to its own size (in layout units), and labels need that much room.
let skW = $state(0);
const k = $derived(lay && skW ? Math.max(1, lay.width / skW) : 1);
const room = $derived(7 * k);

// --- table --------------------------------------------------------------------
let sortK = $state("v");
let sortD = $state(-1);
const rows = $derived.by(() => {
	const list = tableRows(meta, sum, ui.on);
	const key = sortK === "sh" ? "v" : sortK;
	return list.sort((a, b) => {
		const x = a[key];
		const y = b[key];
		return (typeof x === "string" ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * sortD;
	});
});
const maxV = $derived(Math.max(...rows.map((r) => r.v), 1e-12));
const cols = $derived([
	["n", ui.dir === "in" ? w.made.col : "Consumed in"],
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

// The table's rows as a CSV file, whatever the sort.
function downloadCsv() {
	const sel = { id: ui.indicator, who: ui.who, dir: ui.dir, on: ui.on };
	const { name, text } = flowsCsv(meta, sum, sel, { data, run: whatif ? run : null });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- copy link ----------------------------------------------------------------
// The query string holds the whole view, so the link is the page's own URL.
let copied = $state("");
let linkBox = $state(null);
let linkInput = $state();
let copyTimer;
async function copyLink() {
	const href = location.href;
	try {
		await navigator.clipboard.writeText(href);
		linkBox = null;
		copied = "Link copied";
	} catch {
		// no Clipboard API (or it was refused): select the link for a manual copy
		linkBox = href;
		copied = "Link selected: press Ctrl+C or ⌘C to copy it";
		await tick();
		linkInput?.select();
	}
	clearTimeout(copyTimer);
	copyTimer = setTimeout(() => (copied = ""), 2500);
}

// --- footer ---------------------------------------------------------------------
const d = $derived(data.provenance.dataset);
const e = $derived(data.provenance.engine);
// only a passed check on engine output earns the green line
const check = $derived(meta.data_kind === "exiobase-v3" && meta.checks?.producer_by_country?.passed === true ? meta.checks.producer_by_country : null);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: Escape and the close button are the keyboard path -->
<div class="scrim" class:on={open} onclick={close}></div>
<div
	class="pan"
	class:on={open}
	bind:this={panel}
	role="dialog"
	aria-modal="true"
	aria-labelledby="pan-title"
	aria-hidden={!open}
	inert={!open}
	onkeydown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
>
	<div class="ph">
		<div>
			<h2 class="pt" id="pan-title">{name}</h2>
			<p class="ps">
				{ui.dir === "in" ? `What ${name} consumes` : w.made.own(name)}{whatif ? ` · if ${text}` : ""} · {amountText(sum.total, ui.indicator)} · {all ? "all 15 industry sections" : `${ui.on.size} of 15 industry sections`} · {data.base_year}
			</p>
			<p class="copied" role="status">{copied}</p>
			{#if linkBox}<input bind:this={linkInput} class="link" readonly value={linkBox} aria-label="Link to this view" onfocus={(e) => e.currentTarget.select()} />{/if}
		</div>
		<div class="pa">
			<button type="button" class="chipb" onclick={copyLink}>
				<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
				Copy link
			</button>
			<button type="button" class="x" aria-label="Close details" onclick={close}>
				<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
			</button>
		</div>
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

	<div class="pb" id="tp-sankey" role="tabpanel" tabindex="0" aria-labelledby="tab-sankey" hidden={ui.panel !== "sankey"}>
		{#if lay}
			<div class="skw" bind:clientWidth={skW}>
			<svg class="sk" style="--k:{k}" viewBox="0 0 {lay.width} {lay.height}" width="100%" role="img" aria-label="Sankey of {amountText(sum.total, ui.indicator)}: {w.made.col.toLowerCase()}, industry, consumed in. The Table tab lists the same flows.">
				{#each heads as [x, a, t] (t)}<text class="h" {x} y="11" text-anchor={a}>{t}</text>{/each}
				{#each lay.links as l, i (i)}<path class="lk" d={l.d} fill={SECTION_COLOURS[l.q]}><title>{l.from} → {l.to}: {amountText(l.v, ui.indicator)}</title></path>{/each}
				{#each lay.left as n (n.name)}<rect x={lay.x.L} y={n.y} width={lay.nw} height={n.h} fill="var(--slate)"><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each lay.mid as n (n.q)}<rect x={lay.x.M} y={n.y} width={lay.nw} height={n.h} fill={SECTION_COLOURS[n.q]}><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each lay.right as n (n.name)}<rect x={lay.x.R} y={n.y} width={lay.nw} height={n.h} fill="var(--slate)"><title>{n.name}: {amountText(n.v, ui.indicator)}</title></rect>{/each}
				{#each [["L", lay.left], ["R", lay.right]] as [side, col] (side)}
					{#each col as n (n.name)}
						{#if n.me}
							<text class="me" x={side === "L" ? lay.x.L + lay.nw + 4 : lay.x.R - 4} y={lay.top0 - 6} text-anchor={side === "L" ? "start" : "end"}>{n.name} {amountText(n.v, ui.indicator)}</text>
						{:else if n.h >= room}
							<text x={side === "L" ? lay.x.L - 5 : lay.x.R + lay.nw + 5} y={n.y + n.h / 2 + 3.5} text-anchor={side === "L" ? "end" : "start"}>{n.name} <tspan class="v">{fmtV(n.v)}</tspan></text>
						{/if}
					{/each}
				{/each}
				{#each lay.mid as n (n.q)}
					{#if n.h >= room}<text class="halo" x={lay.x.M + lay.nw + 4} y={n.y + n.h / 2 + 3.5}>{n.name} <tspan class="v">{fmtV(n.v)}</tspan></text>{/if}
				{/each}
			</svg>
			</div>
			<p class="skc">{unit}, {data.base_year}{whatif ? " baseline flows" : ""}. Middle column: {all ? "the 15" : `${lay.mid.length} of the 15`} industry sections, in the same colours as the section buttons. Hover a band for its value; the Table tab lists every flow.</p>
		{/if}
	</div>

	<div class="pb" id="tp-table" role="tabpanel" aria-labelledby="tab-table" hidden={ui.panel !== "table"}>
		{#if ui.panel === "table"}
			<div class="tbar">
				<button type="button" class="chipb" onclick={downloadCsv}>
					<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
					Download CSV
				</button>
			</div>
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
							<th scope="row">{placeName(meta, r.k)}{r.k === ui.who ? " (home)" : ""}</th>
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
		<section class="part" aria-labelledby="meaning-heading">
			<h2 id="meaning-heading">What the numbers mean</h2>
			<p>
				Each flow is the {w.noun} that industries in one country {ui.indicator === 3 ? "provide" : ui.indicator === 7 ? "extract" : "release"} in {data.base_year}
				to make goods and services finally bought in another: by households, governments and investment, not by other industries along the way.
				A country's consumption sums the flows into it; its production sums the flows out of it.
			</p>
			<p>
				The figures come from the RaMa-Scene engine's demand-pull model on {data.provenance.dataset.name}. What if… shows how one precomputed
				change to 2011 demand, or to an industry's inputs, would have shifted them. None of it is a forecast.
			</p>
		</section>
		{#if live}
			<section class="part" aria-labelledby="live-provenance-heading">
				<h2 id="live-provenance-heading">{live.source.heading}</h2>
				<p>{live.source.note}</p>
				<dl id="live-run-provenance">
					{#each live.rows as [term, desc]}
						<dt>{term}</dt>
						<dd>{#if term === "Scenario parameters"}<pre>{desc}</pre>{:else}{desc}{/if}</dd>
					{/each}
				</dl>
			</section>
		{/if}
		<Provenance {data} {scenario} />
	</div>

	<footer class="pf">
		<p>{d.name} {d.year} (<a href="https://doi.org/{d.doi}">doi:{d.doi}</a>) · RaMa-Scene engine {e.label ?? shortCommit(e.commit)} · demand-pull Leontief model · {w.noun}</p>
		{#if check && !live}
			<p class="vf">
				<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Verified: flows sum to the engine's per-country totals (worst relative difference {check.max_relative_difference.toExponential(0)})
			</p>
		{/if}
	</footer>
</div>
