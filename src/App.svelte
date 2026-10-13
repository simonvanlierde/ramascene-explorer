<script>
import { banner, dataUrl, ignoredData, shortCommit } from "../explorer.js";
import { apiUrl, ignoredApi } from "../live.js";
import Explorer from "./Explorer.svelte";

const search = location.search;
const dataPath = dataUrl(search);
const ignored = ignoredData(search);
// Optional live panel: nothing is imported, and nothing is fetched, without ?api=.
const api = apiUrl(search);
const refusedApi = ignoredApi(search);

let data = $state.raw(null);
let empty = $state(false);
const flag = $derived(data && banner(data));

load();
async function load() {
	try {
		const response = await fetch(dataPath, { cache: "no-cache" });
		if (!response.ok) throw new Error(response.status);
		data = await response.json();
	} catch {
		empty = true;
		return;
	}
	if (banner(data).synthetic) {
		document.title = `${banner(data).text} · ${document.title}`;
		document.body.classList.add("synthetic");
	}
}
</script>

{#snippet cell(label, value)}
	<dl class="cell"><dt>{label}</dt><dd>{value}</dd></dl>
{/snippet}

{#if flag?.synthetic}
	<div id="banner" class="banner" role="alert">{flag.text}</div>
{/if}
<header>
	<h1>RaMa-Scene scenario explorer</h1>
	<p>How would the 2011 world economy's greenhouse-gas emissions, employment and metal-ore extraction change if Europe bought fewer cars, or if industries used less steel, cement or another material per unit of output? Each view is one precomputed run of the RaMa-Scene input-output engine on EXIOBASE. None of it is a forecast.</p>
	<details>
		<summary>How to read this page</summary>
		<p>The engine changes final demand or technical coefficients in the 2011 economy and recomputes it. It has no projection step, and no substitution, price or rebound effect is modelled. There are three original interventions, plus a material-efficiency grid: ten products × five continental regions × three cut sizes, each cell "every industry in the region uses that much less of the product per unit of output".</p>
		<dl>
			<dt>EXIOBASE</dt><dd>A global multi-regional input-output database: what each industry in each region buys from every other, with the emissions, employment and extraction of each industry. Here version 3.3.sm, 49 regions.</dd>
			<dt>RaMa-Scene</dt><dd>The engine that scales the selected cells of the economy and recomputes every region's totals through the Leontief inverse.</dd>
			<dt>Technical coefficient</dt><dd>How much of a product an industry buys per unit of its own output.</dd>
			<dt>Baseline</dt><dd>The unchanged 2011 economy. Every number on the page is an intervention minus this baseline.</dd>
		</dl>
	</details>
</header>

<main>
	<div class="titleblock" id="status">
		{#if data}
			{@render cell("Status", data.status.charAt(0).toUpperCase() + data.status.slice(1))}
			{@render cell("Base year", String(data.base_year))}
			{@render cell("Data kind", data.data_kind)}
			{@render cell("Dataset", data.provenance.dataset.name)}
			{@render cell("Engine commit", shortCommit(data.provenance.engine.commit))}
		{/if}
		{#if ignored !== null}<span class="fail">ignored data={ignored}</span>{/if}
		{#if refusedApi !== null}<span class="fail">ignored api={refusedApi}</span>{/if}
	</div>

	{#if data}
		<Explorer {data} {dataPath} />
	{/if}

	{#if api}{#await import("./LivePanel.svelte") then { default: LivePanel }}<LivePanel {api} />{/await}{/if}

	{#if empty}
		<div id="empty">
			<p><strong>No precomputed data here yet.</strong> The page reads <code>data/results.json</code> (with <code>data/regions.json</code> for the map and <code>data/flows.json</code> for the Sankey), which only a run of the engine on the EXIOBASE dataset produces:</p>
			<pre>uv run python precompute.py --run --engine "$ENGINE_DIR" --data "$DATASETS_DIR" \
    --out data/results.json --out-regions data/regions.json --out-flows data/flows.json</pre>
			<p>To check the page itself, open it with <code>?data=tests/fixture.json</code> (synthetic, bannered).</p>
		</div>
	{/if}
</main>
