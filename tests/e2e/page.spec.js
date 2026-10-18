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
	await page.reload();
	await openSelection(page);
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
	await page.getByRole("button", { name: "Released in" }).click();
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
});

test("the shipped results render without the synthetic banner", async ({ page }) => {
	await page.goto("");
	await ready(page);
	await expect(page.locator("#banner")).toBeHidden();
	await expect(page.locator("#headline")).toContainText("Germany’s consumption caused");
	await expect(page.locator(".pill.ok")).toHaveCount(1); // hidden, not removed, on a phone
	await expectNoAxeViolations(page);
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
