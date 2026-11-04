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
	// steps: 0 no drag, 1 one 60 px move, 60 sixty moves of 1 px (a slow drag)
	const pickSpain = async (steps) => {
		await page.goto("?data=tests/fixture.json&map=globe");
		await expect(page.locator(".mapc .rg")).toHaveCount(49);
		await page.waitForTimeout(1000); // the turn to the opening country is over
		return page.locator("svg.map").evaluate(async (svg, steps) => {
			const frames = (ms) =>
				new Promise((done) => {
					const end = performance.now() + ms;
					const tick = () => (performance.now() >= end ? done() : requestAnimationFrame(tick));
					requestAnimationFrame(tick);
				});
			// the first point says where Germany is, whether thinned or full outlines are drawn
			const germany = () => svg.querySelector('.rg[data-region="DE"]').getAttribute("d").split("L")[0];
			const before = germany();
			svg.querySelector('.rg[data-region="ES"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await frames(50); // the turn to Spain has started
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
			if (steps) {
				at("pointerdown", 0);
				for (let i = 1; i <= steps; i++) at("pointermove", (i * 60) / steps);
				at("pointerup", 60);
			}
			await frames(1500); // past the 800 ms turn and the 150 ms settle
			return { before, after: germany() };
		}, steps);
	};
	const turned = await pickSpain(0);
	expect(turned.after, "picking Spain turned the globe").not.toBe(turned.before);
	expect((await pickSpain(1)).after, "a drag").not.toBe(turned.after);
	expect((await pickSpain(60)).after, "a slow drag").not.toBe(turned.after);
});

// A flick glides on a little after the release; a drag that stops before the
// release, or any drag under reduced motion, ends where the pointer let go. The flat
// map pans only when zoomed in, so it is zoomed first.
for (const map of ["globe", "flat"])
	test(`a flick lets the ${map} map glide on, a paused drag does not`, async ({ page }) => {
		const dragGermany = async (pause, reduce = "no-preference") => {
			await page.emulateMedia({ reducedMotion: reduce });
			await page.goto(`?data=tests/fixture.json&map=${map}`);
			await expect(page.locator(".mapc .rg")).toHaveCount(49);
			await page.waitForTimeout(1000); // the turn to the opening country is over
			if (map === "flat") await page.getByRole("button", { name: "Zoom in" }).click();
			// the zoomed flat map pans at most half a view, about 200 px on a phone: a short
			// drag leaves room for the glide
			const step = map === "flat" ? 10 : 40;
			// in the page, so a slow runner's round trips cannot add a pause before the release
			await page.locator("svg.map").evaluate(
				async (svg, [pause, step]) => {
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
					// 2 ms apart by the clock, not by timers, which a loaded runner delays
					for (let i = 1; i <= 6; i++) {
						const t = performance.now() + 2;
						while (performance.now() < t);
						at("pointermove", i * step);
					}
					if (pause) await wait(200); // a flick releases at once: even a 0 ms timer can run late
					at("pointerup", 6 * step);
					await frames(1000); // past the glide and the 150 ms settle
				},
				[pause, step],
			);
			// the first point says where Germany is, whether thinned or full outlines are drawn
			return (await page.locator('.mapc .rg[data-region="DE"]').getAttribute("d")).split("L")[0];
		};
		const paused = await dragGermany(true);
		expect(await dragGermany(false)).not.toBe(paused);
		expect(await dragGermany(false, "reduce")).toBe(paused);
	});

// Bands meet at the selected country; once a turn puts it behind the globe, they would
// run across the far side, so each ends at the horizon instead, and the ring goes.
// The published flows, not the fixture: their partners span the world, so some stay in
// view when the selection has turned away.
test("the globe's bands end at the horizon while the selection is behind it", async ({ page }) => {
	await page.goto("?map=globe");
	await expect(page.locator(".bands path").first()).toBeVisible();
	await page.waitForTimeout(1000); // the turn to the opening country is over
	await page.locator("svg.map").evaluate(async (svg) => {
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
		const frames = (ms) =>
			new Promise((done) => {
				const end = performance.now() + ms;
				const tick = () => (performance.now() >= end ? done() : requestAnimationFrame(tick));
				requestAnimationFrame(tick);
			});
		// 0.35° per px: 520 px turns the globe about 180°
		at("pointerdown", 0);
		for (let i = 1; i <= 26; i++) {
			at("pointermove", i * 20);
			await frames(20);
		}
		await frames(200); // a pause, so the release starts no glide
		at("pointerup", 520);
		await frames(500);
	});
	await expect(page.locator(".mapc .ring")).toHaveCount(0);
	// the band's selection end is the middle of its outline (one edge out, the other back):
	// halfway between the two edges' ends, on the horizon, it sits on the globe's outline
	const gaps = await page.locator("svg.map").evaluate((svg) => {
		const globe = svg.querySelector(":scope > path").getBBox();
		const [cx, cy, r] = [globe.x + globe.width / 2, globe.y + globe.height / 2, globe.width / 2];
		return [...svg.querySelectorAll(".bands path")].map((band) => {
			const points = band.getAttribute("d").slice(1, -1).split("L");
			const n = points.length / 2;
			const [[x1, y1], [x2, y2]] = [points[n - 1], points[n]].map((p) => p.split(",").map(Number));
			return Math.abs(Math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy) - r);
		});
	});
	expect(gaps.length).toBeGreaterThan(0);
	for (const gap of gaps) expect(gap).toBeLessThan(4);
});
