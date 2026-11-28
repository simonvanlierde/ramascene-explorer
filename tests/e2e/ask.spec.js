import { existsSync } from "node:fs";
import { expect, test } from "./test.js";

// Like browser-engine.spec.js: the custom run needs the browser store, which CI downloads
const needData = () => {
	const here = existsSync("data/browser-engine/manifest-v3.json");
	test.skip(!here && !process.env.CI, "Export or download the browser dataset first.");
	expect(here, "data/browser-engine is missing; fetch the browser store, see docs/browser-engine.md").toBe(true);
};

const MODEL = "http://127.0.0.1:8999/v1";

// A model that answers each question with the next canned action
async function mockModel(page, answers) {
	const questions = [];
	await page.route(`${MODEL}/models`, (route) => route.fulfill({ json: { data: [{ id: "test-model" }] } }));
	await page.route(`${MODEL}/chat/completions`, (route) => {
		const body = route.request().postDataJSON();
		questions.push(body);
		return route.fulfill({
			json: { choices: [{ message: { content: JSON.stringify(answers[questions.length - 1]) } }] },
		});
	});
	return questions;
}

async function openAsk(page, isMobile) {
	await page.goto(`./?ask=${encodeURIComponent(MODEL)}`);
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	if (isMobile) await page.locator(".dock .filters").click();
	await expect(page.locator("#ask")).toBeVisible();
}

test("without ?ask= there is no Ask panel", async ({ page }) => {
	await page.goto("./");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await expect(page.locator("#ask")).toHaveCount(0);
});

test("a question becomes a what-if the browser engine runs, then a view change", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(120_000);
	const questions = await mockModel(page, [
		{
			action: "whatif",
			indicator: null,
			region: null,
			levers: [
				{
					product: "Motor vehicles, trailers and semi-trailers",
					origin_region: "Europe",
					consumed_by: ["Y: Final Consumption"],
					consumed_region: "Europe",
					change_percent: -20,
				},
			],
			reply: "<b>Cut</b> European car demand by 20%.",
		},
		{ action: "view", indicator: "jobs", region: "China", levers: [], reply: "Showing jobs in China." },
	]);
	await openAsk(page, isMobile);

	await page.locator("#ask-q").fill("What if Europeans bought 20% fewer cars?");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-outcome")).toContainText("Computed in this browser in", { timeout: 90_000 });
	// the reply is text, not markup
	await expect(page.locator("#ask-reply")).toHaveText("The model says: <b>Cut</b> European car demand by 20%.");
	await expect(page.locator("#ask-reply b")).toHaveCount(0);
	await expect(page.locator("#ask-levers li")).toHaveText([
		"Motor vehicles, trailers and semi-trailers, made in Europe, used by Y: Final Consumption in Europe: −20%",
	]);
	await expect(page.locator("#status .pill.live")).toHaveText("Custom run: not covered by checks");
	// the link keeps only the view and ?ask=, never the custom run
	const query = new URL(page.url()).searchParams;
	expect([...query.keys()].sort()).toEqual(["ask", "mode", "scenario"]);
	expect(query.get("mode")).toBe("whatif");
	expect(page.url()).not.toContain("browser-");
	const body = questions[0];
	expect(body.model).toBe("test-model");
	expect(body.response_format.json_schema.name).toBe("action");
	expect(body.messages.at(-1).content).toBe("What if Europeans bought 20% fewer cars?");

	// a finished run closes the phone's selection sheet
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#ask-q").fill("Show me jobs in China");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-outcome")).toHaveText("The map now shows jobs for China.");
	await expect(page.locator("#ask-error")).toHaveText("");
	await expect(page).toHaveURL(/indicator=3/);
	await expect(page).toHaveURL(/region=CN/);
});

