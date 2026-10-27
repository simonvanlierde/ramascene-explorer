import { expect, test } from "./test.js";

// A quick flick can release the pointer before the next frame; WebKit runs its
// frames late enough that every test drag did. The turn must still land.
test("a globe drag released before the next frame still turns the globe", async ({ page }) => {
	await page.goto("?data=tests/fixture.json&map=globe");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await expect(page.locator("svg.map")).toHaveClass(/\bglobe\b/);
	const region = page.locator(".mapc .rg").first();
	const before = await region.getAttribute("d");
	await page.locator("svg.map").evaluate((svg) => {
		const r = svg.getBoundingClientRect();
		const at = (type, dx) =>
			svg.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					pointerId: 1,
					isPrimary: true,
					clientX: r.x + r.width / 2 + dx,
					clientY: r.y + r.height / 2,
				}),
			);
		at("pointerdown", 0);
		at("pointermove", 60);
		at("pointerup", 60);
	});
	await expect.poll(() => region.getAttribute("d")).not.toBe(before);
});
