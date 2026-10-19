import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { banner, compare, dataUrl, ignoredData, sameRun } from "../explorer.js";

// The committed synthetic fixture, shaped like precompute.py output.
const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const [first] = data.scenarios.slice(1).map((s) => s.id);

test("the fixture is marked synthetic", () => {
	assert.equal(data.data_kind, "synthetic");
});

test("data defaults to the shipped file and accepts only same-site relative JSON paths", () => {
	assert.equal(dataUrl(""), "data/results.json");
	assert.equal(dataUrl("?data=tests/fixture.json"), "tests/fixture.json");
	for (const bad of [
		"https://evil.example/x.json",
		"//evil.example/x.json",
		"/etc/x.json",
		"../x.json",
		"tests/../../x.json",
		"tests/fixture.js",
		"javascript:alert(1)//.json",
	]) {
		assert.equal(dataUrl(`?data=${encodeURIComponent(bad)}`), "data/results.json", bad);
	}
});

test("a rejected data path is reported, an accepted or absent one is not", () => {
	assert.equal(ignoredData("?data=https://evil.example/x.json"), "https://evil.example/x.json");
	assert.equal(ignoredData("?data=tests/fixture.json"), null);
	assert.equal(ignoredData(""), null);
});

test("synthetic data gets the red banner", () => {
	assert.deepEqual(banner(data), {
		synthetic: true,
		text: "SYNTHETIC TEST DATA: NOT A RESULT",
	});
});

test("anything not positively marked as EXIOBASE is treated as synthetic", () => {
	for (const kind of [undefined, "", "exiobase", "real", "EXIOBASE-V3"]) {
		assert.equal(banner({ data_kind: kind }).synthetic, true, String(kind));
	}
	assert.equal(banner({ data_kind: "exiobase-v3" }).synthetic, false);
});

test("compare gives per-region change, largest cut first", () => {
	const rows = compare(data, { scenario: first, indicator: "5" });
	assert.deepEqual(rows.map((r) => r.region).sort(), [...data.regions].sort());
	for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].delta <= rows[i].delta);
	const europe = rows.find((r) => r.region === "Europe");
	const base = data.results.baseline["5"].Europe;
	assert.equal(europe.delta, data.results[first]["5"].Europe - base);
	assert.equal(europe.percent, (100 * europe.delta) / base);
	const scaled = compare(data, { scenario: first, indicator: "5" }, 1000);
	assert.equal(scaled.find((r) => r.region === "Europe").delta, 1000 * europe.delta);
	assert.equal(scaled.find((r) => r.region === "Europe").percent, europe.percent);
});

test("a zero baseline gives no percentage rather than Infinity", () => {
	const d = {
		regions: ["X"],
		results: { baseline: { 1: { X: 0 } }, s: { 1: { X: 2 } } },
	};
	assert.equal(compare(d, { scenario: "s", indicator: "1" })[0].percent, null);
});

test("a shipped data file is real engine output, never synthetic", () => {
	const shipped = new URL("../data/results.json", import.meta.url);
	if (!existsSync(shipped)) return; // nothing shipped yet
	assert.equal(JSON.parse(readFileSync(shipped, "utf8")).data_kind, "exiobase-v3");
});

// --- material-efficiency grid --------------------------------------------------

import { gridScenarioId, lookupGrid, pickerState, runSummary } from "../explorer.js";

test("grid ids are product-region-cut with the cut unsigned", () => {
	assert.equal(gridScenarioId("steel", "europe", -10), "steel-europe-10");
	assert.equal(gridScenarioId("cement", "asia-pacific", 50), "cement-asia-pacific-50");
});

test("a grid scenario sets all three pickers; an original keeps the grid defaults", () => {
	assert.deepEqual(pickerState(data, "steel-africa-20"), {
		scenario: "grid:steel",
		region: "africa",
		cut: "-20",
	});
	assert.deepEqual(pickerState(data, "cement-in-construction"), {
		scenario: "cement-in-construction",
		region: "europe",
		cut: "-10",
	});
});

test("the pickers resolve to a published cell, an excluded one with its reason, or nothing", () => {
	assert.deepEqual(lookupGrid(data, { scenario: "grid:steel", region: "europe", cut: "-50" }), {
		id: "steel-europe-50",
	});
	assert.deepEqual(lookupGrid(data, { scenario: "cement-in-construction", region: "x", cut: "0" }), {
		id: "cement-in-construction",
	});
	const excluded = lookupGrid(data, { scenario: "grid:steel", region: "america", cut: "-50" });
	assert.equal(excluded.id, "steel-america-50");
	assert.match(excluded.failed, /excluded after a failed check/);
	assert.deepEqual(lookupGrid(data, { scenario: "grid:steel", region: "america", cut: "-10" }), {
		id: "steel-america-10",
		missing: true,
	});
});

test("the run summary reads counts, wall and RSS from the provenance", () => {
	assert.equal(runSummary(undefined), "");
	assert.equal(
		runSummary({
			scenarios_run: 78,
			passed: 77,
			failed: 1,
			wall_s: { median: 9.2, max: 10.94 },
			peak_rss_bytes: { median: 1650000000, max: 1660000000 },
		}),
		"78 scenarios run, 77 passed every check, 1 failed (excluded) · wall time per scenario job median 9.2 s, max 10.9 s · peak RSS per worker median 1.54 GiB, max 1.55 GiB",
	);
	assert.equal(
		runSummary({ scenarios_run: 3, passed: 3, failed: 0 }),
		"3 scenarios run, 3 passed every check, 0 failed (excluded)",
	);
});

test("a sidecar is shown only next to the results of its own run", () => {
	const provenance = {
		dataset: { sha256: { A: "a", L: "l" } },
		engine: { commit: "c1" },
		generated_at: "2026-09-27T10:04:04+00:00",
	};
	const results = { data_kind: "exiobase-v3", provenance };
	const doc = (p) => ({ data_kind: "exiobase-v3", provenance: { ...provenance, ...p } });
	assert.equal(sameRun(doc({}), results), true);
	assert.equal(sameRun(null, results), false);
	assert.equal(sameRun({ ...doc({}), data_kind: "synthetic" }, results), false);
	assert.equal(sameRun(doc({ dataset: { sha256: { A: "x", L: "l" } } }), results), false);
	// same dataset, older run: a results.json regenerated without --out-regions/--out-flows
	assert.equal(sameRun(doc({ engine: { commit: "c0" } }), results), false);
	assert.equal(sameRun(doc({ generated_at: "2026-09-26T08:00:00+00:00" }), results), false);
});
