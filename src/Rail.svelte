<script>
// The stepped industry rail: one tab per section, its height the section's
// share of the selected flows; sections switched off fold to the minimum.
// From "all", a click isolates one section; after that, clicks add or
// remove; emptying the selection returns to all.
import { amountText, SECTION_COLOURS, SECTION_SHORT, share } from "../flows.js";
import { ui } from "./view.svelte.js";

let { sum, labelledby } = $props();

const S = SECTION_SHORT.length;
// Tab heights come from app.css: a minimum plus the share of the selection
// times --rail-share, so a phone can make every tab a larger touch target.
const all = $derived(ui.on.size === S);
const total = $derived([...ui.on].reduce((a, q) => a + sum.sec[q], 0) || 1);

// One Tab stop for the whole rail: arrow keys move between tabs, Home and
// End jump to the ends, Space or Enter toggles (the native button).
let current = $state(-1); // -1 is "All"
function keys(e) {
	const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
	const to = e.key === "Home" ? -1 : e.key === "End" ? S - 1 : step == null ? null : Math.max(-1, Math.min(S - 1, current + step));
	if (to == null) return;
	e.preventDefault();
	current = to;
	e.currentTarget.querySelectorAll("button")[to + 1]?.focus();
}

function toggle(q) {
	if (all) ui.on = new Set([q]);
	else if (ui.on.has(q)) {
		const next = new Set(ui.on);
		next.delete(q);
		ui.on = next.size ? next : new Set(SECTION_SHORT.keys());
	} else ui.on = new Set([...ui.on, q]);
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions: arrow keys move focus between the buttons inside -->
<div class="rail" role="group" aria-labelledby={labelledby} onkeydown={keys}>
	<button type="button" class="all" aria-pressed={all} tabindex={current === -1 ? 0 : -1} onfocus={() => (current = -1)} onclick={() => (ui.on = new Set(SECTION_SHORT.keys()))}>
		<span>All {S} sections</span><span class="num">{amountText(all ? sum.total : sum.sec.reduce((a, b) => a + b, 0), ui.indicator)}</span>
	</button>
	{#each SECTION_SHORT as name, q (q)}
		{@const on = ui.on.has(q)}
		<button
			type="button"
			class="t"
			aria-pressed={on}
			tabindex={current === q ? 0 : -1}
			onfocus={() => (current = q)}
			style="--c:{SECTION_COLOURS[q]};--f:{on ? sum.sec[q] / total : 0}"
			title="{name}: {amountText(sum.sec[q], ui.indicator)}"
			aria-label="{name}, {amountText(sum.sec[q], ui.indicator)}{on ? `, ${share(sum.sec[q], total)} of the selection` : ', off'}"
			onclick={() => toggle(q)}
		>
			<i></i><span>{name}</span><em class="num">{on ? share(sum.sec[q], total) : ""}</em>
		</button>
	{/each}
</div>
