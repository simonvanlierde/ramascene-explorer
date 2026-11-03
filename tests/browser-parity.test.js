import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { openEngine } from "../src/lib/browser-engine/browser-data.js";
import { scenarioFlows } from "../src/lib/browser-engine/browser-engine.js";
import "./engine-wasm.js";
import { localRange } from "./local-range.js";

const directory = process.env.BROWSER_ENGINE_DATA;
test("all 155 browser scenarios match the shipped engine results at relative 1e-6", {
	skip: !directory && "Set BROWSER_ENGINE_DATA to the exported browser dataset.",
}, async () => {
	assert.ok(existsSync(`${directory}/manifest-v3.json`));
	const meta = JSON.parse(readFileSync(`${directory}/manifest-v3.json`, "utf8"));
	const data = openEngine(meta, localRange(directory, meta));
	await assert.rejects(
		scenarioFlows(data, [
			{
				product: [82],
				originReg: [7],
				consumedBy: [81],
				consumedReg: [7],
				techChange: [632.7954014961612],
			},
		]),
		/singular or ill-conditioned/,
	);
	const reference = JSON.parse(readFileSync(new URL("../data/results.json", import.meta.url), "utf8"));
	const scenarios = reference.scenarios.filter((s) => s.id !== "baseline");
	assert.equal(scenarios.length, 155);
	const baseline = { id: "baseline", model_details: [{ ...scenarios[0].model_details[0], techChange: [0] }] };
	let worst = 0;
	for (const scenario of [baseline, ...scenarios]) {
		const flows = await scenarioFlows(data, scenario.model_details);
		for (let i = 0; i < meta.indicators.length; i++) {
			for (const region of meta.catalog.regions.filter((r) => r.id >= 2 && r.id <= 6)) {
				let got = 0;
				for (const p of region.leaves)
					for (let s = 0; s < meta.sections.length; s++)
						for (let c = 0; c < meta.countries; c++)
							got += flows[((i * meta.countries + p) * meta.sections.length + s) * meta.countries + c];
				const want = reference.results[scenario.id][String(meta.indicators[i])][region.name];
				const error = Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
				worst = Math.max(worst, error);
				assert.ok(error <= 1e-6, `${scenario.id}: ${region.name} ${meta.indicators[i]}: ${got} != ${want}`);
			}
		}
	}
	console.log(`worst relative difference: ${worst.toExponential(2)}`);
	// Measured at 5.5e-9: a precision regression shows here long before the 1e-6 gate.
	assert.ok(worst <= 1e-8, `worst relative difference ${worst} above 1e-8`);
});
