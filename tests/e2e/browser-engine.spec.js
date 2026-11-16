import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoAxeViolations, test } from "./test.js";

// CI downloads the dataset, so there a missing one fails the test rather than skipping it
const needData = () => {
	const here = existsSync("data/browser-engine/manifest-v3.json");
	test.skip(!here && !process.env.CI, "Export or download the browser dataset first.");
	expect(here, "data/browser-engine is missing; fetch the browser store, see docs/browser-engine.md").toBe(true);
};

test("a browser scenario draws its own flows without a job server", async ({ page, isMobile, baseURL }, info) => {
	needData();
	test.setTimeout(90_000);
	const external = [];
	const site = new URL(baseURL).origin;
	let matrixBytes = 0;
	page.on("request", (request) => {
		if (!request.url().startsWith(`${site}/`)) external.push(request.url());
	});
	page.on("response", (response) => {
		if (response.url().includes("/browser-engine/")) matrixBytes += Number(response.headers()["content-length"] ?? 0);
	});
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	// the browser data loads when the form first opens, not with the page
	expect(matrixBytes).toBe(0);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await expect(page.locator("#live-news")).toHaveText("Ready to compute in this browser.");
	// links to other sites stay in the tab until a custom run would be lost by leaving
	await expect(page.locator(".brand .by a")).not.toHaveAttribute("target");
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator("#live-news")).toContainText("Computed in this browser in");
	await expect(page.locator("#status .basis")).toContainText("computed in this browser");
	// one name for a custom run: the card, the header pills and the sidebar count
	await expect(page.locator("#live .live-card")).toContainText("Computed in this browser");
	await expect(page.locator("#status .pill.live")).toHaveText("Custom run: not checked");
	await expect(page.locator("#status")).not.toContainText("Browser method");
	await expect(page.locator("#side .lab.sub small")).toHaveText("Custom scenario shown");
	await expect(page.locator(".bands path").first()).toBeVisible();
	await page.locator("#status .pill.live").click();
	await expect(page.locator(".ph")).toContainText("It does not include this custom result.");
	// the totals by region are in Details, not in the sidebar
	await expect(page.locator(".pan #live-table tbody tr")).toHaveCount(49);
	await expect(page.locator(".brand .by a")).toHaveAccessibleName("Simon van Lierde (opens in new tab)");
	await expect(page.locator("#side .live-totals")).toHaveCount(0);
	await page.keyboard.press("Escape");
	// the basis popover names this run's source, and its link leaves in a new tab
	await page.locator("#status .pill.basis").click();
	const pop = page.locator("#basis-pop");
	await expect(pop).toContainText("This run: computed in this browser");
	await expect(pop).toContainText("Float64 Woodbury");
	const source = pop.getByRole("link");
	await expect(source).toHaveAttribute("target", "_blank");
	await expect(source).toHaveAttribute("rel", "noopener");
	await expect(source).toContainText("(opens in new tab)");
	await page.keyboard.press("Escape");
	expect(external).toEqual([]);
	expect(matrixBytes).toBeGreaterThan(0);
	expect(matrixBytes).toBeLessThan(50e6);
	expect(page.url()).not.toContain("browser-");
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("browser-engine.png"), fullPage: true });
	// the caveat stays whole, "not forecasts" included, at the narrowest width
	const size = page.viewportSize();
	await page.setViewportSize({ width: 320, height: size.height });
	await expect(page.locator(".pill.basis .cav")).toHaveText("computed in this browser · not forecasts");
	const cut = await page.locator(".pill.basis").evaluate((pill) => {
		const cav = pill.querySelector(".cav").getBoundingClientRect();
		const box = pill.getBoundingClientRect();
		return pill.scrollWidth > pill.clientWidth || cav.right > box.right || box.right > innerWidth;
	});
	expect(cut, "320 px").toBe(false);
	await page.setViewportSize(size);
	// one step back to the last published scenario, also with the list open
	if (isMobile) await page.locator(".dock .filters").click();
	await page.getByRole("button", { name: "Change the scenario" }).click();
	await expect(page.locator("#run-list")).toBeVisible();
	await page.getByRole("button", { name: "Back to published scenarios" }).click();
	// the status lines no longer describe a result that is not on the map
	await expect(page.locator("#live-state")).toHaveText(
		"Back on the published scenario. Run again to see the custom result.",
	);
	await expect(page.locator("#live-news")).toHaveText(
		"Back on the published scenario. Run again to see the custom result.",
	);
	await expect(page.locator("#status .pill.live")).toHaveCount(0);
	await expect(page.locator("#side .lab.sub small")).toHaveText(/^\d+ published scenarios$/);
	await expect(page.getByRole("button", { name: "Back to published scenarios" })).toHaveCount(0);
});

