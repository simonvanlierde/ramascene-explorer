// Diagnostics: node measure-browser-engine.js [output.json] [data-dir]
// Each sample gets a fresh process. Pin the parent to fixed CPUs.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openEngine } from "./browser-data.js";
import { plan, scenarioFlows } from "./browser-engine.js";
import { localRange } from "./tests/local-range.js";

const filename = fileURLToPath(import.meta.url);
const root = dirname(filename);
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

async function sample(workload, delayMs, directory) {
	const manifest = readFileSync(`${directory}/manifest-v3.json`, "utf8");
	const meta = JSON.parse(manifest);
	const local = localRange(directory, meta);
	let bytes = 0;
	let reads = 0;
	const data = openEngine(meta, async (...args) => {
		reads++;
		if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
		const buffer = await local(...args);
		bytes += buffer.byteLength;
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
		size: { rows: rows.length, columns: columns.length, flowColumns: J.length, lByRows: byRows, download },
		datasetManifestSha256: createHash("sha256").update(manifest).digest("hex"),
		trials,
		peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
		load: loadavg(),
	};
}

if (process.argv[2] === "--sample") {
	console.log(JSON.stringify(await sample(process.argv[3], Number(process.argv[4]), process.argv[5])));
} else {
	const directory = process.argv[3] ?? `${root}/data/browser-engine`;
	const results = [];
	const cases = [...Object.keys(steps).map((w) => [w, 0]), ["default", 150]];
	for (const [workload, delayMs] of cases)
		for (let repeat = 0; repeat < 5; repeat++)
			results.push(
				JSON.parse(
					execFileSync(process.execPath, [filename, "--sample", workload, String(delayMs), directory], {
						cwd: root,
						encoding: "utf8",
					}),
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
			repeatMs: median(runs.map((r) => r.trials[1].ms)),
			firstBytes: runs[0].trials[0].bytes,
			firstReads: runs[0].trials[0].reads,
			peakRssBytes: median(runs.map((r) => r.peakRssBytes)),
		};
	});
	const sources = Object.fromEntries(
		["browser-data.js", "browser-engine.js"].map((name) => [
			name,
			createHash("sha256")
				.update(readFileSync(`${root}/${name}`))
				.digest("hex"),
		]),
	);
	const report = {
		version: 2,
		node: process.version,
		cpu: cpus()[0]?.model,
		date: new Date().toISOString().slice(0, 10),
		sources,
		summary,
		results,
	};
	const out = `${JSON.stringify(report, null, 2)}\n`;
	if (process.argv[2]) writeFileSync(process.argv[2], out);
	else process.stdout.write(out);
	console.table(
		summary.map(({ workload, delayMs, firstMs, repeatMs, firstBytes }) => ({
			workload,
			delayMs,
			firstMs,
			repeatMs,
			MB: firstBytes / 1e6,
		})),
	);
}
