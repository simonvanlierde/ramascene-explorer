import { expect, test } from "./test.js";

const SITE = "https://simonvanlierde.github.io/ramascene-explorer/";
const meta = (page, attr, name) => page.locator(`head meta[${attr}="${name}"]`);

test("the head carries absolute share tags and the image is served", async ({ page, request }) => {
	await page.goto("./");
	await expect(meta(page, "property", "og:title")).toHaveAttribute("content", "RaMa-Scene Explorer");
	await expect(meta(page, "property", "og:image")).toHaveAttribute("content", `${SITE}og.png`);
	await expect(meta(page, "property", "og:url")).toHaveAttribute("content", SITE);
	await expect(meta(page, "name", "twitter:card")).toHaveAttribute("content", "summary_large_image");
	await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", SITE);

	const res = await request.get("./og.png");
	expect(res.status()).toBe(200);
	expect(res.headers()["content-type"]).toBe("image/png");
});

test("without JavaScript the page says so and links the README and data", async ({ browser, baseURL }) => {
	const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
	const page = await context.newPage();
	await page.goto("./");
	await expect(page.locator("noscript p")).toContainText("needs JavaScript");
	await expect(page.locator("noscript p")).toBeVisible();
	await expect(page.getByRole("link", { name: "README on GitHub" })).toBeVisible();
	await expect(page.getByRole("link", { name: "data/results.json" })).toHaveAttribute("href", "data/results.json");
	await expect(page.getByRole("link", { name: "data-2011 release" })).toBeVisible();
	await context.close();
});
