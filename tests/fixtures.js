// Helpers the tests share. Not a *.test.js file, so `node --test` does not run it.
import { asyncBufferFromFile } from "hyparquet";
import { openEmbodied, readRun } from "../src/lib/embodied.js";

// Absolute path of a file next to (or relative to) this folder.
export const path = (p) => new URL(p, import.meta.url).pathname;

// Equal within a relative tolerance, for floating-point sums.
export const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

export const src = await openEmbodied(await asyncBufferFromFile(path("./fixture-embodied.parquet")));
export const base = await readRun(src, "baseline");
