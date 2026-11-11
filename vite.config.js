import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The page fetches these at run time, by paths relative to itself, so they are
// copied as they are rather than bundled. A data file that does not exist yet
// is skipped: the page then shows how to generate it.
const STATIC = ["data/results.json", "data/embodied.parquet", "data/browser-engine", "geo"];

const staticFiles = {
	name: "static-files",
	writeBundle({ dir }) {
		for (const path of STATIC.filter((p) => existsSync(p))) cpSync(path, `${dir}/${path}`, { recursive: true });
	},
	// The synthetic fixtures never ship, but the preview serves them for the
	// browser tests. The Parquet answers a single range, as every data host does:
	// the reader refuses a server that ignores Range.
	configurePreviewServer(server) {
		for (const [path, type] of [
			["tests/fixture.json", "application/json"],
			["tests/fixture-embodied.parquet", "application/vnd.apache.parquet"],
		])
			server.middlewares.use(`/${path}`, (req, res) => {
				const body = readFileSync(path);
				res.setHeader("Content-Type", type);
				const [, a, b] = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/) ?? [];
				if (a === undefined) {
					res.setHeader("Content-Length", body.length);
					res.end(req.method === "HEAD" ? undefined : body);
					return;
				}
				const end = Math.min(b ? Number(b) + 1 : body.length, body.length);
				res.statusCode = 206;
				res.setHeader("Content-Range", `bytes ${a}-${end - 1}/${body.length}`);
				res.end(body.subarray(Number(a), end));
			});
	},
};

// Platforms cache a preview by image URL, so the card URL carries the PNG's hash.
const ogVersion = createHash("sha256").update(readFileSync("public/og.png")).digest("hex").slice(0, 8);
const ogCardVersion = {
	name: "og-card-version",
	transformIndexHtml: (html) => html.replace('/og.png"', `/og.png?v=${ogVersion}"`),
};

export default defineConfig({
	// relative, so the build works under the GitHub Pages subpath and from any file server
	base: "./",
	worker: { format: "es" },
	plugins: [svelte(), staticFiles, ogCardVersion],
	// source maps only for pnpm measure-coverage, so the published build stays as it is
	build: { outDir: "dist", sourcemap: !!process.env.COVERAGE },
	preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
