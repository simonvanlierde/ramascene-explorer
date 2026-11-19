import { existsSync } from "node:fs";
import { expect, test } from "./test.js";

// Like ask.spec.js: a what-if needs the browser store, which CI downloads
const needData = () => {
	const here = existsSync("data/browser-engine/manifest-v3.json");
	test.skip(!here && !process.env.CI, "Export or download the browser dataset first.");
	expect(here, "data/browser-engine is missing; fetch the browser store, see docs/browser-engine.md").toBe(true);
};

// No browser ships WebMCP without a flag or origin trial yet, so the page gets a stand-in
// document.modelContext that keeps what it registers, as a browser agent would see it.
async function withModelContext(page) {
	await page.addInitScript(() => {
		const tools = new Map();
		window.__tools = tools;
		const modelContext = {
			registerTool: async (tool, { signal } = {}) => {
				tools.set(tool.name, tool);
				signal?.addEventListener("abort", () => tools.delete(tool.name));
			},
		};
		Object.defineProperty(Document.prototype, "modelContext", { get: () => modelContext, configurable: true });
	});
}

// an agent's tool call: the input as JSON, the result back the same way
const call = (page, name, input) =>
	page.evaluate(
		async ([name, input]) => {
			try {
				return { ok: await window.__tools.get(name).execute(input, { signal: new AbortController().signal }) };
			} catch (e) {
				return { error: e.message };
			}
		},
		[name, input],
	);

test("an agent finds names, changes the view and runs a what-if through WebMCP", async ({ page }) => {
	needData();
	test.setTimeout(120_000);
	await withModelContext(page);
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.waitForFunction(() => window.__tools.size === 3);
	const tools = await page.evaluate(() =>
		[...window.__tools.values()].map((t) => [t.name, t.annotations?.readOnlyHint ?? false]),
	);
	expect(tools).toEqual([
		["find_names", true],
		["show_view", false],
		["run_whatif", false],
	]);

	const found = await call(page, "find_names", { kind: "products", query: "motor vehicles" });
	expect(found.error).toBeUndefined();
	expect(found.ok.names).toContain("Motor vehicles, trailers and semi-trailers");

	const view = await call(page, "show_view", { indicator: "jobs", region: "China" });
	expect(view.ok.outcome).toBe("The map now shows jobs for China.");
	await expect(page).toHaveURL(/indicator=3/);
	await expect(page).toHaveURL(/region=CN/);

	await call(page, "show_view", { indicator: "ghg", region: "Germany" });
	const run = await call(page, "run_whatif", {
		levers: [
			{
				product: "Motor vehicles, trailers and semi-trailers",
				origin_region: "Europe",
				consumed_by: ["Y: Final Consumption"],
				consumed_region: "Europe",
				change_percent: -20,
			},
		],
	});
	expect(run.error).toBeUndefined();
	expect(run.ok.changes).toEqual([
		"Motor vehicles, trailers and semi-trailers, made in Europe, used by Y: Final Consumption in Europe: −20%",
	]);
	expect(run.ok.outcome).toContain("Computed in this browser in");
	expect(run.ok.headline).toContain("final demand in Europe");
	expect(run.ok.headline).toMatch(/Mt CO2-eq/);
	await expect(page.getByRole("button", { name: "What if…", exact: true }).first()).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	// a custom run stays out of the link, whoever started it
	expect(page.url()).not.toContain("browser-");

	const bad = await call(page, "run_whatif", {
		levers: [
			{
				product: "Unobtainium",
				origin_region: "Total",
				consumed_by: ["All industries"],
				consumed_region: "Total",
				change_percent: -5,
			},
		],
	});
	expect(bad.error).toContain('"Unobtainium" is not in the catalogue');
	const empty = await call(page, "show_view", {});
	expect(empty.error).toContain("changes nothing");
});

test("with ?api= the page registers no WebMCP tools", async ({ page }) => {
	await withModelContext(page);
	await page.goto("./?api=http://127.0.0.1:8998");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	expect(await page.evaluate(() => window.__tools.size)).toBe(0);
});
