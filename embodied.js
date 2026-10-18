// Reads the embodied flows (data/embodied.parquet) by HTTP range request: the
// footer once, then one row group per run on demand. precompute.write_embodied
// documents the layout; the footer's "ramascene" metadata names the runs,
// countries, sections and indicators. No DOM here, so node --test covers it.

import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from "hyparquet";

const COLUMNS = ["indicator", "producer", "section", "consumer", "value"];
// The footer is about 90 kB (run names, countries, checks, provenance);
// 128 kB gets it in one request without pulling in much of the last run.
const INITIAL_FETCH = 128 * 1024;

// The embodied-flows file next to a results document: results.json →
// embodied.parquet, any other x.json → x-embodied.parquet.
export const embodiedUrl = (dataPath) =>
	/(^|\/)results\.json$/.test(dataPath)
		? dataPath.replace(/results\.json$/, "embodied.parquet")
		: dataPath.replace(/\.json$/, "-embodied.parquet");

// {file, metadata, meta, groups: [[rowStart, rowEnd]] per run}
export async function openEmbodied(file) {
	const metadata = await parquetMetadataAsync(file, { initialFetchSize: INITIAL_FETCH });
	const kv = metadata.key_value_metadata?.find((k) => k.key === "ramascene");
	if (!kv) throw new Error("embodied flows: no ramascene metadata in the footer");
	const meta = JSON.parse(kv.value);
	let start = 0;
	const groups = metadata.row_groups.map((g) => {
		const range = [start, start + Number(g.num_rows)];
		start = range[1];
		return range;
	});
	if (groups.length !== meta.runs.length)
		throw new Error(`embodied flows: ${groups.length} row groups for ${meta.runs.length} runs`);
	return { file, metadata, meta, groups };
}

export async function openEmbodiedUrl(url) {
	// No slice cache: the page keeps each decoded run, and a cache would keep a
	// failed request too, so "pick it again" could never succeed. no-cache
	// revalidates, so a redeploy never mixes old row groups with a new footer.
	const file = await asyncBufferFromUrl({ url, requestInit: { cache: "no-cache" } });
	return openEmbodied(file);
}

// Index into a dense run: indicator (position in meta.indicators), producer,
// section, consumer.
export const at = (meta, i, p, s, c) => {
	const N = meta.countries.length;
	return ((i * N + p) * meta.sections.length + s) * N + c;
};

// Long rows [indicator id, producer, section, consumer, value] to a dense
// Float64Array in the indicators' units (value × scale). Missing cells are 0.
export function dense(meta, rows) {
	const N = meta.countries.length;
	const ids = meta.indicators.map((i) => i.id);
	const scale = meta.indicators.map((i) => i.scale ?? 1);
	const out = new Float64Array(ids.length * N * meta.sections.length * N);
	for (const [id, p, s, c, v] of rows) {
		const i = ids.indexOf(Number(id));
		if (i < 0) throw new Error(`embodied flows: unknown indicator ${id}`);
		out[at(meta, i, p, s, c)] = v * scale[i];
	}
	return out;
}

// One run's row group as a dense array: absolute values for the baseline,
// scenario minus baseline for every other run.
export async function readRun(src, run) {
	const g = src.meta.runs.indexOf(run);
	if (g < 0) throw new Error(`embodied flows: no run ${run}`);
	const [rowStart, rowEnd] = src.groups[g];
	let rows = [];
	await parquetRead({
		file: src.file,
		metadata: src.metadata,
		rowStart,
		rowEnd,
		columns: COLUMNS,
		onComplete: (r) => {
			rows = r;
		},
	});
	return dense(src.meta, rows);
}
