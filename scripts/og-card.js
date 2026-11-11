// Renders public/og.png: the app's own globe (Germany, consumption, GHG) in a poster for link
// previews. Needs `pnpm build` and data/embodied.parquet first; run `node scripts/og-card.js`.
// The headline figure is read from the page's own sentence, so the card cannot drift from the app.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = new URL("..", import.meta.url).pathname;
const font = (pkg, file) => pathToFileURL(join(root, "node_modules/@fontsource", pkg, "files", file)).href;
const SITE = "simonvanlierde.com/ramascene-explorer";

const server = await preview({ root, preview: { port: 4181, strictPort: true } });
const browser = await chromium.launch();
try {
	// 1. the app's globe, alone, on a transparent ground
	const app = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
	await app.goto("http://127.0.0.1:4181/?region=DE");
	await app.locator("svg.map path.limb").waitFor();
	await app.waitForTimeout(3000); // the bands sweep in; wait until the map is at rest
	const text = await app.locator("body").textContent();
	const found = text.match(/(\w[\w ]*?)['’]s consumption was linked to .*?(\d+)% was released abroad/s);
	if (!found) throw new Error("the sentence did not match; update scripts/og-card.js");
	const [, place, share] = found;
	await app.addStyleTag({
		content: `*{background:transparent!important;box-shadow:none!important}
body *{visibility:hidden}svg.map,svg.map *{visibility:visible}g.lbls{display:none}`,
	});
	const box = await app.locator("svg.map path.limb").boundingBox();
	const globe = await app.screenshot({ clip: box, omitBackground: true });

	// 2. the poster
	const logo = (await readFile(join(root, "docs/img/logo.svg"), "utf8")).replace(
		"<svg ",
		'<svg width="64" height="64" ',
	);
	const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:PS;font-weight:700;src:url(${font("public-sans", "public-sans-latin-700-normal.woff2")})}
@font-face{font-family:PS;font-weight:600;src:url(${font("public-sans", "public-sans-latin-600-normal.woff2")})}
@font-face{font-family:Sp;font-weight:400;src:url(${font("spectral", "spectral-latin-400-normal.woff2")})}
@font-face{font-family:Sp;font-weight:600;src:url(${font("spectral", "spectral-latin-600-normal.woff2")})}
*{box-sizing:border-box}html,body{margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#f4f5f5;color:#1f2a33;font-family:PS,sans-serif}
img{position:absolute;left:260px;top:-10px;width:680px;height:680px}
.card{position:absolute;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e0e4e7;border-radius:12px;
 box-shadow:0 6px 24px rgb(31 42 51/.14);text-align:center}
.top{top:26px;display:flex;align-items:center;gap:16px;padding:12px 28px 12px 16px;font-size:48px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.bot{bottom:26px;width:680px;padding:16px 10px 14px}
.bot p{margin:0 auto;max-width:520px;font:400 42px/1.15 Sp,serif}.bot b{font-weight:600}
.bot .u{margin-top:10px;font:600 36px/1 PS,sans-serif;color:#a8471c;letter-spacing:-.06em;white-space:nowrap}
</style>
<img src="data:image/png;base64,${globe.toString("base64")}" alt="">
<div class="card top">${logo}<span>RaMa-Scene Explorer</span></div>
<div class="card bot"><p><b>${share}%</b> of ${place}’s footprint is released abroad</p><div class="u">${SITE}</div></div>`;
	const dir = await mkdtemp(join(tmpdir(), "og-"));
	const file = join(dir, "card.html");
	await writeFile(file, html);
	const poster = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await poster.goto(pathToFileURL(file).href);
	await poster.evaluate(() => document.fonts.ready);
	await poster.screenshot({ path: join(root, "public/og.png") });
} finally {
	await browser.close();
	await server.close();
}
