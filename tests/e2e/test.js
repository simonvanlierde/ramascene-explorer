// The specs' test and expect. With COVERAGE=1, each Chromium test records which
// of the page's own scripts ran, for `pnpm measure-coverage` to map back to the
// Svelte files. Firefox and WebKit have no coverage API, so they run as usual.
import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
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

// Resolves once the map's markup has not changed for half a second: a turn, morph or
// glide redraws it every frame, so a still map is a finished one. The check runs on
// frames, so a runner that stalls them cannot look still, and inside the page, as
// browsers.spec.js explains. The markup is compared every 50 ms, not every frame.
export async function mapAtRest(page) {
	const rested = await page.locator("svg.map").evaluate(
		(svg) =>
			new Promise((done) => {
				const giveUp = performance.now() + 20_000;
				let last = svg.innerHTML;
				let sampled = performance.now();
				let changed = sampled;
				const tick = (now) => {
					if (now - sampled >= 50) {
						const markup = svg.innerHTML;
						if (markup !== last) changed = now;
						last = markup;
						sampled = now;
					}
					if (now - changed >= 500) return done(true);
					if (now > giveUp) return done(false);
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
	);
	expect(rested, "the map came to rest").toBe(true);
}

// Fails on any WCAG 2.x A/AA violation, listed by rule and element.
export async function expectNoAxeViolations(page) {
	// a colour still mid-transition (the mode switch) is not the page's contrast
	// a transition cancelled on the way rejects its promise; it is still over
	await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}
