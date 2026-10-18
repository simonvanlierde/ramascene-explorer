import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TABLE = "?data=tests/fixture.json&panel=table";

test("Download CSV saves the table's flows under a name that states the basis", async ({ page }) => {
	await page.goto(TABLE);
	await expect(page.locator("#flows-table tbody tr").first()).toBeVisible();
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Download CSV" }).click(),
	]);
	expect(download.suggestedFilename()).toBe("ramascene-synthetic-2011-DE-ghg-consumption-all-sections.csv");
	const text = await readFile(await download.path(), "utf8");
	const lines = text.trimEnd().split("\r\n");
	expect(lines[0]).toBe("region_code,region_name,flow_mt_co2eq,share_pct,largest_section");
	expect(lines.length - 1).toBe(await page.locator("#flows-table tbody tr").count());
});

test("Copy link puts the view's URL on the clipboard and says so", async ({ page, context, browserName }) => {
	// only Chromium lets a test grant clipboard access; the fallback is tested below
	test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only in Playwright");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(TABLE);
	await expect(page.locator("#flows-table tbody tr").first()).toBeVisible();
	await page.getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
	await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toHaveCount(0, { timeout: 5000 });
});

test("without clipboard access, Copy link offers the URL selected to copy by hand", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
	});
	await page.goto(TABLE);
	await expect(page.locator("#flows-table tbody tr").first()).toBeVisible();
	await page.getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByRole("status").filter({ hasText: "Link selected" })).toBeVisible();
	const field = page.locator("input[readonly]");
	await expect(field).toHaveValue(page.url());
	expect(await field.evaluate((el) => el.selectionEnd - el.selectionStart)).toBe(page.url().length);
});
