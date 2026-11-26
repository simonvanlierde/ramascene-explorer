<script>
// Ask: a question to a model the reader runs (?ask=), answered as a view change or a custom
// scenario. The model only picks catalogue names; the page's engine computes, through the
// custom form's own worker. Everything the model sends is rendered as text, never markup.
import { applyView, ask, askSchema, leverText, systemPrompt, toModelDetails } from "./lib/ask.js";
import { ui } from "./view.svelte.js";

// base: the model server's base URL; model: its name, or null for the first one it lists;
// panel: the mounted LivePanel (its catalogue(), runScenario() and cancelRun()); meta: the page's data
let { base, model = null, panel, meta } = $props();
let question = $state("");
let busy = $state(false);
let error = $state("");
// the last answer: {reply, levers (the names the model chose), outcome}
let answer = $state.raw(null);
// set while busy: Cancel aborts the model call through it
let stop = null;
// a run the Custom form starts itself replaces what the map shows, so the last answer no longer
// holds; busy is tracked too, for an answer that lands while such a run computes. Ask's own runs
// end (running false) before busy does, so they keep theirs.
$effect(() => {
	if (panel.isRunning() && !busy) answer = null;
});

async function submit(event) {
	event.preventDefault();
	const q = question.trim();
	if (!q || busy) return;
	busy = true;
	error = "";
	answer = null;
	stop = new AbortController();
	try {
		const catalog = await panel.catalogue();
		if (!catalog) throw new Error("the scenario data did not load; open Custom scenario and try again");
		const got = await ask({ base, model, system: systemPrompt(catalog), schema: askSchema(catalog), question: q, cancel: stop.signal });
		const reply = typeof got.reply === "string" ? got.reply : "";
		if (got.action === "view") {
			answer = { reply, levers: [], outcome: applyView(got, meta, ui) };
		} else if (got.action === "whatif") {
			const scenario = { label: "custom scenario", model_details: toModelDetails(got.levers, catalog) };
			const { ok, text, cancelled } = await panel.runScenario(scenario);
			if (cancelled) answer = { reply: "", levers: [], outcome: "Cancelled." };
			else if (!ok) throw new Error(text);
			else answer = { reply, levers: got.levers.map(leverText), outcome: text };
		} else if (got.action === "none") {
			answer = { reply, levers: [], outcome: "" };
		} else throw new Error("the model's answer has no action this page knows");
	} catch (e) {
		if (e.name === "AbortError") answer = { reply: "", levers: [], outcome: "Cancelled." };
		else error = e.message;
	} finally {
		busy = false;
		stop = null;
	}
}

function cancel() {
	stop?.abort();
	panel.cancelRun();
	document.getElementById("ask-q")?.focus();
}
</script>

<section id="ask" aria-labelledby="ask-title">
	<div class="run chosen live-card">
		<span><b id="ask-title">Ask</b><small>A model at {base} turns a question into changes; this page computes them</small></span>
	</div>
	<form id="ask-form" onsubmit={submit} aria-busy={busy}>
		<label for="ask-q">Question</label>
		<input id="ask-q" type="text" bind:value={question} required aria-describedby="ask-q-h" />
		<small class="fh" id="ask-q-h">For example: What if European car makers used 20% less steel?</small>
		<button type="submit" class="go" id="ask-go" aria-disabled={busy}>{busy ? "Asking…" : "Ask"}</button>
		{#if busy}<button type="button" class="chipb" id="ask-cancel" onclick={cancel}>Cancel</button>{/if}
	</form>
	<div role="status" id="ask-answer">
		{#if busy}
			<p class="hint">Asking the model…</p>
		{:else if answer}
			<!-- the model server's words, not this page's: labelled so a crafted ?ask= cannot pass for the site -->
			{#if answer.reply}<p class="hint" id="ask-reply">Model: {answer.reply}</p>{/if}
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
