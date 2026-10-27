import { expect, test } from "./test.js";

// results.json carries the Parquet file's size (provenance.embodied.bytes), so
// the reader goes straight to the footer: no HEAD request before the map draws.
test("the shipped page reads the flows without a HEAD request and draws bands", async ({ page }) => {
	const requests = [];
	page.on("request", (r) => {
		if (r.url().endsWith("/embodied.parquet")) requests.push(`${r.method()} ${r.headers().range ?? ""}`);
	});
	await page.goto("");
	await expect(page.locator(".bands path").first()).toBeVisible();
	expect(requests.filter((r) => r.startsWith("HEAD"))).toEqual([]);
	// the footer, then the baseline row group, both by range
	expect(requests.slice(0, 2)).toEqual(Array(2).fill(expect.stringMatching(/^GET bytes=\d+-\d+$/)));
});
