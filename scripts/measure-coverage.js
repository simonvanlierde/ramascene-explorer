// Line coverage of the Svelte files by the browser tests: pnpm measure-coverage
// Reads what `COVERAGE=1 playwright test` recorded in Chromium and maps it back
// through the build's source maps. See docs/publishing.md#svelte-coverage.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { eachMapping, TraceMap } from "@jridgewell/trace-mapping";

const ASSETS = "dist/assets";
const RUNS = "test-results/js-coverage";

// One flag per character of the script: did any test run it? Inside one run the
// innermost range decides, so ranges are applied from the largest down.
const ran = new Map();
for (const file of readdirSync(RUNS)) {
	for (const { url, source, functions } of JSON.parse(readFileSync(join(RUNS, file), "utf8"))) {
		const name = new URL(url).pathname.split("/").pop();
		const once = new Uint8Array(source.length);
		const ranges = functions
			.flatMap((f) => f.ranges)
			.sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
		for (const r of ranges) once.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
		const all = ran.get(name) ?? new Uint8Array(source.length);
		for (let i = 0; i < once.length; i++) all[i] |= once[i];
		ran.set(name, all);
	}
}

// A Svelte line counts when the build made code from it, and is covered when
// any of that code ran. A chunk no test loaded counts with nothing covered.
const lines = new Map();
for (const map of readdirSync(ASSETS).filter((f) => f.endsWith(".js.map"))) {
	const name = map.slice(0, -4);
	const code = readFileSync(join(ASSETS, name), "utf8");
	const starts = [0];
	for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
	const flags = ran.get(name);
	eachMapping(new TraceMap(readFileSync(join(ASSETS, map), "utf8")), (m) => {
		if (!m.source?.endsWith(".svelte")) return;
		const file = relative(".", resolve(ASSETS, m.source));
		const seen = lines.get(file) ?? new Map();
		const hit = flags?.[starts[m.generatedLine - 1] + m.generatedColumn] === 1;
		seen.set(m.originalLine, (seen.get(m.originalLine) ?? false) || hit);
		lines.set(file, seen);
	});
}

let [total, covered] = [0, 0];
const pct = (c, n) => `${((100 * c) / n).toFixed(1)}%`.padStart(6);
for (const [file, seen] of [...lines].sort()) {
	const c = [...seen.values()].filter(Boolean).length;
	[total, covered] = [total + seen.size, covered + c];
	console.log(`${pct(c, seen.size)}  ${String(c).padStart(4)}/${String(seen.size).padEnd(4)}  ${file}`);
}
console.log(`${pct(covered, total)}  ${String(covered).padStart(4)}/${String(total).padEnd(4)}  all Svelte files`);
