import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { asyncBufferFromFile } from "hyparquet";
import { matrixPath, openEngine, outputFlows } from "../browser-data.js";
import { scenarioOutput } from "../browser-engine.js";

const directory = process.env.BROWSER_ENGINE_DATA;
test("all 153 browser scenarios match the shipped engine results at relative 1e-9", {
	skip: !directory && "Set BROWSER_ENGINE_DATA to the exported browser dataset.",
}, async () => {
	assert.ok(existsSync(`${directory}/manifest-v2.json`));
	const meta = JSON.parse(readFileSync(`${directory}/manifest-v2.json`, "utf8"));
	const data = await openEngine(meta, (name, index) =>
		asyncBufferFromFile(`${directory}/${matrixPath(meta, name, index)}`),
	);
	for (const name of ["X", "Y", "B"]) await assert.rejects(data.row(name, 0), /use X, Y or B directly/);
	await assert.rejects(
		scenarioOutput(data, [
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
	assert.equal(scenarios.length, 153);
	const baseline = { id: "baseline", model_details: [{ ...scenarios[0].model_details[0], techChange: [0] }] };
	for (const scenario of [baseline, ...scenarios]) {
		const X = await scenarioOutput(data, scenario.model_details);
		const flows = outputFlows(data, X);
		for (let i = 0; i < meta.indicators.length; i++) {
			for (const region of meta.catalog.regions.filter((r) => r.id >= 2 && r.id <= 6)) {
				let got = 0;
				for (const p of region.leaves)
					for (let s = 0; s < meta.sections.length; s++)
						for (let c = 0; c < meta.countries; c++)
							got += flows[((i * meta.countries + p) * meta.sections.length + s) * meta.countries + c];
				const want = reference.results[scenario.id][String(meta.indicators[i])][region.name];
				assert.ok(
					Math.abs(got - want) <= 1e-9 * Math.max(Math.abs(want), 1e-12),
					`${scenario.id}: ${region.name} ${meta.indicators[i]}: ${got} != ${want}`,
				);
			}
		}
	}
});
