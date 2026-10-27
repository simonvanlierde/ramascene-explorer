// The specs' test and expect. With COVERAGE=1, each Chromium test records which
// of the page's own scripts ran, for `pnpm measure-coverage` to map back to the
// Svelte files. Firefox and WebKit have no coverage API, so they run as usual.
import { mkdir, writeFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";

export { expect };

export const test = base.extend({
	coverage: [
		async ({ page, browserName }, use, info) => {
			const on = process.env.COVERAGE && browserName === "chromium";
			if (on) await page.coverage.startJSCoverage({ resetOnNavigation: false });
			await use();
			if (!on) return;
			const own = (await page.coverage.stopJSCoverage()).filter((e) => new URL(e.url).pathname.includes("/assets/"));
			await mkdir("test-results/js-coverage", { recursive: true });
			await writeFile(`test-results/js-coverage/${info.testId}-${info.project.name}.json`, JSON.stringify(own));
		},
		{ auto: true },
	],
});
