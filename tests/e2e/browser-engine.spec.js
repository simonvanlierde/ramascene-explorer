import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test.js";

test("a browser scenario draws its own flows without a job server", async ({ page, isMobile, baseURL }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest-v2.json"), "Export or download the browser dataset first.");
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
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator("#live-news")).toContainText("Computed in this browser in");
	await expect(page.locator("#status .basis")).toContainText("computed in this browser");
	await expect(page.locator(".bands path").first()).toBeVisible();
	await page.locator("#status .pill.live").click();
	await expect(page.locator(".ph")).toContainText("It does not include this custom result.");
	// the totals by region are in Details, not in the sidebar
	await expect(page.locator(".pan #live-table tbody tr")).toHaveCount(49);
	await expect(page.locator("#side #live-table")).toHaveCount(0);
	await page.keyboard.press("Escape");
	expect(external).toEqual([]);
	expect(matrixBytes).toBeGreaterThan(0);
	expect(matrixBytes).toBeLessThan(50e6);
	expect(page.url()).not.toContain("browser-");
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("browser-engine.png"), fullPage: true });
});

test("Try again replaces a failed browser worker", async ({ page, isMobile }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest-v2.json"), "Export or download the browser dataset first.");
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

test("a negligible custom change stays readable without claiming a hotspot", async ({ page, isMobile }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest-v2.json"), "Export or download the browser dataset first.");
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
	test.skip(!existsSync("data/browser-engine/manifest-v2.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	await page.goto("./");
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	// Manufacturing from every country, used by electricity
	await page.locator("#live-product").selectOption("5");
	await page.locator("#live-consumer").selectOption("5");
	await expect(page.locator("#live-broad")).toContainText("4,165 supply rows (85 products × 49 producing countries)");
	await expect(page.locator("#live-run")).toBeDisabled();
	await page.getByRole("button", { name: "Search produced in" }).click();
	await page.getByRole("searchbox", { name: "Search produced in" }).fill("netherl");
	await expect(page.locator("#live-origin option")).toHaveText(
		["Total", "Europe", "Netherlands"].map((t) => new RegExp(t)),
	);
	await expect(page.locator("#live-origin")).toHaveValue("27");
	await expect(page.locator("#live-broad")).toHaveCount(0);
	await expect(page.locator("#live-run")).toBeEnabled();
	await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
});
