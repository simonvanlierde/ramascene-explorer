import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test.js";

test("a browser scenario draws its own flows without a job server", async ({ page, isMobile, baseURL }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
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
	await page.getByRole("button", { name: "What if…" }).first().click();
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
});

test("Try again replaces a failed browser worker", async ({ page, isMobile }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
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
	await page.getByRole("button", { name: "What if…" }).first().click();
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

test("after a trap stops the worker, the next Run computes in a fresh one", async ({ page, isMobile }) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
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
	await page.getByRole("button", { name: "What if…" }).first().click();
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
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	let attempts = 0;
	await page.route("**/*.wasm", (route) => {
		attempts++;
		if (attempts === 1) return route.fulfill({ status: 503, body: "unavailable" });
		return route.continue();
	});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
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
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
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
	await expect(page.locator(".lg")).not.toContainText("all decreases");
	await expect(page.locator(".lg")).not.toContainText("e−12");
	for (const card of await page.locator(".kpis.k5 .kv").all()) {
		await expect(card).toContainText("0");
		expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	}
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("negligible-change.png"), fullPage: true, animations: "disabled" });
});

test("a selection too broad for the browser says so before Run, and search narrows the lists", async ({
	page,
	isMobile,
}) => {
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await expect(page.locator("#run-list")).toBeVisible();
	await page.locator("#live-open").click();
	// the published runs fold to the chosen one, so the form sits higher
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
		["Total", "Europe", "Netherlands"].map((t) => new RegExp(t)),
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
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	let reads = 0;
	page.on("request", (request) => {
		if (request.url().includes("/browser-engine/store-")) reads++;
	});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
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
	test.skip(!existsSync("data/browser-engine/manifest-v3.json"), "Export or download the browser dataset first.");
	test.setTimeout(60_000);
	// the matrix reads never answer, so the run is still going when Cancel is pressed
	await page.route("**/browser-engine/store-*/**", () => {});
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
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
