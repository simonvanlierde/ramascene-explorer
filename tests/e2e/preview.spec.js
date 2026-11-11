import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "./test.js";

const SITE = "https://simonvanlierde.com/ramascene-explorer/";
const ogVersion = createHash("sha256").update(readFileSync("public/og.png")).digest("hex").slice(0, 8);
const meta = (page, attr, name) => page.locator(`head meta[${attr}="${name}"]`);

test("the head carries absolute share tags and the image is served", async ({ page, request }) => {
	await page.goto("./");
	await expect(meta(page, "property", "og:title")).toHaveAttribute("content", "RaMa-Scene Explorer");
	await expect(meta(page, "property", "og:image")).toHaveAttribute("content", `${SITE}og.png?v=${ogVersion}`);
	await expect(meta(page, "property", "og:image:width")).toHaveAttribute("content", "1200");
	await expect(meta(page, "property", "og:image:height")).toHaveAttribute("content", "630");
	await expect(meta(page, "property", "og:image:alt")).toHaveAttribute("content", /globe.*Germany.*released abroad/);
	await expect(meta(page, "property", "og:url")).toHaveAttribute("content", SITE);
	await expect(meta(page, "name", "twitter:card")).toHaveAttribute("content", "summary_large_image");
	await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", SITE);

	const res = await request.get("./og.png");
	expect(res.status()).toBe(200);
	expect(res.headers()["content-type"]).toBe("image/png");

	for (const [rel, type] of [
		["icon", "image/svg+xml"],
		["apple-touch-icon", "image/png"],
	]) {
		const href = await page.locator(`head link[rel="${rel}"]`).getAttribute("href");
		const icon = await request.get(`./${href}`);
		expect(icon.status(), href).toBe(200);
		expect(icon.headers()["content-type"]).toBe(type);
	}
});

test("without JavaScript the page says so and links the README and data", async ({ browser, baseURL }) => {
	const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
	const page = await context.newPage();
	await page.goto("./");
	await expect(page.locator("noscript p")).toContainText("needs JavaScript");
	await expect(page.locator("noscript p")).toBeVisible();
	await expect(page.getByRole("link", { name: "README on GitHub" })).toBeVisible();
	await expect(page.getByRole("link", { name: "data/results.json" })).toHaveAttribute("href", "data/results.json");
	await expect(page.getByRole("link", { name: "data-2011-r2 release" })).toBeVisible();
	await context.close();
});
