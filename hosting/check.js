import assert from "node:assert/strict";
import { chromium, expect, firefox, webkit } from "@playwright/test";

const base = process.argv[2];
if (!base) throw new Error("Usage: node hosting/check.js https://simonvanlierde.com/ramascene-explorer/");
const url = (path) => new URL(path, base);
const home = await fetch(url(""));
assert.equal(home.status, 200);
assert.equal(home.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
assert.equal(home.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
const results = await (await fetch(url("data/results.json"))).json();
const manifest = await (await fetch(url("data/browser-engine/manifest-v3.json"))).json();
// With DATA_ORIGIN (the build's VITE_DATA_ORIGIN), the Parquet and the store come from that
// host by their hashes, read across origins; without it, from next to the page.
const data = process.env.DATA_ORIGIN;
const sha = results.provenance.embodied.sha256;
const shard = `browser-engine/store-${manifest.store}/A/c/0/0`;
for (const [href, size] of [
	[data ? new URL(`embodied/${sha}.parquet`, data) : url("data/embodied.parquet"), results.provenance.embodied.bytes],
	[data ? new URL(shard, data) : url(`data/${shard}`), manifest.arrays.A.shard_bytes[0]],
]) {
	const path = String(href);
	const cors = data ? { Origin: new URL(base).origin } : {};
	const head = await fetch(href, { method: "HEAD", headers: cors });
	assert.equal(head.status, 200, path);
	assert.equal(Number(head.headers.get("Content-Length")), size, path);
	const res = await fetch(href, { headers: { ...cors, Range: "bytes=0-1" } });
	assert.equal(res.status, 206, path);
	assert.equal(res.headers.get("Content-Range"), `bytes 0-1/${size}`, path);
	assert.equal((await res.arrayBuffer()).byteLength, 2, path);
	if (data) assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*", path);
	if (data || path.includes("store-")) assert.match(res.headers.get("Cache-Control") ?? "", /immutable/, path);
}
// Each engine runs the page and its calculations; only the first replays the 155 published
// scenarios, which read the whole store. Through the Worker, every read counts against its
// daily request allowance.
const engines = { chromium, firefox, webkit };
const names = (process.env.CHECK_BROWSERS ?? "chromium,firefox,webkit").split(",");
for (const engine of names.map((n) => engines[n])) {
	const browser = await engine.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.addInitScript(() => {
			const Original = Worker;
			globalThis.workerUrls = [];
			globalThis.threadCounts = [];
			globalThis.Worker = class extends Original {
				constructor(...args) {
					super(...args);
					workerUrls.push(String(args[0]));
					this.addEventListener("message", ({ data }) => {
						if (data.value?.threads) threadCounts.push(data.value.threads);
					});
				}
			};
		});
		await page.goto(url("").href);
		assert.equal(await page.evaluate(() => crossOriginIsolated), true);
		await expect(page.locator(".mapc .rg")).toHaveCount(49);
		await page.getByRole("button", { name: "What if…" }).first().click();
		await page.locator("#live-open").click();
		await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
		await page.locator("#live-run").click();
		await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
		assert.deepEqual(await page.evaluate(() => threadCounts), [1]);
		await page.locator("#live-product").selectOption("5");
		await page.locator("#live-origin").selectOption("1");
		await page.locator("#live-consumer").selectOption("5");
		await page.locator("#live-consumed-reg").selectOption("1");
		await page.locator("#live-run").click();
		await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 90_000 });
		const expected = await page.evaluate(() => Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)));
		assert.deepEqual(await page.evaluate(() => threadCounts), [1, expected]);
		if (engine !== engines[names[0]]) {
			console.log(`${engine.name()}: ${expected} threads and a dense calculation passed`);
			continue;
		}
		const parity = await page.evaluate(async (base) => {
			const reference = await (await fetch(new URL("data/results.json", base))).json();
			const meta = await (await fetch(new URL("data/browser-engine/manifest-v3.json", base))).json();
			const w = new Worker(workerUrls[0], { type: "module" });
			const call = (body) =>
				new Promise((resolve, reject) => {
					w.onmessage = ({ data }) =>
						data.error || data.retrySingle
							? reject(new Error(data.error ?? "thread pool failed"))
							: resolve(data.value);
					w.onerror = (e) => reject(new Error(e.message));
					w.postMessage({ id: 1, base: new URL("data/browser-engine/", base).href, body, single: false });
				});
			try {
				await call();
				try {
					await call({
						model_details: [
							{ product: [82], originReg: [7], consumedBy: [81], consumedReg: [7], techChange: [632.7954014961612] },
						],
					});
					throw new Error("singular scenario was accepted");
				} catch (e) {
					if (!e.message.includes("singular or ill-conditioned")) throw e;
				}
				let worst = 0;
				let threads;
				const cases = reference.scenarios.filter((s) => s.id !== "baseline");
				for (const scenario of cases) {
					const value = await call({ model_details: scenario.model_details });
					threads = value.threads;
					const flows = value.result.flows.scenario;
					for (let i = 0; i < meta.indicators.length; i++)
						for (const region of meta.catalog.regions.filter((r) => r.id >= 2 && r.id <= 6)) {
							let got = 0;
							for (const p of region.leaves)
								for (let s = 0; s < meta.sections.length; s++)
									for (let c = 0; c < meta.countries; c++)
										got += flows[((i * meta.countries + p) * meta.sections.length + s) * meta.countries + c];
							const want = reference.results[scenario.id][String(meta.indicators[i])][region.name];
							worst = Math.max(worst, Math.abs(got - want) / Math.max(Math.abs(want), 1e-12));
						}
				}
				return { worst, threads, count: cases.length };
			} finally {
				w.terminate();
			}
		}, base);
		assert.equal(parity.count, 155);
		assert.equal(parity.threads, expected);
		assert.ok(parity.worst <= 1e-8, `threaded parity: ${parity.worst}`);
		console.log(`${engine.name()}: ${expected} threads, dense calculation and 155 published scenarios passed`);
		if (engine === chromium) {
			await page.close();
			const fallback = await browser.newPage();
			await fallback.addInitScript(() => {
				const Original = Worker;
				globalThis.workerCount = 0;
				globalThis.lastThreads = 0;
				globalThis.Worker = class extends Original {
					constructor(...args) {
						super(...args);
						workerCount++;
						this.addEventListener("message", ({ data }) => {
							if (data.value?.threads) lastThreads = data.value.threads;
						});
					}
				};
			});
			await fallback.route("**/assets/browser-worker-*.js", async (route) => {
				const response = await route.fetch();
				const prefix =
					'const PoolWorker=Worker;self.Worker=class extends PoolWorker {constructor(){super(new URL("missing-pool-worker.js",self.location.href),{type:"module"})}};\n';
				await route.fulfill({ response, body: prefix + (await response.text()) });
			});
			await fallback.goto(url("").href);
			await fallback.getByRole("button", { name: "What if…" }).first().click();
			await fallback.locator("#live-open").click();
			await expect(fallback.locator("#live-state")).toHaveText("Ready to compute in this browser.", {
				timeout: 60_000,
			});
			// The worker script has loaded. Interception also breaks the worker's cross-origin
			// reads from the data host in Chromium, so it ends before the first one.
			await fallback.unrouteAll();
			for (const [id, value] of [
				["product", "5"],
				["origin", "1"],
				["consumer", "5"],
				["consumed-reg", "1"],
			])
				await fallback.locator(`#live-${id}`).selectOption(value);
			await fallback.locator("#live-run").click();
			await expect(fallback.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 90_000 });
			assert.deepEqual(await fallback.evaluate(() => [workerCount, lastThreads]), [expected > 1 ? 2 : 1, 1]);
			console.log("chromium: failed pool terminated and calculation retried on one thread");
		}
	} finally {
		await browser.close();
	}
}
