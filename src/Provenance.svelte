<script>
import { runSummary, shortCommit } from "../explorer.js";

// scenario: the shown one, or the excluded record whose parameters are listed
let { data, scenario } = $props();

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
		["Status", data.status],
		[
			"Engine",
			`${e.label ? `${e.label} · ` : ""}${e.repository ?? "(no remote)"} · ${e.branch ?? "(detached)"} · ${e.commit}${e.dirty ? " · uncommitted changes" : ""}`,
		],
	];
	if (run) rows.push(["Run", `${runSummary(run)} · generated ${p.generated_at}`, Boolean(run.failed)]);
	if (data.failed?.length) rows.push(["Failed scenarios"]);
	rows.push(
		[
			"Dataset",
			`${d.name} (${(d.creators ?? []).join(", ")}; Zenodo ${d.version}, ${d.published}) · doi:${d.doi} · EXIOBASE year ${d.year}, files *_${d.file_suffix}.npy`,
		],
		[
			"Reference check",
			`Octave reference (routes two and four; value added and GHG): ${v.passed ? "passed" : "not passed"}, ${v.tolerance}. Route three, shown here, is checked against B·L·ΣY per region (next line).`,
			!v.passed,
		],
		[
			"Verification",
			`${regionValues} continental values (${runs} runs, counting the baseline and the 0% control, × ${data.indicators.length} indicators × ${data.regions.length} continents) match B·L·ΣY within relative 1e-9: ${verified ? "yes" : "no"}` +
				` · 0% control reproduces baseline: ${control.passed ? "yes" : "no"}` +
				` · every published cut changes the result and raises no indicator total: ${directionOk ? "yes" : "no"}` +
				(skipped.length ? ` (rise check skipped for indicators ${skipped.join(", ")})` : ""),
			!(verified && control.passed && directionOk),
		],
		["Breakdown", data.breakdown],
		["Scenario parameters"],
		["Command"],
		["Generated", p.generated_at],
		[
			"Runtime",
			`Python ${p.python ?? "—"} · numpy ${p.numpy ?? "—"} · Django ${p.django ?? "—"} · peak RSS ${p.peak_rss_bytes ? `${(p.peak_rss_bytes / 2 ** 30).toFixed(2)} GiB` : "—"}`,
		],
	);
	return rows;
});

// [passed, text, verdict]
const checks = $derived.by(() => {
	const rows = [
		[
			v.passed,
			`The engine reproduces the Octave reference files shipped with RaMa-Scene (routes two and four; value added and GHG), ${v.tolerance}.`,
		],
		[
			verified,
			`${regionValues.toLocaleString("en")} continental values (${runs} runs, counting the baseline and the 0% control, × ${data.indicators.length} indicators × ${data.regions.length} continents), recomputed outside the engine as B·L·ΣY, match within relative 1e-9.`,
		],
		[control.passed, "A 0% intervention through the same modified-coefficient path reproduces the baseline."],
		[
			directionOk,
			"Every published intervention changes the result, and no cut raises an indicator total" +
				(skipped.length ? ` (rise check skipped for indicators ${skipped.join(", ")}).` : "."),
		],
	];
	if (run) rows.push([!run.failed, `${runSummary(run)}.`, run.failed ? `${run.failed} excluded` : "Passed"]);
	return rows.map(([ok, text, verdict]) => [ok, text, verdict ?? (ok ? "Passed" : "Not passed")]);
});
</script>

<section class="part" id="verification" aria-labelledby="verification-heading">
	<h2 id="verification-heading">Verification</h2>
	<p>The precompute writes nothing unless every check below passes; a scenario that fails one is left off the page with its reason.</p>
	<ul class="checks" id="checks">
		{#each checks as [ok, text, verdict]}
			<li><span class="verdict {ok ? 'pass' : 'fail'}">{verdict}</span> <span>{text}</span></li>
		{/each}
	</ul>
	<details class="more" id="provenance-panel">
		<summary>Full provenance</summary>
		<dl id="provenance">
			{#each items as [term, text, failed]}
				<dt>{term}</dt>
				{#if term === "Failed scenarios"}
					<dd><span>Excluded from this page, with the recorded reason:</span><pre>{data.failed.map((f) => `${f.id}: ${f.reason}`).join("\n")}</pre></dd>
				{:else if term === "Scenario parameters"}
					<dd><span>RaMa-Scene model_details, verbatim (global ids from the engine database; techChange in %):</span><pre>{(scenario.model_details ?? []).map((step) => JSON.stringify(step)).join("\n")}</pre></dd>
				{:else if term === "Command"}
					<dd><code>{p.command}</code></dd>
				{:else}
					<dd class={failed ? "fail" : undefined}>{text}</dd>
				{/if}
			{/each}
		</dl>
	</details>
</section>

<!-- the colophon: only values the run recorded -->
<footer>
	<div class="titleblock colophon" id="footer">
		<dl class="cell"><dt>Engine commit</dt><dd>{shortCommit(e.commit)}</dd></dl>
		{#if d.doi}<dl class="cell"><dt>Dataset DOI</dt><dd><a href="https://doi.org/{d.doi}">{d.doi}</a></dd></dl>{/if}
		{#if p.generated_at}<dl class="cell"><dt>Generated</dt><dd>{p.generated_at}</dd></dl>{/if}
		<dl class="cell"><dt>Built by</dt><dd>Simon van Lierde · <a href="https://github.com/simonvanlierde/ramascene-explorer">source</a></dd></dl>
	</div>
</footer>