test("two levers run as one scenario, and Remove hands focus to a sensible field", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	// the overlap hint is for two or more changes
	await expect(page.locator("#live-overlap")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Remove change/ })).toHaveCount(0);
	// a second lever copies the first, takes focus, and may overlap it
	await page.getByRole("button", { name: "Add a change" }).click();
	await expect(page.locator("#live-product-2")).toBeFocused();
	await expect(page.locator("#live-product-2")).toHaveValue("180");
	await expect(page.locator("#live-change-2")).toHaveValue("-20");
	await expect(page.locator("#live-overlap")).toContainText("same input or spending multiply");
	// the sheet's sticky header must not cover the previous change's buttons
	await expectNoAxeViolations(page);
	await page.locator("#live-change-2").fill("-30");
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator("#headline")).toContainText("20% less");
	await expect(page.locator("#headline")).toContainText("and");
	await expect(page.locator("#headline")).toContainText("30% less");
	// a finished run closes the phone's selection sheet
	if (isMobile) await page.locator(".dock .filters").click();
	// Remove returns focus to the lever before it, and hides itself when one is left
	await page.getByRole("button", { name: "Remove change 2" }).click();
	await expect(page.locator("#live-product")).toBeFocused();
	await expect(page.locator("#live-product-2")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Remove change/ })).toHaveCount(0);
	await expect(page.locator("#live-news")).toHaveText("Change 2 removed.");
	// the planner's cap of 10
	for (let i = 1; i < 10; i++) await page.locator("#live-add").click();
	await expect(page.locator("#live-add")).toBeDisabled();
	await expect(page.locator("#live-product-10")).toBeVisible();
	await page.getByRole("button", { name: "Remove change 1", exact: true }).click();
	await expect(page.locator("#live-product")).toBeFocused();
	await expect(page.locator("#live-add")).toBeEnabled();
	// past two changes the headline counts them, and Details lists each
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator("#headline")).toContainText("9 changes were made together");
	await expect(page.locator("#headline")).not.toContainText("20% less");
	await expect(page.locator(".fs")).toContainText("If 9 changes were made together");
	await page.locator(".sel-chip button").first().click();
	await page.locator("#tab-method").click();
	await expect(page.locator("#live-run-provenance")).toContainText("required 20% less");
});

test("Try again replaces a failed browser worker", async ({ page, isMobile }, info) => {
	needData();
	test.setTimeout(30_000);
	let attempts = 0;
	await page.route("**/assets/browser-worker-*.js", (route) => {
		attempts++;
		if (attempts === 1)
			return route.fulfill({ contentType: "text/javascript", body: 'throw new Error("startup failure")' });
		return route.continue();
	});
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toContainText("Browser data could not load");
	await expect(page.locator(".sr-only[role=alert]")).toContainText("Browser data could not load");
	await page.locator("#live-retry").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 10_000 });
	expect(attempts).toBe(2);
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("browser-form.png"), fullPage: true });
});

test("a worker file gone after a deploy asks for a reload, not Try again", async ({ page, isMobile }) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	await page.route("**/assets/browser-worker-*.js", (route) => route.fulfill({ status: 404, body: "" }));
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toContainText("The browser worker could not load. Reload the page");
	await expect(page.locator("#live-retry")).toHaveCount(0);
	await expect(page.locator("#live-run")).toBeDisabled();
});

test("the browser client's file gone after a deploy asks for a reload, not Try again", async ({ page, isMobile }) => {
	await page.route("**/assets/browser-client-*.js", (route) => route.fulfill({ status: 404, body: "" }));
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toContainText("could not load. Reload the page");
	await expect(page.locator("#live-retry")).toHaveCount(0);
	await expect(page.locator("#live-run")).toBeDisabled();
});

