import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { at, embodiedUrl, openEmbodied, readRun } from "../embodied.js";

const path = (p) => new URL(p, import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(path("./fixture.json"), "utf8"));

// An AsyncBuffer that counts the bytes it hands out.
async function counted(file) {
	const inner = await asyncBufferFromFile(file);
	const seen = { bytes: 0, requests: 0 };
	return {
		seen,
		byteLength: inner.byteLength,
		async slice(start, end) {
			seen.requests++;
			seen.bytes += (end ?? inner.byteLength) - start;
			return inner.slice(start, end);
		},
	};
}

test("the flows file sits next to its results document", () => {
	assert.equal(embodiedUrl("data/results.json"), "data/embodied.parquet");
	assert.equal(embodiedUrl("results.json"), "embodied.parquet");
	assert.equal(embodiedUrl("tests/fixture.json"), "tests/fixture-embodied.parquet");
});

test("the fixture's footer names one row group per run, in order", async () => {
	const src = await openEmbodied(await counted(path("./fixture-embodied.parquet")));
	const ids = fixture.scenarios.map((s) => s.id);
	assert.deepEqual(src.meta.runs, ids);
	assert.equal(src.meta.countries.length, 49);
	assert.equal(src.meta.sections.length, 15);
	// row groups tile the file's rows without gaps
	for (let g = 1; g < src.groups.length; g++) assert.equal(src.groups[g][0], src.groups[g - 1][1]);
	assert.equal(src.groups.at(-1)[1], Number(src.metadata.num_rows));
});

test("a run decodes to a dense array: absolute baseline, cuts as negative changes", async () => {
	const src = await openEmbodied(await counted(path("./fixture-embodied.parquet")));
	const base = await readRun(src, "baseline");
	const delta = await readRun(src, "cement-in-construction");
	const { meta } = src;
	assert.equal(base.length, meta.indicators.length * 49 * 15 * 49);
	const nonzero = base.filter((v) => v !== 0).length;
	assert.equal(nonzero, src.groups[0][1] - src.groups[0][0]);
	assert.ok(base.every((v) => v >= 0));
	// the fixture cuts every flow by a share of itself
	for (let i = 0; i < base.length; i++) assert.ok(delta[i] <= 0 && -delta[i] <= base[i] * (1 + 1e-6));
	// Germany's home cell is filled in every section the fixture drew for it
	const de = meta.country_codes.indexOf("DE");
	const home = Array.from({ length: 15 }, (_, s) => base[at(meta, 0, de, s, de)]);
	assert.ok(home.filter((v) => v > 0).length >= 5);
	await assert.rejects(readRun(src, "no-such-run"), /no run/);
});

test("reading one run fetches that run's bytes, not the file", async () => {
	const file = await counted(path("./fixture-embodied.parquet"));
	const src = await openEmbodied(file);
	const footer = file.seen.bytes;
	await readRun(src, "steel-europe-50");
	const run = file.seen.bytes - footer;
	const g = src.metadata.row_groups[src.meta.runs.indexOf("steel-europe-50")];
	const size = g.columns.reduce((s, c) => s + Number(c.meta_data.total_compressed_size), 0);
	assert.ok(run <= size * 1.05 + 1024, `${run} bytes for a ${size}-byte row group`);
	assert.ok(run < file.byteLength / 3);
});

// The real data, when the release asset has been downloaded: each producer's
// flows over sections and consumers add up to the engine's per-country value.
const REAL = path("../data/embodied.parquet");
test("the shipped flows sum to the engine's per-country totals", {
	// in CI the asset is downloaded first, so a missing file fails rather than skips
	skip: !existsSync(REAL) && !process.env.CI && "no data/embodied.parquet",
}, async () => {
	const regions = JSON.parse(readFileSync(path("../data/regions.json"), "utf8"));
	const file = await counted(REAL);
	const src = await openEmbodied(file);
	assert.equal(src.meta.data_kind, "exiobase-v3");
	const base = await readRun(src, "baseline");
	assert.ok(file.seen.bytes < 2e6, `${file.seen.bytes} bytes for the footer and one run`);
	const { meta } = src;
	meta.indicators.forEach((ind, i) => {
		meta.countries.forEach((name, p) => {
			let sum = 0;
			for (let s = 0; s < 15; s++) for (let c = 0; c < 49; c++) sum += base[at(meta, i, p, s, c)];
			const want = regions.results.baseline[String(ind.id)][name];
			// float32 storage: about 7 significant digits per cell
			assert.ok(Math.abs(sum - want) <= Math.abs(want) * 1e-5 + 1e-6, `${ind.id} ${name}: ${sum} vs ${want}`);
		});
	});
});

test("a failed range read can be retried", async () => {
	const inner = await asyncBufferFromFile(path("./fixture-embodied.parquet"));
	let fail = false;
	const file = {
		byteLength: inner.byteLength,
		slice(a, b) {
			if (!fail) return inner.slice(a, b);
			fail = false;
			return Promise.reject(new Error("dropped"));
		},
	};
	const src = await openEmbodied(file);
	fail = true;
	await assert.rejects(readRun(src, "steel-europe-10"), /dropped/);
	const run = await readRun(src, "steel-europe-10");
	assert.equal(run.length, src.meta.indicators.length * 49 * 15 * 49);
});
