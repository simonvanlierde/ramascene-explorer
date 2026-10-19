import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FIXTURE = "?data=tests/fixture.json";

async function expectNoAxeViolations(page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}

const ready = (page) => expect(page.locator(".mapc .rg")).toHaveCount(49);

// On a phone the selection lives in a bottom sheet opened from the dock.
async function openSelection(page) {
	const dock = page.locator(".dock .filters");
	if (await dock.isVisible()) {
		await dock.click();
		await expect(page.locator("#side")).toBeVisible();
	}
}

test("synthetic data renders the map, sentence and method under a banner", async ({ page }) => {
	await page.goto(FIXTURE);
	await expect(page.locator("#banner")).toHaveText("SYNTHETIC TEST DATA: NOT A RESULT");
	await ready(page);
	await expect(page.locator("#headline")).toContainText("Germany");
	await expect(page.locator(".bands path").first()).toBeVisible();
	await expectNoAxeViolations(page);
	await expect(page.getByRole("button", { name: /^Verified/ })).toHaveCount(0);
	await page.getByRole("button", { name: "Not verified: test data" }).click();
	await expect(page.locator("#tab-method")).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#provenance dt").first()).toHaveText("data_kind", { useInner: true });
});

test("What if… loads a run, keeps it in the URL and survives a reload", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	await page.getByRole("button", { name: "What if…" }).click();
	await openSelection(page);
	await page.getByRole("radio", { name: /builders everywhere/i }).click();
	await expect(page).toHaveURL(/mode=whatif/);
	await expect(page).toHaveURL(/scenario=cement-in-construction/);
	await expect(page.locator("#headline")).toContainText("builders everywhere used 20% less cement");
	await expect(page.locator(".kpis.k5 .kpi")).toHaveCount(5);
	await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "100");
	await expectNoAxeViolations(page);
	// the run list folds to the chosen run, and stays folded after a reload
	await expect(page.locator(".run.chosen")).toContainText("Builders everywhere used 20% less cement");
	await page.reload();
	await openSelection(page);
	await expect(page.locator(".run.chosen")).toContainText("Builders everywhere used 20% less cement");
	await page.getByRole("button", { name: "Change the intervention" }).click();
	await expect(page.getByRole("radio", { name: /builders everywhere/i })).toHaveAttribute("aria-checked", "true");
});

test("the industry rail, country box and direction drive the sentence and the URL", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	await openSelection(page);
	const rail = page.getByRole("group", { name: "Industry sections" });
	await rail.getByRole("button", { name: /^Manufacturing/ }).click();
	await expect(page.locator("#headline")).toContainText("through manufacturing");
	await expect(page).toHaveURL(/sections=3(&|$)/);
	// the rail is one Tab stop; arrows move inside it
	await page.keyboard.press("ArrowDown");
	await expect(rail.getByRole("button", { name: /^Electricity/ })).toBeFocused();
	const box = page.getByRole("combobox", { name: "Country" });
	await box.fill("Fra");
	await box.press("Enter");
	await expect(page).toHaveURL(/region=FR/);
	await expect(page.locator("#headline")).toContainText("France");
	await page.getByRole("button", { name: "Its production" }).click();
	await expect(page).toHaveURL(/dir=out/);
	await expect(page.locator("#headline")).toContainText("France released");
});

test("Details opens the Sankey and the table, and Escape closes it", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	await page.getByRole("button", { name: /^Details for/ }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator(".sk .lk").first()).toBeVisible();
	// the panel is modal: Tab cycles inside it, never onto what it covers
	for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
	expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
	await page.locator("#tab-table").click();
	await expect(page.locator("#flows-table tbody tr").first()).toBeVisible();
	await expect(page).toHaveURL(/panel=table/);
	await expectNoAxeViolations(page);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	// focus comes back to the control that opened it, not to the page top
	await expect(page.getByRole("button", { name: /^Details for/ })).toBeFocused();
});

test("the shipped results render without the synthetic banner", async ({ page }) => {
	await page.goto("");
	await ready(page);
	await expect(page.locator("#banner")).toBeHidden();
	await expect(page.locator("#headline")).toContainText("Germany’s consumption caused");
	await expect(page.locator(".pill.ok")).toHaveCount(1); // hidden, not removed, on a phone
	await expect(page.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
		"href",
		"https://github.com/simonvanlierde/ramascene-explorer",
	);
	await expect(page.locator(".brand .by")).toHaveText("by Simon van Lierde");
	await expectNoAxeViolations(page);
});

test("the globe draws Germany's bands from Britain and Italy, not from its close neighbours", async ({ page }) => {
	await page.goto("?map=globe");
	await ready(page);
	for (const code of ["GB", "IT"]) await expect(page.locator(`.bands path[data-region="${code}"]`)).toHaveCount(1);
	for (const code of ["NL", "BE", "AT"])
		await expect(page.locator(`.bands path[data-region="${code}"]`)).toHaveCount(0);
});

