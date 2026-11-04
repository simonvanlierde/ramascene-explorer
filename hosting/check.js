import assert from "node:assert/strict";
import { chromium, expect, firefox, webkit } from "@playwright/test";

const base = process.argv[2];
if (!base) throw new Error("Usage: node hosting/check.js https://simonvanlierde.com/ramascene-explorer/");
const url = (path) => new URL(path, base);
const home = await fetch(url(""));
assert.equal(home.status, 200);
assert.equal(home.headers.get("Cross-Origin-Opener-Policy"), "same-origin");
assert.equal(home.headers.get("Cross-Origin-Embedder-Policy"), "require-corp");
// a workers.dev link without the prefix lands on the page; production's root is not this Worker's
if (new URL(base).hostname.endsWith(".workers.dev")) {
	const root = await fetch(new URL("/", base), { redirect: "manual" });
	assert.equal(root.status, 302);
	assert.equal(new URL(root.headers.get("Location"), base).pathname, new URL(base).pathname);
}
// A bad answer is logged with its status and cf-ray, then fetched once more; a second bad
// answer fails the check.
async function json(path, retried = false) {
	const res = await fetch(url(path));
	const text = await res.text();
	try {
		assert.equal(res.status, 200);
		return JSON.parse(text);
	} catch (e) {
		const why = `${path}: status ${res.status}, ${text.length} bytes, cf-ray ${res.headers.get("cf-ray")}`;
		if (retried) throw new Error(why, { cause: e });
		console.log(`${why}; fetching it again`);
		return json(path, true);
	}
}
const results = await json("data/results.json");
const manifest = await json("data/browser-engine/manifest-v3.json");
// With DATA_ORIGIN (the build's VITE_DATA_ORIGIN), the Parquet and the store come from that
// host by their hashes, read across origins; without it, from next to the page.
// When the variable is unset, the workflow passes an empty string.
const data = process.env.DATA_ORIGIN ? process.env.DATA_ORIGIN.replace(/\/?$/, "/") : null;
const sha = results.provenance.embodied.sha256;
// the origin of the production routes in wrangler.jsonc
const PRODUCTION = "https://simonvanlierde.com";
const shard = `browser-engine/store-${manifest.store}/A/c/0/0`;
for (const [href, size] of [
	[data ? new URL(`embodied/${sha}.parquet`, data) : url("data/embodied.parquet"), results.provenance.embodied.bytes],
	[data ? new URL(shard, data) : url(`data/${shard}`), manifest.arrays.A.shard_bytes[0]],
]) {
	const path = String(href);
	const origin = new URL(base).origin;
	const cors = data ? { Origin: origin } : {};
	// A read without Origin first: if the edge cached that answer, without CORS headers,
	// for later CORS reads, the page could not read the file and the check below fails.
	if (data) await (await fetch(href, { headers: { Range: "bytes=0-1" } })).arrayBuffer();
	const head = await fetch(href, { method: "HEAD", headers: cors });
	assert.equal(head.status, 200, path);
	assert.equal(Number(head.headers.get("Content-Length")), size, path);
	const res = await fetch(href, { headers: { ...cors, Range: "bytes=0-1" } });
	assert.equal(res.status, 206, path);
	assert.equal(res.headers.get("Content-Range"), `bytes 0-1/${size}`, path);
	assert.equal((await res.arrayBuffer()).byteLength, 2, path);
	if (data) assert.ok(["*", origin].includes(res.headers.get("Access-Control-Allow-Origin")), path);
	// The edge caches a copy per Origin value, so the production page's origin gets its own
	// read: a preview's origin passing says nothing about the copy production is served.
	if (data) {
		const live = await fetch(href, { headers: { Origin: PRODUCTION, Range: "bytes=0-1" } });
		await live.arrayBuffer();
		assert.ok(["*", PRODUCTION].includes(live.headers.get("Access-Control-Allow-Origin")), `${path} for ${PRODUCTION}`);
	}
	if (data || path.includes("store-")) assert.match(res.headers.get("Cache-Control") ?? "", /immutable/, path);
}
// Each engine runs the page and its calculations; only the first replays the 155 published
// scenarios, which read the whole store. Through the Worker, every read counts against its
// daily request allowance.
const engines = { chromium, firefox, webkit };
const names = (process.env.CHECK_BROWSERS ?? "chromium,firefox,webkit").split(",");
const started = performance.now();
const at = () => Math.round(performance.now() - started);
// Records the page's and its workers' requests and console, so a failed wait prints what
// the data reads were doing at that moment.
function watch(page, failed) {
	const open = new Map();
	const odd = [];
	const done = [];
	const logs = [];
	const short = (u) => u.replace(/store-[0-9a-f]{8}[0-9a-f]+/, (s) => s.slice(0, 14)).slice(0, 140);
	page.on("request", (r) => open.set(r, { url: short(r.url()), host: new URL(r.url()).host, t: at() }));
	page.on("response", (res) => {
		const h = res.headers();
		const entry = open.get(res.request());
		if (entry) Object.assign(entry, { status: res.status(), ray: h["cf-ray"], cache: h["cf-cache-status"] });
		if (![200, 206, 204, 304].includes(res.status()) || h["cf-mitigated"])
			odd.push(`${at()} ${res.status()} ${h["cf-mitigated"] ?? ""} ${h["cf-ray"] ?? ""} ${short(res.url())}`);
	});
	page.on("requestfinished", (r) => {
		const e = open.get(r);
		open.delete(r);
		if (e) done.push({ ...e, ms: at() - e.t });
	});
	page.on("requestfailed", (r) => {
		const e = open.get(r);
		open.delete(r);
		failed.push(
			`${at()} after ${e ? at() - e.t : "?"} ms ${r.failure()?.errorText} ${e?.status ?? ""} ${e?.ray ?? ""} ${short(r.url())}`,
		);
	});
	const log = (m) => logs.push(`${at()} ${m.type()} ${m.text().slice(0, 300)}`);
	page.on("console", log);
	page.on("pageerror", (e) => logs.push(`${at()} pageerror ${e.message.slice(0, 300)}`));
	page.on("worker", (w) => {
		logs.push(`${at()} worker ${short(w.url())}`);
		w.on?.("console", log);
	});
	return async function dump() {
		const state = await page
			.locator("#live-state")
			.textContent({ timeout: 1000 })
			.catch(() => "(none)");
		const messages = await page.evaluate(() => globalThis.workerLog ?? []).catch((e) => [String(e)]);
		const slow = done.toSorted((a, b) => b.ms - a.ms).slice(0, 10);
		const data = done.filter((d) => d.host !== new URL(base).host);
		console.log(
			[
				`--- evidence at ${at()} ms; #live-state: ${state}`,
				`requests finished: ${done.length} (${data.length} off the page's host, ${data.reduce((s, d) => s + d.ms, 0)} ms in all)`,
				`still open (${open.size}):`,
				...[...open.values()].map(
					(e) => `  started ${e.t}, open ${at() - e.t} ms ${e.status ?? "no response"} ${e.ray ?? ""} ${e.url}`,
				),
				`failed (${failed.length}):`,
				...failed.map((f) => `  ${f}`),
				`not 2xx or challenged (${odd.length}):`,
				...odd.map((f) => `  ${f}`),
				"slowest finished:",
				...slow.map((e) => `  started ${e.t}, ${e.ms} ms ${e.status} ${e.cache ?? ""} ${e.ray ?? ""} ${e.url}`),
				`worker messages (last 40 of ${messages.length}):`,
				...messages.slice(-40).map((m) => `  ${m}`),
				`console (last 40 of ${logs.length}):`,
				...logs.slice(-40).map((m) => `  ${m}`),
			].join("\n"),
		);
	};
}
for (const engine of names.map((n) => engines[n])) {
	const browser = await engine.launch({ headless: true });
	let dump = async () => {};
	const failed = [];
	try {
		const page = await browser.newPage();
		dump = watch(page, failed);
		await page.addInitScript(() => {
			const Original = Worker;
			const t0 = performance.now();
			globalThis.workerUrls = [];
			globalThis.threadCounts = [];
			globalThis.workerLog = [];
			globalThis.Worker = class extends Original {
				constructor(...args) {
					super(...args);
					const n = workerUrls.push(String(args[0]));
					this.addEventListener("message", ({ data }) => {
						if (data.value?.threads) threadCounts.push(data.value.threads);
						const { value, ...rest } = data ?? {};
						workerLog.push(
							`${Math.round(performance.now() - t0)} w${n} ${JSON.stringify(rest).slice(0, 300)}${value ? ` value:${Object.keys(value)}` : ""}`,
						);
					});
					this.addEventListener("error", (e) => workerLog.push(`w${n} error ${e.message}`));
				}
			};
		});
		await page.goto(url("").href);
		assert.equal(await page.evaluate(() => crossOriginIsolated), true);
		// Every wait leaves room for one range read the data host leaves hanging: the page
		// gives it 60 s, then tries it again (src/lib/range.js).
		await expect(page.locator(".mapc .rg")).toHaveCount(49, { timeout: 90_000 });
		await page.getByRole("button", { name: "What if…" }).first().click();
		await page.locator("#live-open").click();
		await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 120_000 });
		await page.locator("#live-run").click();
		await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 120_000 });
		assert.deepEqual(await page.evaluate(() => threadCounts), [1]);
		await page.locator("#live-product").selectOption("5");
		await page.locator("#live-origin").selectOption("1");
		await page.locator("#live-consumer").selectOption("5");
		await page.locator("#live-consumed-reg").selectOption("1");
		await page.locator("#live-run").click();
		await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 120_000 });
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
					// computing messages only mark a threaded kernel call's start and end
					w.onmessage = ({ data }) =>
						"computing" in data
							? undefined
							: data.error || data.retrySingle
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
			dump = watch(fallback, failed);
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
				timeout: 120_000,
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
			await expect(fallback.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 120_000 });
			assert.deepEqual(await fallback.evaluate(() => [workerCount, lastThreads]), [expected > 1 ? 2 : 1, 1]);
			console.log("chromium: failed pool terminated and calculation retried on one thread");
		}
	} catch (e) {
		console.log(`${engine.name()} failed: ${e.message.split("\n")[0]}`);
		await dump();
		throw e;
	} finally {
		// a passing run lists the reads that failed and were tried again
		for (const f of failed) console.log(`${engine.name()} request failed: ${f}`);
		await browser.close();
	}
}
