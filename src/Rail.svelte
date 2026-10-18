<script>
// The stepped industry rail: one tab per section, its height the section's
// share of the selected flows; sections switched off fold to the minimum.
// From "all", a click isolates one section; after that, clicks add or
// remove; emptying the selection returns to all.
import { amountText, SECTION_COLOURS, SECTION_SHORT, share } from "../flows.js";
import { ui } from "./view.svelte.js";

let { sum, labelledby } = $props();

const S = SECTION_SHORT.length;
// Every tab is at least 20 px tall with 4 px between, so each meets the WCAG
// 2.2 target-size spacing rule; the share of the selection adds up to 180 px.
const MIN = 20;
const SHARE = 180;
const all = $derived(ui.on.size === S);
const total = $derived([...ui.on].reduce((a, q) => a + sum.sec[q], 0) || 1);

function toggle(q) {
	if (all) ui.on = new Set([q]);
	else if (ui.on.has(q)) {
		const next = new Set(ui.on);
		next.delete(q);
		ui.on = next.size ? next : new Set(SECTION_SHORT.keys());
	} else ui.on = new Set([...ui.on, q]);
}
</script>

<div class="rail" role="group" aria-labelledby={labelledby}>
	<button type="button" class="all" aria-pressed={all} onclick={() => (ui.on = new Set(SECTION_SHORT.keys()))}>
		<span>All {S} sections</span><span class="num">{amountText(all ? sum.total : sum.sec.reduce((a, b) => a + b, 0), ui.indicator)}</span>
	</button>
	{#each SECTION_SHORT as name, q (q)}
		{@const on = ui.on.has(q)}
		<button
			type="button"
			class="t"
			aria-pressed={on}
			style="--c:{SECTION_COLOURS[q]};height:{MIN + (on ? (SHARE * sum.sec[q]) / total : 0)}px"
			title="{name}: {amountText(sum.sec[q], ui.indicator)}"
			aria-label="{name}, {amountText(sum.sec[q], ui.indicator)}{on ? `, ${share(sum.sec[q], total)} of the selection` : ', off'}"
			onclick={() => toggle(q)}
		>
			<i></i><span>{name}</span><em class="num">{on ? share(sum.sec[q], total) : ""}</em>
		</button>
	{/each}
</div>
