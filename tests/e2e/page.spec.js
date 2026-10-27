import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./test.js";

const FIXTURE = "?data=tests/fixture.json";

async function expectNoAxeViolations(page) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}

const ready = (page) => expect(page.locator(".mapc .rg")).toHaveCount(49);

// On a phone the selection lives in a bottom sheet opened from the dock, which
// shows once the data is in; on a wider screen it is the sidebar.
async function openSelection(page) {
	const dock = page.locator(".dock .filters");
	await expect(dock.or(page.locator("#side")).filter({ visible: true }).first()).toBeVisible();
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

test("the synthetic banner never covers the header, and Details opens below both", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	const box = async (s) => page.locator(s).evaluate((e) => e.getBoundingClientRect().toJSON());
	// on a phone the page scrolls, and the header sticks under the banner
	await page.evaluate(() => window.scrollTo(0, 400));
	const banner = await box("#banner");
	const header = await box(".top");
	expect(header.top).toBeGreaterThanOrEqual(banner.bottom - 0.5);
	await page.getByRole("button", { name: /^Details for/ }).click();
	await expect(page.locator(".sk .lk").first()).toBeVisible();
	expect((await box(".pan")).top).toBeGreaterThanOrEqual((await box(".top")).bottom - 0.5);
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
	await ready(page);
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

test("the Sankey's industry labels stay clear of the region columns in both directions", async ({ page }) => {
	for (const dir of ["in", "out"]) {
		await page.goto(`?panel=sankey${dir === "out" ? "&dir=out" : ""}`);
		await expect(page.locator(".sk .lk").first()).toBeVisible();
		const hits = await page.locator(".sk").evaluate((svg) => {
			const r = (e) => e.getBoundingClientRect();
			const over = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
			// the region nodes: the slate rects of the two outer columns
			const nodes = [...svg.querySelectorAll('rect[fill="var(--slate)"]')].map(r);
			return [...svg.querySelectorAll("text.halo")]
				.filter((t) => nodes.some((n) => over(r(t), n)))
				.map((t) => t.textContent);
		});
		expect(hits, `dir=${dir}`).toEqual([]);
	}
});

test("each of the sentence's controls has its visible text in its name", async ({ page }) => {
	for (const q of ["", "&dir=out", "&indicator=3", "&mode=whatif&scenario=cement-in-construction"]) {
		await page.goto(FIXTURE + q);
		await ready(page);
		const toks = await page
			.locator(".hl .tok")
			.evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute("aria-label")]));
		expect(toks.length).toBeGreaterThan(0);
		for (const [text, label] of toks) expect(label, q).toContain(text);
	}
});

