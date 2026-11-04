<script>
// The header's basis pill and what it opens: where the numbers on screen come
// from. A live run names its own source, never the precomputed file's.
import { shortCommit } from "./lib/explorer.js";
import { ui } from "./view.svelte.js";

// live: {source, rows, …} for a run that is not precomputed, else null
// away: the attributes for links to other sites
let { data, live, away = {} } = $props();

const p = $derived(data.provenance);
const d = $derived(p.dataset);
// the live rows that say where the run came from; its parameters and runtime stay in Method
const liveRows = $derived(live ? live.rows.filter(([term]) => ["Job API", "Engine", "Dataset", "Method", "Computed"].includes(term)) : []);
const newTab = $derived(away.target ? " (opens in new tab)" : "");

let open = $state(false);
let pill = $state();
let box = $state();
function toggle() {
	open = !open;
	if (open) queueMicrotask(() => box?.focus());
}
function close(back = true) {
	open = false;
	if (back) pill?.focus();
}
function toMethod() {
	close(false);
	ui.panel = "method";
}
</script>

<svelte:window
	onkeydown={(e) => open && e.key === "Escape" && (e.stopPropagation(), close())}
	onclick={(e) => open && !e.target.closest(".basis-w") && close(false)}
/>

<span class="basis-w">
	<button type="button" class="pill basis" bind:this={pill} aria-expanded={open} aria-controls="basis-pop" onclick={toggle}>
		<span class="bx"><span class="ds">{d.name} · {data.base_year} · </span>{live ? live.source.status : "Published scenarios · not forecasts"}</span>
		<svg class="chev" width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
	{#if open}
		<!-- Tab out of the popover closes it, so it never covers what has focus -->
		<div
			class="basis-pop"
			id="basis-pop"
			role="dialog"
			aria-labelledby="basis-title"
			tabindex="-1"
			bind:this={box}
			onfocusout={(e) => !e.relatedTarget?.closest?.(".basis-w") && close(false)}
		>
			{#if live}
				<p class="bt" id="basis-title">This run: {live.source.status}</p>
				<dl>
					{#each liveRows as [term, desc]}<dt>{term}</dt><dd>{desc}</dd>{/each}
				</dl>
				<p>A custom scenario for the {data.base_year} economy, not a forecast. The published scenarios' checks do not cover it.</p>
			{:else}
				<p class="bt" id="basis-title">Where these numbers come from</p>
				<dl>
					<dt>Dataset</dt>
					<dd>{d.name}, {d.year} · <a href="https://doi.org/{d.doi}" {...away}>doi:{d.doi}{newTab}</a></dd>
					<dt>Engine</dt>
					<dd>RaMa-Scene {p.engine.label ?? shortCommit(p.engine.commit)}</dd>
					<dt>Model</dt>
					<dd>Demand-pull Leontief input–output model</dd>
					{#if p.generated_at}<dt>Generated</dt><dd>{p.generated_at.slice(0, 10)}</dd>{/if}
				</dl>
				<p>Each published scenario changes one thing in the {data.base_year} economy and recalculates every supply chain, with prices and all other inputs fixed. They show what that change would have done then, not what will happen.</p>
			{/if}
			<p class="ba">
				<button type="button" class="chipb" onclick={toMethod}>Method and checks</button>
				<a href="https://github.com/simonvanlierde/ramascene-explorer" {...away}>Source code by Simon van Lierde{newTab}</a>
			</p>
		</div>
	{/if}
</span>
