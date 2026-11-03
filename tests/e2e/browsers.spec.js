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

// A drag while the globe still turns to a picked country must win over the turn,
// or the turn's next frame puts the globe back and the drag is lost.
test("a globe drag during a turn is not undone by the turn", async ({ page }) => {
	const pickSpain = async (dragToo) => {
		await page.goto("?data=tests/fixture.json&map=globe");
		await expect(page.locator(".mapc .rg")).toHaveCount(49);
		await page.waitForTimeout(1000); // the turn to the opening country is over
		await page.locator("svg.map").evaluate(async (svg, drag) => {
			svg.querySelector('.rg[data-region="ES"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
			// two frames: the turn to Spain has started
			await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
			if (!drag) return;
			const r = svg.getBoundingClientRect();
			for (const [type, dx] of [
				["pointerdown", 0],
				["pointermove", 60],
				["pointerup", 60],
			])
				svg.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						pointerId: 1,
						isPrimary: true,
						clientX: r.x + r.width / 2 + dx,
						clientY: r.y + r.height / 2,
					}),
				);
		}, dragToo);
		await page.waitForTimeout(1500); // past the 800 ms turn and the 150 ms settle
		return page.locator('.mapc .rg[data-region="DE"]').getAttribute("d");
	};
	const turned = await pickSpain(false);
	expect(await pickSpain(true)).not.toBe(turned);
});

// A flick glides on a little after the release; a drag that stops before the
// release, or any drag under reduced motion, ends where the pointer let go.
test("a flick lets the globe glide on, a paused drag does not", async ({ page }) => {
	const dragGermany = async (pause, reduce = "no-preference") => {
		await page.emulateMedia({ reducedMotion: reduce });
		await page.goto("?data=tests/fixture.json&map=globe");
		await expect(page.locator(".mapc .rg")).toHaveCount(49);
		await page.waitForTimeout(1000); // the turn to the opening country is over
		const r = await page.locator("svg.map").boundingBox();
		const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 120, y, { steps: 6 });
		if (pause) await page.waitForTimeout(200);
		await page.mouse.up();
		await page.waitForTimeout(1000); // past the glide and the 150 ms settle
		return page.locator('.mapc .rg[data-region="DE"]').getAttribute("d");
	};
	const paused = await dragGermany(true);
	expect(await dragGermany(false)).not.toBe(paused);
	expect(await dragGermany(false, "reduce")).toBe(paused);
});