test("the possessive sits on the country's underline", async ({ page }) => {
	for (const q of ["", "&mode=whatif&scenario=cement-in-construction"]) {
		await page.goto(FIXTURE + q);
		await ready(page);
		const { text, under } = await page
			.locator("#headline .u")
			.first()
			.evaluate((u) => {
				const tok = u.querySelector(".tok").getBoundingClientRect();
				const walk = document.createTreeWalker(u, NodeFilter.SHOW_TEXT);
				let node = walk.nextNode();
				while (node && !node.textContent.includes("\u2019")) node = walk.nextNode();
				const r = document.createRange();
				r.selectNodeContents(node);
				const g = r.getBoundingClientRect();
				return { text: node.textContent, under: g.left >= tok.left - 0.5 && g.right <= tok.right + 0.5 };
			});
		expect(text).toContain("\u2019s");
		expect(under, `${q}: the ’s under the token`).toBe(true);
	}
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

test("once the map stops moving it draws the full outlines", async ({ page }) => {
	// a moving map draws thinned outlines; the globe it settles on must match one opened directly
	const outlines = () => page.locator(".mapc .rg").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")).join(""));
	await page.goto("?map=globe");
	await ready(page);
	await expect.poll(outlines).not.toBe("");
	const atRest = await outlines();
	await page.goto("");
	await ready(page);
	await page.getByRole("button", { name: "Globe" }).click();
	await expect.poll(outlines).toBe(atRest);
});

test("a zoom button step draws the full outlines straight away", async ({ page }) => {
	// the thinned outlines are for continuous movement; one step must not pop from thin to full
	const outlines = () => page.locator(".mapc .rg").evaluateAll((ps) => ps.map((p) => p.getAttribute("d")).join(""));
	await page.goto("");
	await ready(page);
	const whole = await outlines();
	await page.getByRole("button", { name: "Zoom in" }).click();
	await expect.poll(outlines).not.toBe(whole);
	// the next frame after the click, before the 150 ms settle
	const next = await page.evaluate(() => {
		document.querySelector('button[aria-label="Zoom out"]').click();
		return new Promise((done) =>
			requestAnimationFrame(() =>
				done([...document.querySelectorAll(".mapc .rg")].map((p) => p.getAttribute("d")).join("")),
			),
		);
	});
	expect(next === whole, "zoomed back out, the full outlines in the next frame").toBe(true);
});

test("a click on a country selects it on the flat map, the zoomed map and the globe", async ({ page }) => {
	for (const [url, zoomIn] of [
		["", 0],
		["", 2],
		["?map=globe", 0],
	]) {
		await page.goto(url);
		await ready(page);
		for (let i = 0; i < zoomIn; i++) await page.getByRole("button", { name: "Zoom in" }).click();
		await page.locator('.rg[data-region="ES"]').click();
		await expect(page).toHaveURL(/region=ES/);
	}
});

test("the globe turns to a country picked in the country box", async ({ page }) => {
	await page.goto("?map=globe");
	await ready(page);
	await openSelection(page);
	const box = page.getByRole("combobox", { name: "Country" });
	await box.fill("Japan");
	await box.press("Enter");
	await expect(page).toHaveURL(/region=JP/);
	// Japan sits on the far side of a globe facing Germany; the ring shows once it has turned
	await expect(page.locator("circle.ring")).toHaveAttribute("opacity", "1");
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

test("a zoomed view is kept in the link and opens on the same place", async ({ page }) => {
	await page.goto("");
	await ready(page);
	for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
	await expect(page).toHaveURL(/zoom=8,-?[\d.]+,-?[\d.]+/);
	const cx = Number(await page.locator("circle.ring").getAttribute("cx"));
	await page.reload();
	await ready(page);
	await expect(page.locator('.bands path[data-region="IT"]')).toHaveCount(1);
	await expect(async () => {
		expect(Math.abs(Number(await page.locator("circle.ring").getAttribute("cx")) - cx)).toBeLessThan(8);
	}).toPass();
	await page.getByRole("button", { name: "Globe" }).click();
	await expect(page).not.toHaveURL(/zoom=/);
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

test("in the scrolling layout the wheel scrolls the page, not the map", async ({ page, isMobile }) => {
	test.skip(isMobile, "a phone has no wheel");
	await page.setViewportSize({ width: 700, height: 800 });
	await page.goto("");
	await ready(page);
	const box = await page.locator("svg.map").boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 300);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
	await page.mouse.wheel(0, -300);
	await page.waitForTimeout(400);
	await expect(page).not.toHaveURL(/zoom=/);
});

test("Reset zoom shows once zoomed and returns to the whole map", async ({ page }) => {
	await page.goto("");
	await ready(page);
	await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Zoom out" })).toHaveAttribute("aria-disabled", "true");
	await page.getByRole("button", { name: "Zoom in" }).click();
	await expect(page).toHaveURL(/zoom=/);
	await page.getByRole("button", { name: "Reset zoom" }).click();
	await expect(page.getByRole("button", { name: "Zoom in" })).toBeFocused();
	await expect(page).not.toHaveURL(/zoom=/);
	await expect(page.getByRole("button", { name: "Reset zoom" })).toHaveCount(0);
});

test("no flow label sits under the controls or the legend on the map", async ({ page }) => {
	for (const url of ["", "?region=CN", "?region=BR&map=globe&zoom=2", "?region=CN&zoom=2.5,105,32"]) {
		await page.goto(url);
		await ready(page);
		await page.waitForTimeout(400);
		const clash = await page.evaluate(() => {
			const boxes = [...document.querySelectorAll(".mtl, .mtr, .mzm, .lg, .mnote")]
				.map((e) => e.getBoundingClientRect())
				.filter((b) => b.width);
			const over = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
			return [...document.querySelectorAll(".lbls text")]
				.filter((t) => boxes.some((b) => over(t.getBoundingClientRect(), b)))
				.map((t) => t.textContent);
		});
		expect(clash, url || "default view").toEqual([]);
	}
});

test("jobs are never 'released': the cards, legend and table take the indicator's word", async ({ page }) => {
	await page.goto("?mode=whatif&indicator=3");
	await ready(page);
	await expect(page.locator(".kpis.k5")).toContainText("Jobs in Europe");
	await expect(page.locator(".kpis.k5")).not.toContainText("Released");
	await page.goto("?indicator=3");
	await ready(page);
	await expect(page.locator(".lg .lt")).toHaveText("Jobs here that make what Germany consumes");
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
	// read out once, from the map's legend, also while a phone's sheet is closed
	await expect(page.getByRole("status").filter({ hasText: "That run could not be loaded" })).toHaveCount(1);
	await page.unroute("**/*.parquet");
	await page.getByRole("button", { name: "Try again" }).first().click();
	expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
	await expect(page.locator("#headline")).toContainText("builders everywhere used 20% less cement");
	await expect(page.getByText("That run could not be loaded")).toHaveCount(0);
	// picking it again from the list works too
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
	// WebKit's layout rounding can leave a 44 px box at 43.99994 px
	const px = 0.01;
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
		for (const b of await heights(selector)) expect(b.h, `${selector}: ${b.name}`).toBeGreaterThanOrEqual(44 - px);
	};
	for (const s of [".dock .seg button", ".dock .filters", ".sel-chip button", ".mtr .seg button", ".mzm button"])
		await tall(s);
	// the pills and the sentence's controls look smaller; their hit area is 44 px tall
	const reach = await page.locator(".top button.pill, .top a.pill, .hl .tok").evaluateAll((els) =>
		els.map((e) => {
			const r = e.getBoundingClientRect();
			const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
			const at = (dy) => e.contains(document.elementFromPoint(x, y + dy));
			return { name: (e.textContent ?? "").trim().slice(0, 30), ok: at(-21) && at(21) };
		}),
	);
	expect(reach.length).toBeGreaterThan(2);
	for (const r of reach) expect(r.ok, `hit area of ${r.name}`).toBe(true);
	// the author link is 44 px tall; WebKit gives the pill below it the last pixel
	const author = await page.locator(".brand .by a").evaluate((e) => {
		const r = e.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const on = (y) => e.contains(document.elementFromPoint(x, y));
		let [top, bottom] = [r.top + r.height / 2, r.top + r.height / 2];
		while (on(top - 0.25)) top -= 0.25;
		while (on(bottom + 0.25)) bottom += 0.25;
		return bottom - top;
	});
	expect(author, "the author link's hit area").toBeGreaterThanOrEqual(42.5);
	await page.locator(".skip").focus();
	expect((await page.locator(".skip").boundingBox()).height).toBeGreaterThanOrEqual(44);
	await page.locator(".dock .filters").click();
	await expect(page.locator("#side")).toBeVisible();
	const rail = await heights("#side .rail .t");
	for (const [i, b] of rail.entries()) {
		expect(b.h, `rail tab ${b.name}`).toBeGreaterThanOrEqual(36 - px);
		if (i > 0) expect(b.cy - rail[i - 1].cy, `centres ${rail[i - 1].name} / ${b.name}`).toBeGreaterThanOrEqual(44 - px);
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

test("“the” goes before the United States wherever its name sits in a phrase", async ({ page }) => {
	await page.goto(`${FIXTURE}&region=US&dir=out`);
	await ready(page);
	await expect(page.locator("#headline")).toContainText("The United States");
	await expect(page.locator(".kpis")).toContainText("outside the United States");
	await expect(page.locator(".lg .lt")).toHaveText("Consumed here, made in the United States");
	await page.getByRole("button", { name: "What if…" }).filter({ visible: true }).click();
	await expect(page.locator("#headline")).toContainText("released in the United States would have come to");
	await expect(page.locator(".kpis.k5")).toHaveAttribute("aria-label", /^The change in the United States,/);
});

test("the form controls' borders have 3:1 contrast on white and on the soft ground", async ({ page }) => {
	await page.goto(FIXTURE);
	await ready(page);
	const ratios = await page.evaluate(() => {
		const lum = (rgb) => {
			const c = rgb
				.match(/[\d.]+/g)
				.slice(0, 3)
				.map((v) => Number(v) / 255);
			const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const ratio = (a, b) => {
			const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y);
			return (hi + 0.05) / (lo + 0.05);
		};
		const probe = document.createElement("i");
		probe.style.color = "var(--soft)";
		document.body.append(probe);
		const soft = getComputedStyle(probe).color;
		probe.remove();
		const border = getComputedStyle(document.querySelector(".cb input")).borderTopColor;
		return { white: ratio(border, "rgb(255, 255, 255)"), soft: ratio(border, soft) };
	});
	expect(ratios.white).toBeGreaterThanOrEqual(3);
	expect(ratios.soft).toBeGreaterThanOrEqual(3);
});

test("on a phone a control's hit area never covers its neighbour", async ({ page, isMobile }) => {
	test.skip(!isMobile, "phone layout only");
	// the country and the indicator on neighbouring lines of the sentence
	await page.goto(`${FIXTURE}&region=US&dir=out`);
	await ready(page);
	const stolen = await page.locator(".top button.pill, .top a.pill, .brand .by a, .hl .tok").evaluateAll((els) =>
		els.flatMap((e) => {
			const r = e.getBoundingClientRect();
			const points = [0.1, 0.5, 0.9].flatMap((fx) => [r.top + 1, r.bottom - 1].map((y) => [r.left + r.width * fx, y]));
			return points
				.map(([x, y]) => document.elementFromPoint(x, y))
				.filter((hit) => !e.contains(hit))
				.map((hit) => `${e.textContent.trim()} → ${hit?.textContent.trim().slice(0, 30)}`);
		}),
	);
	expect(stolen).toEqual([]);
});

test("on a phone a tap between two lines of the sentence goes to the nearer control", async ({ page, isMobile }) => {
	test.skip(!isMobile, "phone layout only");
	let pairs = 0;
	for (const width of [390, 320]) {
		await page.setViewportSize({ width, height: 800 });
		for (const q of ["&region=US&dir=out", "&region=DE&dir=out", "&region=GB&indicator=3"]) {
			await page.goto(FIXTURE + q);
			await ready(page);
			const found = await page.locator(".hl .tok").evaluateAll((els) => {
				const out = [];
				for (const a of els)
					for (const b of els) {
						const [ra, rb] = [a.getBoundingClientRect(), b.getBoundingClientRect()];
						const gap = rb.top - ra.bottom;
						const [l, r] = [Math.max(ra.left, rb.left), Math.min(ra.right, rb.right)];
						if (gap <= 0 || gap > 12 || r - l < 4) continue;
						const x = (l + r) / 2;
						// a quarter of the gap from each line
						const upper = a.contains(document.elementFromPoint(x, ra.bottom + gap / 4));
						const lower = b.contains(document.elementFromPoint(x, rb.top - gap / 4));
						out.push({ pair: `${a.textContent} / ${b.textContent}`, upper, lower });
					}
				return out;
			});
			pairs += found.length;
			for (const f of found) expect(f, `${width} px${q}`).toEqual({ pair: f.pair, upper: true, lower: true });
		}
	}
	expect(pairs, "stacked controls in the sentence").toBeGreaterThan(0);
});

test("the grid's pickers fold with their own Done, named apart from the sheet's", async ({ page }) => {
	await page.goto(`${FIXTURE}&mode=whatif`);
	await ready(page);
	await openSelection(page);
	await page.getByRole("radio", { name: /one product/i }).click();
	await expect(page.locator(".gridpick")).toBeVisible();
	// at most the sheet's own Done answers to the bare name
	expect(await page.getByRole("button", { name: "Done", exact: true }).count()).toBeLessThanOrEqual(1);
	await page.getByRole("button", { name: "Done picking the product, region and cut" }).click();
	await expect(page.locator(".gridpick")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Change the intervention" })).toBeFocused();
});
