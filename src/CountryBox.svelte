<script>
// The country combobox (WAI-ARIA combobox with a listbox popup): type to
// filter by name or code, arrows to move, Enter to choose, Escape to close.
import { placeName } from "../flows.js";
import { ui } from "./view.svelte.js";

let { meta, labelledby } = $props();
// svelte-ignore state_referenced_locally
const nm = (i) => placeName(meta, i);

// meta never changes: the page mounts once per load
// svelte-ignore state_referenced_locally
const order = [...meta.countries.keys()].sort((a, b) => nm(a).localeCompare(nm(b)));
// svelte-ignore state_referenced_locally
let text = $state(nm(ui.who));
let open = $state(false);
let active = $state(0);
let input = $state();
let list = $state();
let focused = false;

const options = $derived.by(() => {
	const q = text.trim().toLowerCase();
	const all = q === nm(ui.who).toLowerCase() ? order : null;
	return all ?? order.filter((i) => nm(i).toLowerCase().includes(q) || meta.countries[i].toLowerCase().includes(q) || meta.country_codes[i].toLowerCase() === q);
});

// follow selections made elsewhere (map, sentence) while not typing
$effect(() => {
	const name = nm(ui.who);
	if (!focused) text = name;
});

function show() {
	open = true;
	active = Math.max(0, options.indexOf(ui.who));
}
function choose(i) {
	ui.who = i;
	text = nm(i);
	open = false;
}
function keys(e) {
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		e.preventDefault();
		if (!open) return show();
		const n = Math.max(1, options.length);
		active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
		list?.querySelector(`[data-i="${options[active]}"]`)?.scrollIntoView({ block: "nearest" });
	} else if (e.key === "Enter") {
		e.preventDefault();
		if (open && options[active] != null) {
			choose(options[active]);
			input.select();
		}
	} else if (e.key === "Escape" && open) {
		e.stopPropagation();
		open = false;
		text = nm(ui.who);
	}
}
</script>

<div class="cb">
	<svg class="mag" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
	<input
		bind:this={input}
		type="text"
		role="combobox"
		aria-labelledby={labelledby}
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls="country-list"
		aria-activedescendant={open && options[active] != null ? `country-${options[active]}` : undefined}
		autocomplete="off"
		spellcheck="false"
		bind:value={text}
		onfocus={() => {
			focused = true;
			input.select();
			show();
		}}
		oninput={() => {
			open = true;
			active = 0;
		}}
		onkeydown={keys}
		onblur={() => {
			focused = false;
			open = false;
			text = nm(ui.who);
		}}
	/>
	<ul id="country-list" role="listbox" tabindex="-1" aria-label="Countries and regions" bind:this={list} hidden={!open}>
		{#each options as i, j (i)}
			<!-- svelte-ignore a11y_click_events_have_key_events: the input owns the keyboard -->
			<li
				id="country-{i}"
				role="option"
				data-i={i}
				aria-selected={j === active}
				onmousedown={(e) => {
					e.preventDefault();
					choose(i);
					input.blur();
				}}
			>
				{nm(i)}<span>{meta.country_codes[i]}</span>
			</li>
		{:else}
			<li class="none" role="option" aria-selected="false" aria-disabled="true">No region matches</li>
		{/each}
	</ul>
</div>
