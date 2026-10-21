import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

// Only the benchmarks run under Vitest (`pnpm bench`); the unit tests stay on
// node --test. The CodSpeed plugin instruments the runs in CI and is a no-op
// outside of it.
export default defineConfig({
	plugins: [codspeedPlugin()],
	test: { benchmark: { include: ["tests/bench/**/*.bench.js"] } },
});