test("zooming the flat map in on Germany makes room for the band from Italy", async ({ page }) => {
	await page.goto("");
	await ready(page);
	const band = (code) => page.locator(`.bands path[data-region="${code}"]`);
	await expect(band("IT")).toHaveCount(0);
	for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
	for (const code of ["GB", "IT"]) await expect(band(code)).toHaveCount(1);
	// the buttons zoom toward the selection, so it stays on the map
	const box = await page.locator("svg.map").boundingBox();
	const cx = Number(await page.locator("circle.ring").getAttribute("cx"));
	const cy = Number(await page.locator("circle.ring").getAttribute("cy"));
	expect(cx > 0 && cx < box.width && cy > 0 && cy < box.height).toBe(true);
	await expectNoAxeViolations(page);
	for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom out" }).click();
	await expect(band("IT")).toHaveCount(0);
});

test("the scroll wheel zooms the map about the pointer", async ({ page, isMobile }) => {
	test.skip(isMobile, "phones pinch; Playwright has no pinch gesture");
	await page.goto("");
	await ready(page);
	const box = await page.locator("svg.map").boundingBox();
	const ring = page.locator("circle.ring");
	const [cx, cy] = [Number(await ring.getAttribute("cx")), Number(await ring.getAttribute("cy"))];
	await page.mouse.move(box.x + cx, box.y + cy);
	await page.mouse.wheel(0, -600);
	await expect(page.locator('.bands path[data-region="IT"]')).toHaveCount(1);
	// the point under the pointer stays put, to the pixel rounding of the mouse
	expect(Math.abs(Number(await ring.getAttribute("cx")) - cx)).toBeLessThan(5);
});

test("a refused data path falls back to the default and says so", async ({ page }) => {
	await page.goto("?data=../secret.json");
	await expect(page.locator("#status .fail")).toHaveText("ignored data=../secret.json");
	await expect(page.locator("#banner")).toBeHidden();
});

test("a phone puts the content first and the selection in a sheet", async ({ page, isMobile }) => {
	test.skip(!isMobile, "phone layout only");
	await page.goto(FIXTURE);
	await ready(page);
	await expect(page.locator("#side")).toBeHidden();
	await page.locator(".dock .filters").click();
	await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
	await expectNoAxeViolations(page);
	await page.keyboard.press("Escape");
	await expect(page.locator("#side")).toBeHidden();
	await expect(page.locator(".dock .filters")).toBeFocused();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
	expect(overflow).toBe(0);
});

test("the honesty notes stay on screen: precomputed, not a forecast, and 'would have'", async ({ page }) => {
	await page.goto(`${FIXTURE}&mode=whatif&scenario=cement-in-construction`);
	await ready(page);
	await expect(page.locator(".pill.basis")).toContainText("precomputed, not a forecast");
	await expect(page.locator("#headline")).toContainText("In the 2011 economy, if");
	await expect(page.locator("#headline")).toContainText("would have");
});

test("with reduced motion the replay jumps to the run", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(`${FIXTURE}&mode=whatif&scenario=cement-in-construction`);
	await ready(page);
	// the animated replay takes 1.6 s; reduced motion is at the run at once
	await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "100", { timeout: 400 });
});

// The two failure tests use the shipped data: the preview serves it with Range
// support, as GitHub Pages does, so each run is its own request to fail.
test("a run that fails to load says so, and picking it again works", async ({ page }) => {
	await page.goto("");
	await ready(page);
	await page.route("**/*.parquet", (route) => route.abort());
	await page.getByRole("button", { name: "What if…" }).click();
	await openSelection(page);
	await page.getByRole("radio", { name: /builders everywhere/i }).click();
	await expect(page.getByText("That run could not be loaded").first()).toBeVisible();
	await expect(page.getByText("Loading the run’s flows…")).toHaveCount(0);
	await page.unroute("**/*.parquet");
	await page.getByRole("button", { name: "Change the intervention" }).click();
	await page.getByRole("radio", { name: /builders everywhere/i }).click();
	await expect(page.locator("#headline")).toContainText("builders everywhere used 20% less cement");
});

test("a page whose 2011 flows fail to load says so instead of loading for ever", async ({ page }) => {
	let gets = 0;
	// the footer read succeeds, the baseline row group fails
	await page.route("**/*.parquet", (route) =>
		route.request().method() === "GET" && ++gets > 1 ? route.abort() : route.continue(),
	);
	await page.goto("");
	await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toBeVisible();
});

test("a run with a failed check is not shown as Verified", async ({ page }) => {
	await page.route("**/data/results.json", async (route) => {
		const response = await route.fetch();
		const doc = await response.json();
		doc.checks.published_passed_every_check = false;
		await route.fulfill({ response, json: doc });
	});
	await page.goto("");
	await ready(page);
	await expect(page.locator(".pill.ok")).toHaveCount(0);
	await expect(page.locator(".pill.unverified")).toHaveCount(1);
});

