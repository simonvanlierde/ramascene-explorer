// Diagnostics: node scripts/measure-browser-engine.js [--network] [output.json] [data-dir]
// Each sample gets a fresh process. Pin the parent to fixed CPUs.
// --network serves every read through a simulated link instead of straight from disk.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openEngine } from "../src/lib/browser-engine/browser-data.js";
import { plan, scenarioFlows } from "../src/lib/browser-engine/browser-engine.js";
import "../tests/engine-wasm.js";
import { localRange } from "../tests/local-range.js";

const filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(filename));
const sections = Array.from({ length: 15 }, (_, i) => i + 1);
const steps = {
	tiny: { product: [82], originReg: [7], consumedBy: [81], consumedReg: [7], techChange: [-20] },
	default: { product: [180], originReg: [1], consumedBy: [198], consumedReg: [2], techChange: [-20] },
	"steel to all of Europe": {
		product: [180],
		originReg: [1],
		consumedBy: sections,
		consumedReg: [2],
		techChange: [-20],
	},
	"electricity to manufacturing": {
		product: [6],
		originReg: [1],
		consumedBy: [4],
		consumedReg: [1],
		techChange: [-20],
	},
	"manufacturing to electricity": {
		product: [5],
		originReg: [1],
		consumedBy: [5],
		consumedReg: [1],
		techChange: [-20],
	},
	"China final demand": { product: [1], originReg: [1], consumedBy: [276], consumedReg: [37], techChange: [-20] },
};

// The simulated link: a fixed delay per request, then the bytes queue for a shared
// 100 Mbit/s line, so parallel requests split the bandwidth as on a real connection.
const LINK = { delayMs: 30, bytesPerMs: 100e6 / 8 / 1000 };

async function sample(workload, delayMs, directory, network) {
	const manifest = readFileSync(`${directory}/manifest-v3.json`, "utf8");
	const meta = JSON.parse(manifest);
	const local = localRange(directory, meta);
	let bytes = 0;
	let reads = 0;
	let linkFree = 0;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const data = openEngine(meta, async (...args) => {
		reads++;
		if (delayMs) await wait(delayMs);
		const buffer = await local(...args);
		bytes += buffer.byteLength;
		if (network) {
			const start = Math.max(performance.now() + LINK.delayMs, linkFree);
			linkFree = start + buffer.byteLength / LINK.bytesPerMs;
			await wait(linkFree - performance.now());
		}
		return buffer;
	});
	const { rows, columns, J, byRows, download } = plan(meta, [steps[workload]]);
	const trials = [];
	for (let repeat = 0; repeat < 2; repeat++) {
		const beforeBytes = bytes;
		const beforeReads = reads;
		const start = performance.now();
		const flows = await scenarioFlows(data, [steps[workload]]);
		trials.push({
			ms: performance.now() - start,
			bytes: bytes - beforeBytes,
			reads: reads - beforeReads,
			checksum: flows.reduce((sum, value) => sum + value, 0),
		});
	}
	return {
		workload,
		delayMs,
		network,
		size: { rows: rows.length, columns: columns.length, flowColumns: J.length, lByRows: byRows, download },
		datasetManifestSha256: createHash("sha256").update(manifest).digest("hex"),
		trials,
		peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
		load: loadavg(),
	};
}

if (process.argv[2] === "--sample") {
	const [workload, delayMs, directory, network] = process.argv.slice(3);
	console.log(JSON.stringify(await sample(workload, Number(delayMs), directory, network === "network")));
} else {
	const network = process.argv.includes("--network");
	const [output, directory = `${root}/data/browser-engine`] = process.argv.slice(2).filter((a) => a !== "--network");
	const results = [];
	const cases = [...Object.keys(steps).map((w) => [w, 0]), ["default", 150]];
	for (const [workload, delayMs] of cases)
		for (let repeat = 0; repeat < 5; repeat++)
			results.push(
				JSON.parse(
					execFileSync(
						process.execPath,
						[filename, "--sample", workload, String(delayMs), directory, network ? "network" : "disk"],
						{
							cwd: root,
							encoding: "utf8",
						},
					),
				),
			);
	const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
	const summary = cases.map(([workload, delayMs]) => {
		const runs = results.filter((r) => r.workload === workload && r.delayMs === delayMs);
		return {
			workload,
			delayMs,
			...runs[0].size,
			firstMs: median(runs.map((r) => r.trials[0].ms)),
			firstMsRange: [Math.min(...runs.map((r) => r.trials[0].ms)), Math.max(...runs.map((r) => r.trials[0].ms))],
			repeatMs: median(runs.map((r) => r.trials[1].ms)),
			firstBytes: runs[0].trials[0].bytes,
			firstReads: runs[0].trials[0].reads,
			peakRssBytes: median(runs.map((r) => r.peakRssBytes)),
		};
	});
	const sources = Object.fromEntries(
		[
			["browser-data.js", "src/lib/browser-engine/browser-data.js"],
			["browser-engine.js", "src/lib/browser-engine/browser-engine.js"],
			["engine/src/lib.rs", "engine/src/lib.rs"],
		].map(([name, path]) => [
			name,
			createHash("sha256")
				.update(readFileSync(`${root}/${path}`))
				.digest("hex"),
		]),
	);
	const report = {
		version: 2,
		node: process.version,
		cpu: cpus()[0]?.model,
		date: new Date().toISOString().slice(0, 10),
		link: network ? LINK : null,
		sources,
		summary,
		results,
	};
	const out = `${JSON.stringify(report, null, 2)}\n`;
	if (output) writeFileSync(output, out);
	else process.stdout.write(out);
	console.table(
		summary.map(({ workload, delayMs, flowColumns, firstMs, firstMsRange, repeatMs, firstBytes }) => ({
			workload,
			delayMs,
			pairs: flowColumns,
			firstMs,
			range: firstMsRange.map(Math.round).join("–"),
			repeatMs,
			MB: firstBytes / 1e6,
		})),
	);
}