test("the custom form's own file gone after a deploy asks for a reload", async ({ page, isMobile }) => {
	await page.route("**/assets/LivePanel-*.js", (route) => route.fulfill({ status: 404, body: "" }));
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await expect(page.getByRole("alert").filter({ hasText: "The custom scenario form could not load" })).toContainText(
		"Reload the page",
	);
});

test("a worker file gone when a fresh worker starts turns Run off", async ({ page, isMobile }) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(60_000);
	// the first worker loads; the one Cancel starts finds its file gone, as after a deploy
	let workers = 0;
	await page.route("**/assets/browser-worker-*.js", (route) =>
		++workers === 1 ? route.continue() : route.fulfill({ status: 404, body: "" }),
	);
	// the matrix reads never answer, so the run is still going when Cancel is pressed
	await page.route("**/browser-engine/store-*/**", () => {});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await page.locator("#live-run").click();
	await expect(page.locator("#live-run")).toHaveText("Running…");
	await page.locator("#live-cancel").click();
	await expect(page.locator("#live-state")).toContainText("The browser worker could not load. Reload the page");
	await expect(page.locator("#live-run")).toBeDisabled();
	await expect(page.locator("#live-retry")).toHaveCount(0);
});

test("after a trap stops the worker, the next Run computes in a fresh one", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	// the first worker answers Run as a trap does; the catalogue and read-ahead stay real
	let attempts = 0;
	await page.route("**/assets/browser-worker-*.js", async (route) => {
		attempts++;
		if (attempts > 1) return route.continue();
		const real = await (await route.fetch()).text();
		return route.fulfill({
			contentType: "text/javascript",
			body: `${real}
const real = self.onmessage;
self.onmessage = (e) =>
	e.data.body ? self.postMessage({ id: e.data.id, fatal: true, error: "the calculation stopped in this browser" }) : real(e);`,
		});
	});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toHaveText("Scenario failed: the calculation stopped in this browser");
	// the fresh worker starts quietly: the failure stays on screen until the next Run
	await expect.poll(() => attempts).toBe(2);
	await expect(page.locator("#live-state")).toHaveText("Scenario failed: the calculation stopped in this browser");
	await expect(page.locator("#live-run")).toBeEnabled();
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	expect(attempts).toBe(2);
});

test("a failed kernel download leaves the form usable and Run loads it again", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	let attempts = 0;
	await page.route("**/*.wasm", (route) => {
		attempts++;
		if (attempts === 1) return route.fulfill({ status: 503, body: "unavailable" });
		return route.continue();
	});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	let reads = 0;
	page.on("request", (request) => {
		if (request.url().includes("/browser-engine/store-")) reads++;
	});
	// the catalogue needs no kernel
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	// the prefetch decodes with the kernel, so it loads the kernel first
	await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(0);
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	expect(attempts).toBe(2);
});

test("a negligible custom change stays readable without claiming a hotspot", async ({ page, isMobile }, info) => {
	needData();
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await page.locator("#live-product").selectOption("181");
	await page.locator("#live-origin").selectOption("13");
	await page.locator("#live-consumer").selectOption("204");
	await page.locator("#live-consumed-reg").selectOption("4");
	await page.locator("#live-change").fill("-55");
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator(".dock .filters")).toHaveAttribute("aria-expanded", "false");
	if (isMobile) await expect(page.locator("#side")).not.toBeVisible();
	await expect(page.locator("#headline")).toContainText("No change at the displayed precision.");
	await expect(page.locator("#headline")).not.toContainText("largest change");
	await expect(page.locator("#headline")).not.toContainText("−0");
	// nothing changed, so no cell or label is heavier
	await expect(page.locator(".kpi.lead")).toHaveCount(0);
	await expect(page.locator(".lbls text.lead")).toHaveCount(0);
	await expect(page.locator(".lg")).not.toContainText("all decreases");
	await expect(page.locator(".lg")).not.toContainText("e−12");
	for (const card of await page.locator(".kpis.k5 .kv").all()) {
		await expect(card).toContainText("0");
		expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	}
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("negligible-change.png"), fullPage: true, animations: "disabled" });
});

