import { expect, test } from "./test.js";

// NOTE: on the CI runners, Playwright's desktop WebKit left a frame the page asked for
// after the test's own script returned unrun for seconds. The same tests pass in its
// iPhone WebKit, in Chromium and Firefox, and in the same image off CI. So each drag
// test waits on the page's frames inside its script.

// A quick flick can release the pointer before the next frame; WebKit runs its
// frames late enough that every test drag did. The turn must still land.
test("a globe drag released before the next frame still turns the globe", async ({ page }) => {
	await page.goto("?data=tests/fixture.json&map=globe");
	await expect(page.locator(".mapc .rg")).toHaveCount(49);
	await expect(page.locator("svg.map")).toHaveClass(/\bglobe\b/);
	const turned = await page.locator("svg.map").evaluate(async (svg) => {
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
		const first = () => svg.querySelector(".mapc .rg").getAttribute("d");
		const frames = (ms) =>
			new Promise((done) => {
				const end = performance.now() + ms;
				const tick = () => (performance.now() >= end ? done() : requestAnimationFrame(tick));
				requestAnimationFrame(tick);
			});
		const d0 = first();
		at("pointerdown", 0);
		at("pointermove", 60);
		at("pointerup", 60);
		await frames(500);
		return first() !== d0;
	});
	expect(turned, "the drag turned the globe").toBe(true);
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
		// in the page, so a slow runner's round trips cannot add a pause before the release
		await page.locator("svg.map").evaluate(async (svg, pause) => {
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
			const wait = (ms) => new Promise((done) => setTimeout(done, ms));
			const frames = (ms) =>
				new Promise((done) => {
					const end = performance.now() + ms;
					const tick = () => (performance.now() >= end ? done() : requestAnimationFrame(tick));
					requestAnimationFrame(tick);
				});
			at("pointerdown", 0);
			for (let i = 1; i <= 6; i++) {
				await wait(16);
				at("pointermove", i * 20);
			}
			await wait(pause ? 200 : 0);
			at("pointerup", 120);
			await frames(1000); // past the glide and the 150 ms settle
		}, pause);
		return page.locator('.mapc .rg[data-region="DE"]').getAttribute("d");
	};
	const paused = await dragGermany(true);
	expect(await dragGermany(false)).not.toBe(paused);
	expect(await dragGermany(false, "reduce")).toBe(paused);
});
