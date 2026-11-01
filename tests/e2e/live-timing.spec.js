import { apiUrl } from "../../live.js";
import { expect, test } from "./test.js";

const api = process.env.LIVE_API;

test("click to a drawn result from the real job API", async ({ page }, info) => {
	test.skip(!api, "Set LIVE_API to run against the real job API.");
	test.skip(info.project.name !== "light", "One browser measures this journey; the live specs cover all engines.");
	expect(apiUrl(`?api=${encodeURIComponent(api)}`)).toBe(api);
	test.setTimeout(120_000);
	await page.goto(`?api=${encodeURIComponent(api)}`);
	await expect(page.locator("#live-state")).toHaveText(`Connected to ${api}.`);
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await page.getByRole("button", { name: "What if…" }).first().click();
	if (await page.locator(".dock .filters").isVisible()) await page.locator(".dock .filters").click();
	await page.locator("#live-open").click();
	await expect(page.locator("#live-run")).toBeVisible();

	const samples = [];
	for (let run = 0; run < 5; run++) {
		// Mark the browser's click, excluding Playwright's actionability wait.
		await page.locator("#live-run").evaluate((button) => {
			button.addEventListener(
				"click",
				() => {
					const start = performance.now();
					const previous = document.querySelector("#live-state").textContent;
					window.scenarioPaint = new Promise((resolve) => {
						const check = () => {
							const state = document.querySelector("#live-state").textContent;
							const source = document.querySelector("#status .basis").textContent;
							const progress = Number(document.querySelector('.scrub [role="slider"]')?.getAttribute("aria-valuenow"));
							if (
								state !== previous &&
								/Job .* finished/.test(state) &&
								source.includes("computed live by the job API") &&
								progress > 0
							)
								requestAnimationFrame(() => resolve(performance.now() - start));
							else requestAnimationFrame(check);
						};
						requestAnimationFrame(check);
					});
				},
				{ once: true },
			);
		});
		const finished = page.waitForResponse(async (response) => {
			if (!response.url().startsWith(`${api}/jobs/`) || !response.ok()) return false;
			return ["succeeded", "failed"].includes((await response.json()).status);
		});
		await page.locator("#live-run").click();
		const job = await (await finished).json();
		expect(job.status, job.error).toBe("succeeded");
		await expect(page.locator("#live-state")).toContainText(`Job ${job.id} finished`);
		await expect(page.locator("#status .basis")).toContainText("computed live by the job API");
		await expect(page.locator(".bands path").first()).toBeVisible();
		const clickToPaintMs = await page.evaluate(() => window.scenarioPaint);
		expect(job.result.flows.shape).toEqual([3, 49, 15, 49]);
		expect(job.peak_rss_bytes).toBeGreaterThan(0);
		samples.push({ clickToPaintMs, workerSeconds: job.duration_s, peakRssBytes: job.peak_rss_bytes });
		// Wait for the replay before the next click so samples do not overlap it.
		await expect(page.getByRole("slider", { name: "From the 2011 baseline to the run" })).toHaveAttribute(
			"aria-valuenow",
			"100",
		);
	}
	await info.attach("live-timing.json", {
		body: JSON.stringify({ api, samples }, null, 2),
		contentType: "application/json",
	});
	console.log(JSON.stringify({ journey: "live scenario click to paint", samples }));
});
