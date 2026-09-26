import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
	banner,
	compare,
	dataUrl,
	displayIndicator,
	formatValue,
	headline,
	ignoredData,
	niceTicks,
	parseState,
	stateToSearch,
} from "../explorer.js";

// The committed synthetic fixture, shaped like precompute.py output.
const data = JSON.parse(
	readFileSync(new URL("./fixture.json", import.meta.url), "utf8"),
);
const [first, second] = data.scenarios.slice(1).map((s) => s.id);

test("the fixture is marked synthetic", () => {
	assert.equal(data.data_kind, "synthetic");
});

test("a selection survives the URL round trip", () => {
	const state = { scenario: second, indicator: "3" };
	assert.deepEqual(parseState(stateToSearch(state, ""), data), state);
});

test("changing the selection keeps the other query parameters", () => {
	const search = stateToSearch(
		{ scenario: second, indicator: "3" },
		"?data=tests/fixture.json&scenario=x",
	);
	const params = new URLSearchParams(search);
	assert.equal(params.get("data"), "tests/fixture.json");
	assert.equal(params.get("scenario"), second);
});

test("missing or unknown selections fall back to the first intervention and indicator", () => {
	const fallback = { scenario: first, indicator: "5" };
	assert.deepEqual(parseState("", data), fallback);
	assert.deepEqual(parseState("?scenario=nope&indicator=99", data), fallback);
	// baseline against itself is not a comparison
	assert.deepEqual(parseState("?scenario=baseline", data), fallback);
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
		assert.equal(
			dataUrl(`?data=${encodeURIComponent(bad)}`),
			"data/results.json",
			bad,
		);
	}
});

test("a rejected data path is reported, an accepted or absent one is not", () => {
	assert.equal(
		ignoredData("?data=https://evil.example/x.json"),
		"https://evil.example/x.json",
	);
	assert.equal(ignoredData("?data=tests/fixture.json"), null);
	assert.equal(ignoredData(""), null);
});

test("synthetic data gets the red banner", () => {
	assert.deepEqual(banner(data), {
		synthetic: true,
		text: "SYNTHETIC TEST DATA — NOT A RESULT",
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
	for (let i = 1; i < rows.length; i++)
		assert.ok(rows[i - 1].delta <= rows[i].delta);
	const europe = rows.find((r) => r.region === "Europe");
	const base = data.results.baseline["5"].Europe;
	assert.equal(europe.delta, data.results[first]["5"].Europe - base);
	assert.equal(europe.percent, (100 * europe.delta) / base);
	const scaled = compare(data, { scenario: first, indicator: "5" }, 1000);
	assert.equal(
		scaled.find((r) => r.region === "Europe").delta,
		1000 * europe.delta,
	);
	assert.equal(
		scaled.find((r) => r.region === "Europe").percent,
		europe.percent,
	);
});

test("a zero baseline gives no percentage rather than Infinity", () => {
	const d = {
		regions: ["X"],
		results: { baseline: { 1: { X: 0 } }, s: { 1: { X: 2 } } },
	};
	assert.equal(compare(d, { scenario: "s", indicator: "1" })[0].percent, null);
});

test("axis ticks are round, include zero and cover the data", () => {
	for (const [min, max] of [
		[-3.2e9, 0],
		[0, 17],
		[-40, 115],
		[-0.0042, 0.0007],
		[0, 0],
	]) {
		const ticks = niceTicks(min, max);
		assert.ok(ticks.includes(0), `${min},${max}: ${ticks}`);
		assert.ok(
			ticks[0] <= min && ticks.at(-1) >= max,
			`${min},${max}: ${ticks}`,
		);
		assert.ok(
			ticks.length >= 2 && ticks.length <= 7,
			`${min},${max}: ${ticks}`,
		);
		const step = ticks[1] - ticks[0];
		const mantissa = step / 10 ** Math.floor(Math.log10(step));
		assert.ok(
			[1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9),
			`step ${step}`,
		);
	}
	assert.deepEqual(niceTicks(-40, 115), [-50, 0, 50, 100, 150]);
});

test("values never print in exponent notation", () => {
	for (const v of [-3.2e9, 1.5e12, 0.00042, 7, -1234567]) {
		assert.doesNotMatch(formatValue(v), /e/i, String(v));
	}
	assert.equal(formatValue(-3.2e9), "-3.2B");
	assert.equal(formatValue(0), "0");
});

test("employment shows in persons, never as a compact K on thousands of persons", () => {
	const employment = displayIndicator({
		id: 3,
		name: "Employment: Total",
		unit: "1000 p",
	});
	assert.deepEqual(employment, {
		id: 3,
		name: "Employment: Total",
		unit: "persons",
		factor: 1000,
	});
	assert.equal(
		formatValue(-18.8 * employment.factor, employment.unit),
		"-18,800",
	);
	assert.doesNotMatch(formatValue(2.1e9, "persons"), /[KMB]/);
	const ghg = displayIndicator({
		id: 5,
		name: "GHG emissions: Total",
		unit: "kg CO2 eq",
	});
	assert.equal(ghg.factor, 1);
	assert.equal(formatValue(-3.2e9, ghg.unit), "-3.2B");
});

test("the headline carries no colon beyond the one in the indicator name", () => {
	const text = headline(
		displayIndicator({ name: "Employment: Total", unit: "1000 p" }),
		-18800,
		5e6,
	);
	assert.equal(text.split(":").length, 2, text);
	assert.match(text, /-18,800 persons/);
	assert.match(text, /\(-0\.38%\)/);
	assert.match(headline({ name: "X", unit: "kt", factor: 1 }, 5, 0), /\(—\)/);
});

test("a shipped data file is real engine output, never synthetic", () => {
	const shipped = new URL("../data/results.json", import.meta.url);
	if (!existsSync(shipped)) return; // nothing shipped yet
	assert.equal(
		JSON.parse(readFileSync(shipped, "utf8")).data_kind,
		"exiobase-v3",
	);
});
