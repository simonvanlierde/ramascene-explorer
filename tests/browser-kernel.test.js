import assert from "node:assert/strict";
import { test } from "node:test";
import { threadCount } from "../browser-kernel.js";

test("the pool leaves a core available and stays within four threads", () => {
	for (const [cores, want] of [
		[undefined, 1],
		[0, 1],
		[1, 1],
		[2, 1],
		[3, 2],
		[4, 3],
		[8, 4],
		[32, 4],
	]) {
		assert.equal(threadCount(true, cores), want);
		assert.equal(threadCount(false, cores), 1);
	}
});

test("only dense broad systems use threads, with room for the thread runtime", async () => {
	const { useThreads } = await import("../browser-kernel.js");
	const plan = { rows: { length: 4165 }, columns: { length: 1078 }, memory: 240 * 1024 ** 2 };
	assert.equal(useThreads(plan), true);
	assert.equal(useThreads({ ...plan, rows: { length: 4000 }, columns: { length: 500 } }), true);
	assert.equal(useThreads({ ...plan, rows: { length: 3999 }, columns: { length: 500 } }), false);
	assert.equal(useThreads({ ...plan, memory: plan.memory + 1 }), false);
	assert.equal(useThreads({ ...plan, rows: plan.columns, columns: plan.rows }), false);
	assert.equal(useThreads({ ...plan, rows: { length: 49 }, columns: { length: 32 } }), false);
	assert.equal(useThreads({ ...plan, rows: { length: 49 }, columns: { length: 32 } }, true), true);
	assert.equal(useThreads({ ...plan, memory: plan.memory + 1 }, true), false);
});