test("an unknown name and a failing server show as text", async ({ page, isMobile }) => {
	needData();
	await mockModel(page, [
		{
			action: "whatif",
			indicator: null,
			region: null,
			reply: "",
			levers: [
				{
					product: "Unobtainium",
					origin_region: "Europe",
					consumed_by: ["All industries"],
					consumed_region: "Europe",
					change_percent: -5,
				},
			],
		},
	]);
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("No such thing");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-error")).toHaveText(
		'Change 1: "Unobtainium" is not in the catalogue. Rephrase the question and ask again.',
		{ timeout: 60_000 },
	);
	await page.unroute(`${MODEL}/chat/completions`);
	await page.route(`${MODEL}/chat/completions`, (route) => route.fulfill({ status: 500, body: "boom" }));
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-error")).toContainText("The model server answered 500");
	await expect(page.locator("#ask-error")).not.toContainText("..");
});

test("a plan too broad for the browser leaves the view and the link as they were", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	await mockModel(page, [
		{
			action: "whatif",
			indicator: null,
			region: null,
			reply: "",
			levers: [
				{
					product: "Total",
					origin_region: "Total",
					consumed_by: ["S: Electricity, gas and water supply"],
					consumed_region: "Europe",
					change_percent: -20,
				},
			],
		},
	]);
	await page.goto(`./?ask=${encodeURIComponent(MODEL)}`);
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	// the scrubber parked at the 2011 baseline must stay there
	const slider = page.locator('.scrub [role="slider"]');
	await expect(slider).toHaveAttribute("aria-valuenow", "100", { timeout: 30_000 });
	await slider.focus();
	await slider.press("Home");
	await expect(slider).toHaveAttribute("aria-valuenow", "0");
	const before = page.url();
	if (isMobile) await page.locator(".dock .filters").click();
	await page.locator("#ask-q").fill("Everything into electricity");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-error")).toContainText("too broad", { timeout: 60_000 });
	expect(page.url()).toBe(before);
	await expect(slider).toHaveAttribute("aria-valuenow", "0");
});

test("Cancel during an Ask run says Cancelled", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	// the matrix reads never answer, so the run is still going when Cancel is pressed
	await page.route("**/browser-engine/store-*/**", () => {});
	await mockModel(page, [
		{
			action: "whatif",
			indicator: null,
			region: null,
			reply: "",
			levers: [
				{
					product: "Motor vehicles, trailers and semi-trailers",
					origin_region: "Europe",
					consumed_by: ["Y: Final Consumption"],
					consumed_region: "Europe",
					change_percent: -20,
				},
			],
		},
	]);
	// Custom scenario stays closed: the Ask panel's own Cancel stops the run
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("What if Europeans bought 20% fewer cars?");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-answer")).toHaveText("Asking the model, then running the engine…");
	await expect(page.locator("#live-state")).toContainText("Computing the scenario", { timeout: 60_000 });
	await page.locator("#ask-cancel").click();
	await expect(page.locator("#ask-outcome")).toHaveText("Cancelled.");
	await expect(page.locator("#ask-error")).toHaveText("");
	await expect(page.locator("#ask-go")).toHaveAttribute("aria-disabled", "false");
	await expect(page.locator("#ask-q")).toBeFocused();
	// a fresh worker replaces the stopped one; its ready message leaves the answer alone
	await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
	await expect(page.locator("#ask-outcome")).toHaveText("Cancelled.");
});

test("Ask's Cancel leaves a run the Custom form started", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(90_000);
	await page.route(`${MODEL}/models`, (route) => route.fulfill({ json: { data: [{ id: "test-model" }] } }));
	// the model never answers, and the form's run never finishes
	await page.route(`${MODEL}/chat/completions`, () => {});
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("What if Europeans bought 20% fewer cars?");
	await page.locator("#ask-go").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-run")).toBeEnabled({ timeout: 60_000 });
	await page.route("**/browser-engine/store-*/**", () => {});
	await page.locator("#live-run").click();
	await expect(page.locator("#live-state")).toContainText("Computing the scenario", { timeout: 60_000 });
	await page.locator("#ask-cancel").click();
	// Ask stops waiting; its "Cancelled." clears at once, as any answer does during a form run
	await expect(page.locator("#ask-go")).toHaveAttribute("aria-disabled", "false", { timeout: 60_000 });
	await expect(page.locator("#live-state")).toContainText("Computing the scenario");
	await expect(page.locator("#live-cancel")).toBeVisible();
});

