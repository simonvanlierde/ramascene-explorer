import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8020";

async function expectNoAxeViolations(page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}

// The custom-scenario form lives in What if…, folded under the run list, and on a
// phone in the selection sheet.
async function openLive(page) {
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	if (await page.locator("#live-run").isVisible()) return;
	await page.getByRole("button", { name: "What if…" }).first().click();
	const dock = page.locator(".dock .filters");
	if (await dock.isVisible()) await dock.click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-run")).toBeVisible();
}

function routeJob(page, done, onPost) {
	return Promise.all([
		page.route(`${API}/catalog`, (route) => route.fulfill({ json: catalog })),
		page.route(`${API}/jobs`, (route) => {
			onPost?.(route.request().postDataJSON());
			return route.fulfill({ json: { id: done.id, status: "queued" } });
		}),
		page.route(`${API}/jobs/${done.id}`, (route) => route.fulfill({ json: done })),
	]);
}

const catalog = {
	products: [{ id: 180, name: "Motor vehicles" }],
	regions: [
		{ id: 1, name: "Europe" },
		{ id: 2, name: "Africa" },
	],
	consumers: [{ id: 198, name: "Manufacture of motor vehicles" }],
	tech_change_percent: { min: -100, max: 1000 },
};

// A succeeded job, shaped as GET /jobs/{id} returns it. GHG in kg CO2 eq:
// Europe drops by 1e10 kg, which the panel shows as 10 Mt CO2-eq.
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
		indicators: [{ id: 5, name: "GHG emissions: Total", unit: "kg CO2 eq" }],
		results: {
			baseline: { 5: { Europe: 1e12, Africa: 5e11 } },
			scenario: { 5: { Europe: 9.9e11, Africa: 5e11 } },
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

test("the live panel runs one intervention and labels the result live", async ({ page }) => {
	let posted = null;
	await page.route(`${API}/catalog`, (route) => route.fulfill({ json: catalog }));
	await page.route(`${API}/jobs`, (route) => {
		posted = route.request().postDataJSON();
		return route.fulfill({ json: { id: job.id, status: "queued" } });
	});
	await page.route(`${API}/jobs/${job.id}`, (route) => route.fulfill({ json: job }));

	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await openLive(page);
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("finished in 60.0 s");
	expect(posted).toEqual({ label: "custom scenario", model_details: job.scenario.model_details });

	await expect(page.locator("#live-label")).toHaveText(
		"Results in this panel are computed live by the job API, not precomputed.",
	);
	await expect(page.locator("#live-headline")).toHaveText(
		"Summed over all regions, greenhouse gases would change by −10.0 Mt CO₂-eq (−0.67%) against the job’s own baseline of 1,500 Mt CO₂-eq.",
	);
	await expect(page.locator("#live-table tbody tr").first()).toContainText("−10.0 Mt CO₂-eq");
	await expect(page.locator("#live-provenance")).toContainText("computed live by the job API, not precomputed");
	await expectNoAxeViolations(page);
});

// The same job with flows in the fixture's layout (3 indicators × 49 producers
// × 15 sections × 49 consumers, row-major, absolute): every country buys only
// from the United States (index 28), and the scenario cuts that by 20%. The
// precomputed fixture draws bands from elsewhere, so one band from the US alone
// shows the map is drawing the job's flows.
function flowsJob() {
	const N = 49;
	const S = 15;
	const cell = (i, c) => (i * N + 28) * S * N + c;
	const baseline = new Array(3 * N * S * N).fill(0);
	const scenario = new Array(3 * N * S * N).fill(0);
	for (let i = 0; i < 3; i++)
		for (let c = 0; c < N; c++) {
			baseline[cell(i, c)] = 1e10;
			scenario[cell(i, c)] = 8e9;
		}
	const indicators = [
		{ id: 5, name: "GHG emissions: Total", unit: "kg CO2 eq" },
		{ id: 3, name: "Employment: Total", unit: "1000 p" },
		{ id: 7, name: "DEU - Metal Ores - Total", unit: "kt" },
	];
	return {
		...job,
		result: {
			...job.result,
			indicators,
			flows: { shape: [3, N, S, N], axes: ["indicator", "producer", "section", "consumer"], baseline, scenario },
		},
	};
}

test("a live job's flows light the map, labelled live", async ({ page }) => {
	const done = flowsJob();
	await page.route(`${API}/catalog`, (route) => route.fulfill({ json: catalog }));
	await page.route(`${API}/jobs`, (route) => route.fulfill({ json: { id: done.id, status: "queued" } }));
	await page.route(`${API}/jobs/${done.id}`, (route) => route.fulfill({ json: done }));

	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await expect(page.locator(".bands path").first()).toBeVisible();
	await expect(page.locator('.bands path:not([data-region="US"])')).not.toHaveCount(0);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await openLive(page);
	await page.locator("#live-run").click();

	await expect(page.locator('.bands path[data-region="US"]')).toHaveCount(1);
	await expect(page.locator(".bands path")).toHaveCount(1);
	await expect(page.locator("#status .basis")).toContainText("computed live by the job API, not precomputed");
	await expect(page.locator("#headline")).toContainText(
		"if Manufacture of motor vehicles in Africa used 20% less motor vehicles from Europe,",
	);
	await page.locator(".sel-chip button").first().click();
	await page.locator("#tab-method").click();
	await expect(page.locator("#tp-method")).toContainText(`${API} · job ${done.id}`);
	await expectNoAxeViolations(page);
});

test("without flows in the job, the map keeps the precomputed run", async ({ page }) => {
	await page.route(`${API}/catalog`, (route) => route.fulfill({ json: catalog }));
	await page.route(`${API}/jobs`, (route) => route.fulfill({ json: { id: job.id, status: "queued" } }));
	await page.route(`${API}/jobs/${job.id}`, (route) => route.fulfill({ json: job }));

	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await openLive(page);
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("finished in 60.0 s");
	await expect(page.locator("#status .basis")).toContainText("precomputed, not a forecast");
	await expect(page.locator('.bands path:not([data-region="US"])')).not.toHaveCount(0);
});

test("Details stays modal while the live panel is on the page", async ({ page }) => {
	await routeJob(page, job);
	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await page.getByRole("button", { name: /^Details for/ }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	for (let i = 0; i < 25; i++) {
		await page.keyboard.press("Tab");
		const where = await page.evaluate(() => ({
			// past the dialog's last control the browser takes focus to the page itself, then back
			inDialog: Boolean(document.activeElement?.closest("[role=dialog]")) || document.activeElement === document.body,
			id: document.activeElement?.id,
		}));
		expect(where.inDialog, `Tab ${i + 1} reached #${where.id}`).toBe(true);
	}
});

test("a live run is never shown as Verified", async ({ page }) => {
	await routeJob(page, flowsJob());
	// the shipped data passes every check, so the page starts Verified
	await page.goto(`?api=${API}`);
	await expect(page.locator("#status .pill.ok")).toHaveCount(1);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await openLive(page);
	await page.locator("#live-run").click();
	await expect(page.locator("#status .basis")).toContainText("computed live by the job API, not precomputed");
	await expect(page.locator("#status .pill.ok")).toHaveCount(0);
	await expect(page.locator("#status .pill.live")).toHaveText("Live job: not checked");
	await page.locator("#status .pill.live").click();
	await expect(page.locator("#tab-method")).toHaveAttribute("aria-selected", "true");
	await expect(page.locator(".pf .vf")).toHaveCount(0);
	await page.keyboard.press("Escape");
	// back to a precomputed run: Verified again
	await page.getByRole("button", { name: "Flows, 2011" }).first().click();
	await expect(page.locator("#status .pill.ok")).toHaveCount(1);
});

test("the change field holds to the job API's range", async ({ page }) => {
	let posted = null;
	await routeJob(page, job, (body) => {
		posted = body;
	});
	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await openLive(page);
	const change = page.locator("#live-change");
	await expect(change).toHaveAttribute("min", "-100");
	await expect(change).toHaveAttribute("max", "1000");
	await change.fill("-500");
	await page.locator("#live-run").click();
	expect(await change.evaluate((el) => el.validity.rangeUnderflow)).toBe(true);
	await page.waitForTimeout(300);
	expect(posted).toBe(null);
	await change.fill("-20");
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("finished in");
	expect(posted?.model_details[0].techChange).toEqual([-20]);
});

test("an unreachable job API says so, and Try again reconnects", async ({ page }) => {
	await page.route(`${API}/catalog`, (route) => route.abort());
	await page.goto(`?data=tests/fixture.json&api=${API}`);
	await openLive(page).catch(() => {});
	await expect(page.locator("#live-state")).toContainText("not reachable");
	await expect(page.locator("#live-run")).toBeDisabled();
	await page.unroute(`${API}/catalog`);
	await page.route(`${API}/catalog`, (route) => route.fulfill({ json: catalog }));
	await page.locator("#live-retry").click();
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${API}.`);
	await expect(page.locator("#live-run")).toBeEnabled();
});
