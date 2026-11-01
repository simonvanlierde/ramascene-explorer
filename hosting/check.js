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
for (const [path, size] of [
	["data/embodied.parquet", results.provenance.embodied.bytes],
	[`data/browser-engine/store-${manifest.store}/A/c/0/0`, manifest.arrays.A.shard_bytes[0]],
]) {
	const head = await fetch(url(path), { method: "HEAD" });
	assert.equal(head.status, 200, path);
	assert.equal(Number(head.headers.get("Content-Length")), size, path);
	const res = await fetch(url(path), { headers: { Range: "bytes=0-1" } });
	assert.equal(res.status, 206, path);
	assert.equal(res.headers.get("Content-Range"), `bytes 0-1/${size}`, path);
	assert.equal((await res.arrayBuffer()).byteLength, 2, path);
	if (path.includes("store-")) assert.match(res.headers.get("Cache-Control"), /immutable/);
}
for (const engine of [chromium, firefox, webkit]) {
	const browser = await engine.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(url("").href);
		assert.equal(await page.evaluate(() => crossOriginIsolated), true);
		await expect(page.locator(".mapc .rg")).toHaveCount(49);
		await page.getByRole("button", { name: "What if…" }).first().click();
		await page.locator("#live-open").click();
		await expect(page.locator("#live-state")).toHaveText("Ready to compute in this browser.", { timeout: 60_000 });
		await page.locator("#live-run").click();
		await expect(page.locator("#live-state")).toContainText("Computed in this browser in", { timeout: 60_000 });
		console.log(`${engine.name()}: isolated, map loaded, browser calculation passed`);
	} finally {
		await browser.close();
	}
}
