import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compare } from "../explorer.js";
import { apiUrl, ignoredApi, LIVE_STATUS, liveData, liveProvenance, scenarioBody, unreachableMessage, waitForJob } from "../live.js";

// A job as GET /jobs/{id} returns it once succeeded (numbers made up, shape real).
const job = {
	id: "abc123",
	status: "succeeded",
	scenario: {
		label: "custom scenario",
		model_details: [{ product: [180], originReg: [1], consumedBy: [198], consumedReg: [2], techChange: [-20] }],
		reference_check: false,
	},
	started_at: "2026-09-27T01:00:00+00:00",
	finished_at: "2026-09-27T01:01:00+00:00",
	duration_s: 60.04,
	peak_rss_bytes: 1.7 * 2 ** 30,
	result: {
		regions: ["Europe", "Africa"],
		indicators: [{ id: 5, name: "GHG emissions: Total", unit: "kg CO2eq" }],
		results: {
			baseline: { 5: { Europe: 100, Africa: 50 } },
			scenario: { 5: { Europe: 90, Africa: 50 } },
		},
		reference_validation: null,
		provenance: {
			engine: { branch: "feat/engine-package", commit: "7fb5f4c", dirty: false },
			dataset: { name: "EXIOBASE v3.3.sm", doi: "10.5281/zenodo.3533196", year: 2011, file_suffix: "v4" },
			python: "3.14.7",
			numpy: "2.5.3",
			django: "5.2.17",
		},
	},
};

test("no ?api=, no panel", () => {
	assert.equal(apiUrl(""), null);
	assert.equal(apiUrl("?scenario=x"), null);
	assert.equal(ignoredApi(""), null);
});

test("loopback over http and anything over https are accepted, as a bare origin", () => {
	assert.equal(apiUrl("?api=http://127.0.0.1:8020"), "http://127.0.0.1:8020");
	assert.equal(apiUrl("?api=http://localhost:8020/"), "http://localhost:8020");
	assert.equal(apiUrl("?api=https://jobs.example.org"), "https://jobs.example.org");
});

test("anything else is refused and reported", () => {
	for (const bad of [
		"http://jobs.example.org",
		"http://127.0.0.1.evil.example:8020",
		"javascript:alert(1)",
		"data:text/html,x",
		"https://user:pw@jobs.example.org",
		"https://jobs.example.org/prefix",
		"https://jobs.example.org/?x=1",
		"not a url",
		"http://[::1]:8020", // the job API's allowed hosts refuse [::1] with 400

	]) {
		const search = `?api=${encodeURIComponent(bad)}`;
		assert.equal(apiUrl(search), null, bad);
		assert.equal(ignoredApi(search), bad);
	}
});

test("form values become the explorer's model_details format", () => {
	const body = scenarioBody({ product: "180", originReg: "1", consumedBy: "198", consumedReg: "2", techChange: "-20" });
	assert.deepEqual(body, { label: "custom scenario", model_details: job.scenario.model_details });
});

test("a change that is not a finite number never leaves the page", () => {
	const form = { product: "180", originReg: "1", consumedBy: "198", consumedReg: "2" };
	for (const techChange of ["", "abc", "Infinity", "NaN", "1e400"]) {
		assert.throws(() => scenarioBody({ ...form, techChange }), /finite/, techChange);
	}
	assert.throws(() => scenarioBody({ ...form, product: "1.5", techChange: "0" }), /not an id/);
});

test("a live result is compared with its own job's baseline", () => {
	const data = liveData(job);
	assert.equal(data.status, LIVE_STATUS);
	const rows = compare(data, { scenario: "live", indicator: "5" });
	assert.deepEqual(
		rows.map((r) => [r.region, r.baseline, r.scenario, r.delta, r.percent]),
		[
			["Europe", 100, 90, -10, -10],
			["Africa", 50, 50, 0, 0],
		],
	);
});

test("the provenance says live, not precomputed, and carries the job's measurements", () => {
	const rows = Object.fromEntries(liveProvenance(job, "http://127.0.0.1:8020"));
	assert.equal(rows.Status, "computed live by the job API, not precomputed");
	assert.match(rows["Job API"], /127\.0\.0\.1:8020 · job abc123/);
	assert.match(rows.Engine, /feat\/engine-package · 7fb5f4c/);
	assert.match(rows.Computed, /60\.0 s/);
	assert.match(rows.Runtime, /peak RSS 1\.70 GiB/);
	assert.match(rows["Reference check"], /not requested/);
});

test("polling stops at a final status", async () => {
	const seen = [];
	const statuses = ["queued", "running", "succeeded"];
	const fetchJson = async () => ({ id: "j", status: statuses.shift() });
	const final = await waitForJob(fetchJson, "u", { interval: 1, onUpdate: (j) => seen.push(j.status) });
	assert.equal(final.status, "succeeded");
	assert.deepEqual(seen, ["queued", "running", "succeeded"]);
});

test("without ?api= the page is unchanged: panel hidden, panel code loaded only on demand", () => {
	const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
	assert.match(html, /<section id="live" aria-labelledby="live-title" hidden>/);
	assert.match(html, /if \(api\) \(await import\("\.\/live-panel\.js"\)\)\.mount\(api\);/);
	// The panel module is the only place that fetches from the API.
	assert.doesNotMatch(readFileSync(new URL("../live.js", import.meta.url), "utf8"), /fetch\(/);
});

test("unreachableMessage: a network failure reads as offline, an HTTP error keeps its detail", () => {
	const offline = unreachableMessage("http://127.0.0.1:8020", new TypeError("Failed to fetch"));
	assert.match(offline, /^Live job API not reachable \(offline\)/);
	assert.match(offline, /precomputed results above are unaffected/);
	assert.doesNotMatch(offline, /Failed to fetch/);
	const http = unreachableMessage("http://127.0.0.1:8020", new Error("503: Service Unavailable"));
	assert.match(http, /^Job API at http:\/\/127\.0\.0\.1:8020 answered with an error: 503/);
});
