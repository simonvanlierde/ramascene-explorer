import { cpSync, existsSync, readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The page fetches these at run time, by paths relative to itself, so they are
// copied as they are rather than bundled. A data file that does not exist yet
// is skipped: the page then shows how to generate it.
const STATIC = ["data/results.json", "data/regions.json", "data/flows.json", "geo"];

const staticFiles = {
	name: "static-files",
	writeBundle({ dir }) {
		for (const path of STATIC.filter((p) => existsSync(p))) cpSync(path, `${dir}/${path}`, { recursive: true });
	},
	// The synthetic fixture never ships, but the preview serves it for the browser tests.
	configurePreviewServer(server) {
		server.middlewares.use("/tests/fixture.json", (_req, res) => {
			res.setHeader("Content-Type", "application/json");
			res.end(readFileSync("tests/fixture.json"));
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