test("the rail adds, removes and resets sections", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	await openSelection(page);
	const rail = page.getByRole("group", { name: "Industry sections" });
	await rail.getByRole("button", { name: /^Manufacturing/ }).click();
	await rail.getByRole("button", { name: /^Electricity/ }).click();
	await expect(page).toHaveURL(/sections=3,4(&|$)/);
	await expect(page.locator("#headline")).toContainText("through 2 of 15 industry sections");
	await rail.getByRole("button", { name: /^Manufacturing/ }).click();
	await rail.getByRole("button", { name: /^Electricity/ }).click();
	await expect(page).not.toHaveURL(/sections=/);
	await expect(page.locator("#headline")).toContainText("across all 15 industry sections");
});

test("the page fetches nothing but its own files", async ({ page, baseURL }) => {
	const elsewhere = [];
	page.on("request", (r) => {
		if (!r.url().startsWith(baseURL) && !r.url().startsWith("data:")) elsewhere.push(r.url());
	});
	await page.goto(`${FIXTURE}&mode=whatif&scenario=steel-europe-10`);
	await ready(page);
	await expect(page.locator(".kpis.k5 .kpi")).toHaveCount(5);
	expect(elsewhere).toEqual([]);
});

// The shipped data again: each run is its own range request, so A can be slow.
test("a fast run switch ends on the second run, and the slow first one never replaces it", async ({ page }) => {
	await page.goto("");
	await ready(page);
	await page.getByRole("button", { name: "What if…" }).click();
	await openSelection(page);
	await expect(page.getByRole("radio", { name: /Europe bought 20% fewer/i })).toHaveAttribute("aria-checked", "true");
	await expect(page.locator("#headline")).toContainText("would have");
	// every request made between the two clicks is A's: hold them until B is shown
	let hold = false;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let held = 0;
	let aStarted;
	const started = new Promise((resolve) => {
		aStarted = resolve;
	});
	await page.route("**/*.parquet", async (route) => {
		if (!hold) return route.continue();
		held++;
		aStarted();
		await gate;
		await route.continue();
	});
	hold = true;
	await page.getByRole("radio", { name: /European car makers/i }).click();
	await started;
	hold = false;
	// picking a run folds the list: open it again for the second pick
	await page.getByRole("button", { name: "Change the intervention" }).click();
	await page.getByRole("radio", { name: /builders everywhere/i }).click();
	const headline = page.locator("#headline");
	await expect(headline).toContainText("builders everywhere used 20% less cement");
	expect(held).toBeGreaterThan(0);
	// let A's request finish and the page settle: B must stay
	release();
	await page.waitForTimeout(800);
	await expect(headline).toContainText("builders everywhere used 20% less cement");
	await expect(headline).not.toContainText("European car makers");
	await expect(page.locator(".run.chosen")).toContainText("Builders everywhere used 20% less cement");
});

test("on a phone the touch targets are 44 px, the rail tabs 36 px and 44 px apart", async ({ page, isMobile }) => {
	test.skip(!isMobile, "phone layout only");
	await page.goto(`${FIXTURE}&mode=whatif&scenario=cement-in-construction`);
	await ready(page);
	const heights = async (selector) => {
		const boxes = await page.locator(`${selector}:visible`).evaluateAll((els) =>
			els.map((e) => {
				const r = e.getBoundingClientRect();
				return { name: (e.textContent ?? "").trim().slice(0, 30), h: r.height, cy: r.top + r.height / 2 };
			}),
		);
		expect(boxes.length, selector).toBeGreaterThan(0);
		return boxes;
	};
	const tall = async (selector) => {
		for (const b of await heights(selector)) expect(b.h, `${selector}: ${b.name}`).toBeGreaterThanOrEqual(44);
	};
	for (const s of [".dock .seg button", ".dock .filters", ".sel-chip button", ".mtr .seg button"]) await tall(s);
	await page.locator(".dock .filters").click();
	await expect(page.locator("#side")).toBeVisible();
	const rail = await heights("#side .rail .t");
	for (const [i, b] of rail.entries()) {
		expect(b.h, `rail tab ${b.name}`).toBeGreaterThanOrEqual(36);
		if (i > 0) expect(b.cy - rail[i - 1].cy, `centres ${rail[i - 1].name} / ${b.name}`).toBeGreaterThanOrEqual(44);
	}
	for (const s of ["#side .rail .all", "#side .seg button", "#side .run"]) await tall(s);
});

test("axe: the country popover, the globe and the Sankey and Method tabs", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	await page.getByRole("button", { name: /^Country:/ }).click();
	await expect(page.getByRole("group", { name: "Choose a country" })).toBeVisible();
	await expectNoAxeViolations(page);
	await page.keyboard.press("Escape");
	await page.goto(`${FIXTURE}&map=globe`);
	await ready(page);
	await expect(page.getByRole("button", { name: "Globe" })).toHaveAttribute("aria-pressed", "true");
	await expectNoAxeViolations(page);
	await page.getByRole("button", { name: /^Details for/ }).click();
	await expect(page.locator("#tab-sankey")).toHaveAttribute("aria-selected", "true");
	await expectNoAxeViolations(page);
	await page.locator("#tab-method").click();
	await expect(page.locator("#tab-method")).toHaveAttribute("aria-selected", "true");
	await expectNoAxeViolations(page);
});