test("Cancel stops waiting for the model", async ({ page, isMobile }) => {
	needData();
	await page.route(`${MODEL}/models`, (route) => route.fulfill({ json: { data: [{ id: "test-model" }] } }));
	// the model never answers
	await page.route(`${MODEL}/chat/completions`, () => {});
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("What if Europeans bought 20% fewer cars?");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-go")).toHaveAttribute("aria-disabled", "true");
	await page.locator("#ask-cancel").click();
	await expect(page.locator("#ask-outcome")).toHaveText("Cancelled.", { timeout: 60_000 });
	await expect(page.locator("#ask-cancel")).toHaveCount(0);
});

test("the example question is a hint the input names, not a placeholder", async ({ page, isMobile }) => {
	await openAsk(page, isMobile);
	const input = page.locator("#ask-q");
	await expect(page.locator("#ask-q-h")).toBeVisible();
	await expect(input).toHaveAccessibleDescription("For example: What if European car makers used 20% less steel?");
	await expect(input).not.toHaveAttribute("placeholder");
});

test("a run the Custom form starts clears the last answer", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(120_000);
	await mockModel(page, [
		{ action: "none", indicator: null, region: null, levers: [], reply: "That is not about the map." },
	]);
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("What is the capital of France?");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-reply")).toHaveText("The model says: That is not about the map.", {
		timeout: 60_000,
	});
	await page.locator("#live-open").click();
	await expect(page.locator("#live-run")).toBeEnabled({ timeout: 60_000 });
	await page.locator("#live-run").click();
	await expect(page.locator("#ask-answer")).toHaveText("");
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 90_000 });
	await expect(page.locator("#ask-answer")).toHaveText("");
});

test("an answer that lands while a Custom form run computes is cleared too", async ({ page, isMobile }) => {
	needData();
	test.setTimeout(120_000);
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const none = { action: "none", indicator: null, region: null, levers: [], reply: "That is not about the map." };
	await page.route(`${MODEL}/models`, (route) => route.fulfill({ json: { data: [{ id: "test-model" }] } }));
	await page.route(`${MODEL}/chat/completions`, async (route) => {
		await held;
		await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(none) } }] } });
	});
	await openAsk(page, isMobile);
	await page.locator("#ask-q").fill("What is the capital of France?");
	await page.locator("#ask-go").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-run")).toBeEnabled({ timeout: 60_000 });
	await page.locator("#live-run").click();
	release();
	await expect(page.locator("#ask-go")).not.toHaveAttribute("aria-disabled", "true", { timeout: 60_000 });
	await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 90_000 });
	await expect(page.locator("#ask-answer")).toHaveText("");
});

test("an off-topic answer only replies; an unknown action is an error", async ({ page, isMobile }) => {
	needData();
	const none = { action: "none", indicator: null, region: null, levers: [], reply: "That is not about the map." };
	await mockModel(page, [none, { ...none, action: "run" }]);
	await openAsk(page, isMobile);
	const before = page.url();
	await page.locator("#ask-q").fill("What is the capital of France?");
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-reply")).toHaveText("The model says: That is not about the map.", {
		timeout: 60_000,
	});
	await expect(page.locator("#ask-outcome")).toHaveText("Nothing was run, and the map is unchanged.");
	expect(page.url()).toBe(before);
	await page.locator("#ask-go").click();
	await expect(page.locator("#ask-error")).toContainText("had no action this page can run");
	await expect(page.locator("#ask-reply")).toHaveCount(0);
});

test("?api= takes precedence over ?ask=: no Ask panel", async ({ page }) => {
	await page.goto(`./?api=http://127.0.0.1:8998&ask=${encodeURIComponent(MODEL)}`);
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…", exact: true }).first().click();
	await expect(page.locator("#ask")).toHaveCount(0);
});
