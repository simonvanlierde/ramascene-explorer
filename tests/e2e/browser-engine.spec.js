import { existsSync } from "node:fs";
import { expect, test } from "./test.js";

test("a browser scenario draws its own flows without a job server", async ({ page, isMobile }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest.json"), "Export or download the browser dataset first.");
	test.setTimeout(90_000);
	const external = [];
	let matrixBytes = 0;
	page.on("request", (request) => {
		if (!request.url().startsWith("http://127.0.0.1:4180/")) external.push(request.url());
	});
	page.on("response", (response) => {
		if (response.url().includes("/browser-engine/")) matrixBytes += Number(response.headers()["content-length"] ?? 0);
	});
	await page.goto("?compute=1");
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await expect(page.locator("#live-news")).toHaveText("Ready to compute in this browser.");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
	await expect(page.locator("#live-news")).toContainText("Computed in this browser in");
	await expect(page.locator("#status .basis")).toContainText("computed in this browser");
	await expect(page.locator(".bands path").first()).toBeVisible();
	await page.locator("#status .pill.live").click();
	await expect(page.locator(".ph")).toContainText("It does not include this custom result.");
	await page.keyboard.press("Escape");
	expect(external).toEqual([]);
	expect(matrixBytes).toBeGreaterThan(0);
	expect(matrixBytes).toBeLessThan(50e6);
	expect(page.url()).toContain("compute=1");
	expect(page.url()).not.toContain("browser-");
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("browser-engine.png"), fullPage: true });
});

test("Try again replaces a failed browser worker", async ({ page, isMobile }, info) => {
	test.skip(!existsSync("data/browser-engine/manifest.json"), "Export or download the browser dataset first.");
	test.setTimeout(30_000);
	let attempts = 0;
	await page.route("**/assets/browser-worker-*.js", (route) => {
		attempts++;
		if (attempts === 1)
			return route.fulfill({ contentType: "text/javascript", body: 'throw new Error("startup failure")' });
		return route.continue();
	});
	await page.goto("?compute=1");
	await expect(page.locator("#live-state")).toContainText("Browser data could not load");
	await expect(page.locator(".sr-only[role=alert]")).toContainText("Browser data could not load");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#live-retry").click();
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 10_000 });
	expect(attempts).toBe(2);
	await page.locator("#live-open").click();
	if (["light", "phone"].includes(info.project.name))
		await page.screenshot({ path: info.outputPath("browser-form.png"), fullPage: true });
});
