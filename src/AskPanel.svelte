<script>
// Ask: a question to a model the reader runs (?ask=), answered as a view change or a custom
// scenario. The model only picks catalogue names; the page's engine computes, through the
// custom form's own worker. Everything the model sends is rendered as text, never markup.
import { ask, askSchema, leverText, systemPrompt, toModelDetails, toView } from "./lib/ask.js";
import { ui } from "./view.svelte.js";

// base: the model server's base URL; model: its name, or null for the first one it lists;
// panel: the mounted LivePanel (its catalogue() and runScenario()); meta: the page's data
let { base, model = null, panel, meta } = $props();
let question = $state("");
let busy = $state(false);
let error = $state("");
// the last answer: {reply, levers (the names the model chose), outcome}
let answer = $state.raw(null);

async function submit(event) {
	event.preventDefault();
	const q = question.trim();
	if (!q || busy) return;
	busy = true;
	error = "";
	answer = null;
	try {
		const catalog = await panel.catalogue();
		if (!catalog) throw new Error("the scenario data did not load; open Custom scenario and try again");
		const got = await ask({ base, model, system: systemPrompt(catalog), schema: askSchema(catalog), question: q });
		const reply = typeof got.reply === "string" ? got.reply : "";
		if (got.action === "view") {
			Object.assign(ui, toView(got, meta));
			answer = { reply, levers: [], outcome: "The map now shows this view." };
		} else if (got.action === "whatif") {
			const scenario = { label: "custom scenario", model_details: toModelDetails(got.levers, catalog) };
			ui.mode = "whatif";
			ui.s = 1;
			const { ok, text } = await panel.runScenario(scenario);
			if (!ok) throw new Error(text);
			answer = { reply, levers: got.levers.map(leverText), outcome: text };
		} else {
			answer = { reply, levers: [], outcome: "" };
		}
	} catch (e) {
		error = e.message;
	} finally {
		busy = false;
	}
}
</script>

<section id="ask" aria-labelledby="ask-title">
	<div class="run chosen live-card">
		<span><b id="ask-title">Ask</b><small>A model at {base} turns a question into changes; this page computes them</small></span>
	</div>
	<form id="ask-form" onsubmit={submit} aria-busy={busy}>
		<label for="ask-q">Question</label>
		<input id="ask-q" type="text" bind:value={question} placeholder="What if European car makers used 20% less steel?" required />
		<button type="submit" class="go" id="ask-go" disabled={busy}>{busy ? "Asking…" : "Ask"}</button>
	</form>
	<div role="status" id="ask-answer">
		{#if answer}
			{#if answer.reply}<p class="hint" id="ask-reply">{answer.reply}</p>{/if}
			{#if answer.levers.length}
				<p class="hint">Ran these changes, so you can check them:</p>
				<ul class="hint" id="ask-levers">
					{#each answer.levers as l}<li>{l}</li>{/each}
				</ul>
			{/if}
			{#if answer.outcome}<p class="hint" id="ask-outcome">{answer.outcome}</p>{/if}
		{/if}
	</div>
	<p class="hint bad" id="ask-error" role="alert">{error}</p>
</section>
