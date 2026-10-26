import { defineConfig } from "vitest/config";

// Only the benchmarks run under Vitest (`pnpm bench`); the unit tests stay on
// node --test.
export default defineConfig({
	test: { benchmark: { include: ["tests/bench/**/*.bench.js"] } },
});
