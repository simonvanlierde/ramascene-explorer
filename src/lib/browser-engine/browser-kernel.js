import init, * as single from "../../../engine/pkg/ramascene_engine.js";
import { LIMITS } from "./browser-engine.js";

// Keep one core for the page, and bound extra stacks and scheduling on phones.
export const threadCount = (isolated, cores) => (isolated ? Math.min(4, Math.max(1, (cores || 2) - 1)) : 1);

export async function loadKernel(forceSingle = false) {
	await init();
	const count = threadCount(!forceSingle && globalThis.crossOriginIsolated, globalThis.navigator?.hardwareConcurrency);
	if (count < 2) return single;
	let timeout;
	try {
		return await Promise.race([
			(async () => {
				const kernel = await import("../../../engine/pkg-threads/index.js");
				await kernel.default();
				await kernel.initThreadPool(count);
				return kernel;
			})(),
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error("thread pool startup timed out")), 15_000);
			}),
		]);
	} catch (cause) {
		throw new Error("thread pool could not start", { cause });
	} finally {
		clearTimeout(timeout);
	}
}

// Reserve stacks and runtime space. Sparse systems did not benefit in the paired runs, and on
// four cores the pool slowed first calculations below 10⁹ multiply-adds (docs/browser-engine.md).
export function useThreads({ rows, columns, memory }, force = false) {
	return (
		memory + 16 * 1024 ** 2 <= LIMITS.memory &&
		(force || (rows.length > columns.length && rows.length * columns.length ** 2 >= 1_000_000_000))
	);
}
