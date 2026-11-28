<script>
// A catalogue select, indented by level. A list of more than ten items gets a
// search button that opens a box narrowing the options to the matches and their parents.
import { tick, untrack } from "svelte";
import { catalogName, filterTree } from "./lib/live.js";
import { msg } from "./lib/messages.js";

// tree: catalogTree(items); value: the picked item's id, as a string
let { id, label, tree, value = $bindable(), disabled = false } = $props();
let searching = $state(false);
let query = $state("");
let box = $state();
const shown = $derived(filterTree(tree, query));
const none = $derived(query.trim() !== "" && !shown.length);
// a new query picks its first match, unless the picked item matches too;
// value is untracked so a parent picked from the narrowed list stays picked
$effect(() => {
	const first = shown.find((n) => n.match);
	untrack(() => {
		if (first && !shown.some((n) => n.match && String(n.item.id) === value)) value = String(first.item.id);
	});
});
async function toggle() {
	searching = !searching;
	query = "";
	if (searching) {
		await tick();
		box?.focus();
	}
}
// The closed select shows the picked option's text, so that one is not indented.
const picked = $derived(tree.find((n) => String(n.item.id) === value));
const indent = (n) => (String(n.item.id) === value ? "" : "   ".repeat(n.depth));
</script>

<div class="pick-l">
	<label for={id}>{label}</label>
	{#if tree.length > 10}
		<button type="button" class="pick-s" aria-expanded={searching} aria-label={msg.picker.search(label)} {disabled} onclick={toggle}>
			<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M10.4 10.4l3.6 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
		</button>
	{/if}
</div>
{#if searching}
	<input
		type="search"
		class="pick-q"
		bind:this={box}
		bind:value={query}
		placeholder={msg.picker.placeholder}
		aria-label={msg.picker.search(label)}
		aria-controls={id}
		onkeydown={(e) => e.key === "Escape" && (e.stopPropagation(), toggle())}
	/>
	{#if none}<small class="fh" role="status">{msg.picker.none(query.trim())}</small>{/if}
{/if}
<!-- a narrow select cuts the picked name short; its title keeps the whole -->
<select {id} required {disabled} bind:value title={picked ? catalogName(picked.item) : undefined}>
	{#each none ? tree.filter((n) => String(n.item.id) === value) : shown as n (n.item.id)}
		<option value={String(n.item.id)} title={n.item.name}>{indent(n)}{catalogName(n.item)}</option>
	{/each}
</select>