test("World after a custom run splits the run's change over the five regions", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	if (isMobile) await expect(page.locator("#side")).not.toBeVisible();
	await page
		.locator("#headline")
		.getByRole("button", { name: /^Country:/ })
		.click();
	await page.locator(".pop.country").getByRole("button", { name: "World", exact: true }).click();
	await expect(page.locator("#headline")).toContainText(/The world’s consumption would have been/);
	await expect(page.locator("#status .pill.live")).toBeVisible();
	await expect(page.locator(".kpis.k5 .kpi")).toHaveCount(5);
	await expect(page.locator(".wstrip .world")).toHaveCount(0);
});

test("a selection too broad for the browser says so before Run, and search narrows the lists", async ({
	page,
	isMobile,
}) => {
	needData();
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	// What if… opens folded to the chosen run; opening the form folds an open list again
	await page.getByRole("button", { name: "Change the scenario" }).click();
	await expect(page.locator("#run-list")).toBeVisible();
	await page.locator("#live-open").click();
	await expect(page.locator("#run-list")).toHaveCount(0);
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	// the preselected steel scenario reads about 2 MB, too little to mention
	await expect(page.locator("#live-download")).toHaveCount(0);
	// every product from every country, used by electricity
	await page.locator("#live-product").selectOption("1");
	await page.locator("#live-consumer").selectOption("5");
	await expect(page.locator("#live-broad")).toContainText(
		"9,800 product–country pairs (200 products × 49 producing countries)",
	);
	await expect(page.locator("#live-run")).toBeDisabled();
	await expect(page.locator("#live-broad")).toHaveAttribute("role", "status");
	// the check plans the form's own change: 0% changes nothing, so it fits
	await page.locator("#live-change").fill("0");
	await expect(page.locator("#live-broad")).toBeEmpty();
	await expect(page.locator("#live-run")).toBeEnabled();
	await page.locator("#live-change").fill("-20");
	await expect(page.locator("#live-broad")).not.toBeEmpty();
	await page.getByRole("button", { name: "Search produced in" }).click();
	await page.getByRole("searchbox", { name: "Search produced in" }).fill("netherl");
	await expect(page.locator("#live-origin option")).toHaveText(
		["World", "Europe", "Netherlands"].map((t) => new RegExp(t)),
	);
	await expect(page.locator("#live-origin")).toHaveValue("27");
	await expect(page.locator("#live-broad")).toBeEmpty();
	await expect(page.locator("#live-run")).toBeEnabled();
	// every product from the Netherlands is about 10 MB: the form says so, and Run points to it
	await expect(page.locator("#live-download")).toHaveText("This selection downloads about 10.5 MB of data.");
	await expect(page.locator("#live-run")).toHaveAttribute("aria-describedby", "live-download");
	await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
	// a parent picked from the narrowed list stays picked
	const europe = await page.locator("#live-origin option", { hasText: "Europe" }).getAttribute("value");
	await page.locator("#live-origin").selectOption(europe);
	await expect(page.locator("#live-origin")).toHaveValue(europe);
});

test("the open form reads its selection before Run, so Run downloads nothing more", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	let reads = 0;
	page.on("request", (request) => {
		if (request.url().includes("/browser-engine/store-")) reads++;
	});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	// wait for the prefetch to start, then to go quiet
	await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(0);
	let last = -1;
	await expect
		.poll(
			() => {
				const quiet = reads === last;
				last = reads;
				return quiet;
			},
			{ intervals: [1000], timeout: 30_000 },
		)
		.toBe(true);
	const before = reads;
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	expect(reads).toBe(before);
});

test("Cancel stops a running browser scenario and leaves the form ready", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(60_000);
	// the matrix reads never answer, so the run is still going when Cancel is pressed
	await page.route("**/browser-engine/store-*/**", () => {});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await page.locator("#live-run").click();
	await expect(page.locator("#live-run")).toHaveText("Running…");
	await expect(page.locator(".live-elapsed")).toContainText(/[1-9]\.\d s/, { timeout: 5_000 });
	await page.locator("#live-cancel").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 30_000 });
	await expect(page.locator("#live-run")).toHaveText("Run scenario");
	await expect(page.locator("#live-cancel")).toHaveCount(0);
	await expect(page.locator("#live-state")).not.toHaveClass(/bad/);
});
