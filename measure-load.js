// Bytes a cold first load downloads, per file type: pnpm measure-load [url] [runs]
// See docs/page.md#first-load-size.
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "https://simonvanlierde.com/ramascene-explorer/";
const runs = Number(process.argv[3] ?? 3);

const kind = (u) => {
	const p = new URL(u).pathname;
	if (/\.(woff2?|ttf)$/.test(p)) return "fonts";
	if (/\.js$/.test(p)) return "js";
	if (/\.css$/.test(p)) return "css";
	if (/\.(png|jpe?g|svg|webp|ico)$/.test(p)) return "images";
	if (/\.(json|parquet)$/.test(p)) return "data";
	return "html";
};

async function once(browser) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const cdp = await ctx.newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
	const reqs = new Map();
	cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, wire: 0, decoded: 0 }));
	cdp.on("Network.dataReceived", (e) => {
		const r = reqs.get(e.requestId);
		if (r) r.decoded += e.dataLength;
	});
	cdp.on("Network.loadingFinished", (e) => {
		const r = reqs.get(e.requestId);
		// encodedDataLength is the bytes on the wire, headers included
		if (r) r.wire = e.encodedDataLength;
	});
	await page.goto(url, { waitUntil: "networkidle" });
	// the default What if… run loads when the browser is idle
	await page.waitForTimeout(3000);
	await page.waitForLoadState("networkidle");
	await ctx.close();
	const by = {};
	for (const r of reqs.values()) {
		const k = kind(r.url);
		by[k] ??= { wire: 0, decoded: 0 };
		by[k].wire += r.wire;
		by[k].decoded += r.decoded;
	}
	const sum = (f) => Object.values(by).reduce((s, b) => s + b[f], 0);
	return { wire: sum("wire"), decoded: sum("decoded"), by };
}

const browser = await chromium.launch();
const results = [];
for (let i = 0; i < runs; i++) results.push(await once(browser));
await browser.close();
results.sort((a, b) => a.wire - b.wire);
const median = results[Math.floor(runs / 2)];
console.log(`${url}, median of ${runs} cold loads`);
console.log(`total: ${median.wire} B transferred, ${median.decoded} B decoded`);
for (const [k, b] of Object.entries(median.by)) console.log(`${k}: ${b.wire} B transferred, ${b.decoded} B decoded`);
