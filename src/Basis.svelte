<script>
// The header's basis pill and what it opens: where the numbers on screen come
// from. A live run names its own source, never the precomputed file's.
import { shortCommit } from "./lib/explorer.js";
import { msg } from "./lib/messages.js";
import { ui } from "./view.svelte.js";

// live: {source, rows, …} for a run that is not precomputed, else null
// away: the attributes for links to other sites
let { data, live, away = {} } = $props();

const p = $derived(data.provenance);
const d = $derived(p.dataset);
// the live rows that say where the run came from; its parameters and runtime stay in Method
const liveRows = $derived(live ? live.rows.filter(([term]) => [msg.terms.jobApi, msg.terms.engine, msg.terms.dataset, msg.terms.method, msg.terms.computed].includes(term)) : []);
const newTab = $derived(away.target ? msg.newTab : "");

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
	onpointerdown={(e) => open && !e.target.closest(".basis-w") && close(false)}
/>

<!-- Focus leaving the pill and its note closes the note, so it never covers what has focus.
     Safari does not focus a clicked button or link (relatedTarget is null), so a click
     closes it only from outside, by the pointerdown above. -->
<span class="basis-w" onfocusout={(e) => open && e.relatedTarget && !e.relatedTarget.closest(".basis-w") && close(false)}>
	<button type="button" class="pill basis" bind:this={pill} aria-expanded={open} aria-controls="basis-pop" onclick={toggle}>
		<span class="ds">{d.name} · {data.base_year} ·{" "}</span><span class="cav">{live ? msg.basis.liveCaveat(live.source.status) : msg.basis.caveat}</span>
		<svg class="chev" width="12" height="12" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 4l2.5 2.5L7.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
	{#if open}
		<div
			class="basis-pop"
			id="basis-pop"
			role="dialog"
			aria-labelledby="basis-title"
			tabindex="-1"
			bind:this={box}
		>
			{#if live}
				<p class="bt" id="basis-title">{msg.basis.thisRun(live.source.status)}</p>
				<dl>
					{#each liveRows as [term, desc]}<dt>{term}</dt><dd>{desc}</dd>{/each}
				</dl>
				<p>{msg.basis.liveNote(data.base_year)}</p>
			{:else}
				<p class="bt" id="basis-title">{msg.basis.title}</p>
				<dl>
					<dt>{msg.terms.dataset}</dt>
					<dd>{d.name}, {d.year}{#if d.doi} · <a href="https://doi.org/{d.doi}" {...away}>doi:{d.doi}{newTab}</a>{/if}</dd>
					<dt>{msg.terms.engine}</dt>
					<dd>RaMa-Scene {p.engine.label ?? shortCommit(p.engine.commit)}</dd>
					<dt>{msg.terms.model}</dt>
					<dd>{msg.basis.model}</dd>
					{#if p.generated_at}<dt>{msg.terms.generated}</dt><dd>{p.generated_at.slice(0, 10)}</dd>{/if}
				</dl>
				<p>{msg.basis.note(data.base_year)}</p>
			{/if}
			<p class="ba">
				<button type="button" class="chipb" onclick={toMethod}>{msg.basis.toMethod}</button>
				<a href="https://github.com/simonvanlierde/ramascene-explorer" {...away}>{msg.basis.source}{newTab}</a>
			</p>
		</div>
	{/if}
</span>
