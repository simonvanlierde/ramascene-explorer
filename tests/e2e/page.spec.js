import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FIXTURE = "?data=tests/fixture.json";
const REGIONS = 5;

async function expectNoAxeViolations(page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}

test("synthetic data renders the chart, table and provenance under a banner", async ({ page }) => {
	await page.goto(FIXTURE);
	await expect(page.locator("#banner")).toHaveText("SYNTHETIC TEST DATA: NOT A RESULT");
	await expect(page.locator("#chart text.region")).toHaveCount(REGIONS);
	await expect(page.locator("#table tbody tr")).toHaveCount(REGIONS);
	await expect(page.locator("#provenance dt").first()).toHaveText("data_kind");
	await expect(page.locator("#headline")).not.toBeEmpty();
	await expectNoAxeViolations(page);
});

test("choosing an intervention re-renders and is kept in the URL", async ({ page }) => {
	await page.goto(FIXTURE);
	const before = await page.locator("#table tbody").textContent();
	await page.selectOption("#scenario", "cement-in-construction");
	await expect(page).toHaveURL(/scenario=cement-in-construction/);
	await expect(page.locator("#table tbody")).not.toHaveText(before);
	await page.reload();
	await expect(page.locator("#scenario")).toHaveValue("cement-in-construction");
});

test("the shipped results render without the synthetic banner", async ({ page }) => {
	await page.goto("");
	await expect(page.locator("#app")).toBeVisible();
	await expect(page.locator("#banner")).toBeHidden();
	await expect(page.locator("#chart text.region")).toHaveCount(REGIONS);
	await expectNoAxeViolations(page);
});

test("a refused data path falls back to the default and says so", async ({ page }) => {
	await page.goto("?data=../secret.json");
	await expect(page.locator("#status .fail")).toHaveText("ignored data=../secret.json");
	await expect(page.locator("#banner")).toBeHidden();
});
