// Paired diagnostics: node measure-browser-engine.js <before-ref> [output.json] [before-data-dir] [after-data-dir]
// Each sample gets a fresh process. Pin the parent to the same CPUs for both refs.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, loadavg } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const filename = fileURLToPath(import.meta.url);
const root = dirname(filename);
const require = createRequire(import.meta.url);
const steps = {
	tiny: { product: [82], originReg: [7], consumedBy: [81], consumedReg: [7], techChange: [-20] },
	default: { product: [180], originReg: [1], consumedBy: [198], consumedReg: [2], techChange: [-20] },
	broad: { product: [5], originReg: [7], consumedBy: [4], consumedReg: [1], techChange: [-20] },
};

async function sample(ref, workload, delayMs, directory = `${root}/data/browser-engine`) {
	const hashes = {};
	async function module(name) {
		let source =
			ref === "working-tree"
				? readFileSync(`${root}/${name}`, "utf8")
				: execFileSync("git", ["show", `${ref}:${name}`], { cwd: root, encoding: "utf8" });
		hashes[name] = createHash("sha256").update(source).digest("hex");
		for (const dependency of ["hyparquet", "hyparquet-compressors"])
			source = source.replace(`from "${dependency}"`, `from "${pathToFileURL(require.resolve(dependency)).href}"`);
		return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
	}
	const { openEngine, outputFlows } = await module("browser-data.js");
	const { scenarioOutput } = await module("browser-engine.js");
	const { asyncBufferFromFile } = await import("hyparquet");
	const manifest = readFileSync(`${directory}/manifest.json`, "utf8");
	const meta = JSON.parse(manifest);
	let bytes = 0;
	let reads = 0;
	const started = performance.now();
	const data = await openEngine(meta, async (name) => {
		const file = await asyncBufferFromFile(`${directory}/${name}-${meta.files[name].sha256}.parquet`);
		return {
			byteLength: file.byteLength,
			slice: async (start, end) => {
				bytes += (end ?? file.byteLength) - start;
				reads++;
				if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
				return file.slice(start, end);
			},
		};
	});
	const readyMs = performance.now() - started;
	const trials = [];
	for (let repeat = 0; repeat < 2; repeat++) {
		const beforeBytes = bytes;
		const beforeReads = reads;
		const start = performance.now();
		const output = await scenarioOutput(data, [steps[workload]]);
		const flows = outputFlows(data, output);
		trials.push({
			ms: performance.now() - start,
			bytes: bytes - beforeBytes,
			reads: reads - beforeReads,
			checksum: flows.reduce((sum, value) => sum + value, 0),
		});
	}
	return {
		ref,
		workload,
		delayMs,
		datasetManifestSha256: createHash("sha256").update(manifest).digest("hex"),
		hashes,
		readyMs,
		trials,
		peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
		rssBytes: process.memoryUsage().rss,
		privateDirtyBytes:
			process.platform === "linux"
				? Number(readFileSync("/proc/self/smaps_rollup", "utf8").match(/Private_Dirty:\s*(\d+)/)[1]) * 1024
				: null,
		load: loadavg(),
	};
}

if (process.argv[2] === "--sample") {
	console.log(JSON.stringify(await sample(process.argv[3], process.argv[4], Number(process.argv[5]), process.argv[6])));
} else {
	const before = process.argv[2];
	if (!before)
		throw new Error(
			"usage: node measure-browser-engine.js <before-ref> [output.json] [before-data-dir] [after-data-dir]",
		);
	const results = [];
	for (const [workload, delayMs] of [
		["tiny", 0],
		["default", 0],
		["broad", 0],
		["default", 150],
	]) {
		for (let pair = 0; pair < 7; pair++) {
			const paired = [];
			for (const ref of pair % 2 ? ["working-tree", before] : [before, "working-tree"]) {
				const result = JSON.parse(
					execFileSync(
						process.execPath,
						[
							filename,
							"--sample",
							ref,
							workload,
							String(delayMs),
							(ref === before ? process.argv[4] : process.argv[5]) ?? `${root}/data/browser-engine`,
						],
						{
							cwd: root,
							encoding: "utf8",
						},
					),
				);
				results.push({ pair, ...result });
				paired.push(result);
			}
			for (let repeat = 0; repeat < 2; repeat++) {
				const a = paired[0].trials[repeat].checksum;
				const b = paired[1].trials[repeat].checksum;
				assert.ok(
					Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)),
					"benchmark results differ",
				);
			}
		}
	}
	const report = {
		version: 1,
		date: new Date().toISOString(),
		node: process.version,
		cpu: cpus()[0].model,
		affinity:
			process.platform === "linux"
				? readFileSync("/proc/self/status", "utf8").match(/Cpus_allowed_list:\s*(.*)/)[1]
				: null,
		method:
			"seven interleaved pairs per case, fresh processes, local files with warm OS cache; initialization then cold/warm scenario plus flow aggregation; delayMs adds synthetic latency to each file read, without bandwidth limits; not a browser or network benchmark",
		results,
	};
	const text = `${JSON.stringify(report, null, 2)}\n`;
	if (process.argv[3]) writeFileSync(process.argv[3], text);
	else process.stdout.write(text);
}
