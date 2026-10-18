import { cpSync, existsSync, readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The page fetches these at run time, by paths relative to itself, so they are
// copied as they are rather than bundled. A data file that does not exist yet
// is skipped: the page then shows how to generate it.
const STATIC = ["data/results.json", "data/embodied.parquet", "geo"];

const staticFiles = {
	name: "static-files",
	writeBundle({ dir }) {
		for (const path of STATIC.filter((p) => existsSync(p))) cpSync(path, `${dir}/${path}`, { recursive: true });
	},
	// The synthetic fixtures never ship, but the preview serves them for the
	// browser tests. The Parquet answers HEAD with its length and GET in full,
	// which the reader falls back to when a server ignores Range.
	configurePreviewServer(server) {
		for (const [path, type] of [
			["tests/fixture.json", "application/json"],
			["tests/fixture-embodied.parquet", "application/vnd.apache.parquet"],
		])
			server.middlewares.use(`/${path}`, (req, res) => {
				const body = readFileSync(path);
				res.setHeader("Content-Type", type);
				res.setHeader("Content-Length", body.length);
				res.end(req.method === "HEAD" ? undefined : body);
			});
	},
};

export default defineConfig({
	// relative, so the build works under the GitHub Pages subpath and from any file server
	base: "./",
	plugins: [svelte(), staticFiles],
	build: { outDir: "dist" },
	preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
