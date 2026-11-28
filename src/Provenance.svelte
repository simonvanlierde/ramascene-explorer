<script>
import { runSummary } from "./lib/explorer.js";
import { LOCALE, msg } from "./lib/messages.js";

// meta: the embodied flows' metadata, for their own check
// scenario: the shown one, or the excluded record whose parameters are listed
// live: set while a custom run is on screen; the flows' own check does not cover it
let { data, meta, scenario, live = null } = $props();

const p = $derived(data.provenance);
const e = $derived(p.engine);
const d = $derived(p.dataset);
const v = $derived(p.reference_validation);
const run = $derived(p.run);
const control = $derived(data.checks.zero_change_control);
const direction = $derived(data.checks.scenario_direction);
// the checks of the published runs (and the control); excluded scenarios are listed separately
const independent = $derived.by(() => {
	const shown = new Set([...data.scenarios.map((s) => s.id), "zero_change_control"]);
	return data.checks.independent_by_region.filter((c) => shown.has(c.run));
});
const regionValues = $derived(independent.reduce((n, c) => n + Object.keys(c.regions).length, 0));
const runs = $derived(new Set(independent.map((c) => c.run)).size);
const verified = $derived(regionValues > 0 && independent.every((c) => c.passed));
const directionOk = $derived(direction.passed || data.checks.published_passed_every_check);
const skipped = $derived(direction.rise_check_skipped_indicators);

// [term, text, failed?]; Failed scenarios, Scenario parameters and Command have their own markup
const items = $derived.by(() => {
	const rows = [
		["data_kind", data.data_kind, data.data_kind !== "exiobase-v3"],
		[msg.terms.status, data.status],
		[
			msg.terms.engine,
			`${e.label ? `${e.label} · ` : ""}${e.repository ?? msg.provenance.noRemote} · ${e.branch ?? msg.detached} · ${e.commit}${e.dirty ? msg.uncommitted : ""}`,
		],
	];
	if (run) rows.push([msg.terms.run, msg.provenance.run(runSummary(run), p.generated_at), Boolean(run.failed)]);
	if (data.failed?.length) rows.push([msg.terms.failed]);
	rows.push(
		[msg.terms.dataset, msg.provenance.dataset(d)],
		[msg.terms.breakdown, data.breakdown],
		[msg.terms.parameters],
		[msg.terms.command],
		[msg.terms.generated, p.generated_at],
		[
			msg.terms.runtime,
			msg.runtime({
				python: p.python ?? "—",
				numpy: p.numpy ?? "—",
				django: p.django ?? "—",
				rss: p.peak_rss_bytes ? `${(p.peak_rss_bytes / 2 ** 30).toFixed(2)} GiB` : "—",
			}),
		],
	);
	return rows;
});

// [passed, text, verdict]
const checks = $derived.by(() => {
	const rows = [
		[v.passed, msg.provenance.reference(v.tolerance)],
		[
			verified,
			msg.provenance.independent(regionValues.toLocaleString(LOCALE), runs, data.indicators.length, data.regions.length),
		],
		[control.passed, msg.provenance.control],
		[directionOk, msg.provenance.direction(skipped)],
	];
	// precompute writes no flows that fail this, so it is listed only when the flows recorded it
	const flows = !live && data.data_kind === "exiobase-v3" ? meta.checks?.producer_by_country : null;
	if (flows) rows.push([flows.passed, msg.provenance.flows]);
	if (run) rows.push([!run.failed, `${runSummary(run)}.`, run.failed ? msg.provenance.excluded(run.failed) : msg.provenance.passed]);
	return rows.map(([ok, text, verdict]) => [ok, text, verdict ?? (ok ? msg.provenance.passed : msg.provenance.notPassed)]);
});
</script>

<section class="part" id="verification" aria-labelledby="verification-heading">
	<h2 id="verification-heading">{msg.provenance.heading}</h2>
	{#if live}<p><strong>{msg.provenance.notLive}</strong></p>{/if}
	<p>{msg.provenance.scope}</p>
	<p>{msg.provenance.policy}</p>
	<ul class="checks" id="checks">
		{#each checks as [ok, text, verdict]}
			<li><span class="verdict {ok ? 'pass' : 'fail'}">{verdict}</span> <span>{text}</span></li>
		{/each}
	</ul>
	<details class="more" id="provenance-panel">
		<summary>{msg.provenance.details}</summary>
		<dl id="provenance">
			{#each items as [term, text, failed]}
				<dt>{term}</dt>
				{#if term === msg.terms.failed}
					<dd><span>{msg.provenance.failedNote}</span><pre>{data.failed.map((f) => `${f.id}: ${f.reason}`).join("\n")}</pre></dd>
				{:else if term === msg.terms.parameters}
					<dd><span>{msg.provenance.parametersNote}</span><pre>{(scenario.model_details ?? []).map((step) => JSON.stringify(step)).join("\n")}</pre></dd>
				{:else if term === msg.terms.command}
					<dd><code>{p.command}</code></dd>
				{:else}
					<dd class={failed ? "fail" : undefined}>{text}</dd>
				{/if}
			{/each}
		</dl>
	</details>
</section>
