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

// Resolves once the map's markup has not changed for 30 frames in a row: a turn,
// morph or glide redraws it every frame, so a still map is a finished one. The
// frames are counted inside the page, as browsers.spec.js explains.
export async function mapAtRest(page) {
	const rested = await page.locator("svg.map").evaluate(
		(svg) =>
			new Promise((done) => {
				const giveUp = performance.now() + 8000;
				let last = svg.innerHTML;
				let still = 0;
				const tick = () => {
					const now = svg.innerHTML;
					still = now === last ? still + 1 : 0;
					last = now;
					if (still >= 30) return done(true);
					if (performance.now() > giveUp) return done(false);
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
	);
	expect(rested, "the map came to rest").toBe(true);
}
