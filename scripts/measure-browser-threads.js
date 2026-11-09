// Browser diagnostics against an isolated local build. Run under the quiet gate on pinned CPUs.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { chromium } from "@playwright/test";

const origin = process.argv[2] ?? "http://127.0.0.1:4193/";
const output = process.argv[3];
const repetitions = Number(process.argv[4] ?? 3);
// "threshold" times one thread against a forced pool on dense cases around useThreads' bound
const threshold = process.argv[5] === "threshold";
const limits = process.argv[5] && !threshold ? process.argv[5].split(",").map(Number) : undefined;
if (limits) assert.ok(limits.every((n) => Number.isInteger(n) && n >= 1 && n <= 16));
const worker = new URL(`assets/${readdirSync("dist/assets").find((f) => /^browser-worker-.*\.js$/.test(f))}`, origin)
	.href;
const dense = (product, originReg, consumedBy, consumedReg) => ({
	product: [product],
	originReg: [originReg],
	consumedBy: [consumedBy],
	consumedReg: [consumedReg],
	techChange: [-20],
});
// rows × columns² multiply-adds of the main product, from plan()
const graded = {
	"2.0e7": dense(16, 1, 7, 2),
	"5.0e7": dense(17, 1, 11, 1),
	"1.0e8": dense(48, 2, 9, 1),
	"3.4e8": dense(48, 1, 1, 2),
	"1.4e9": dense(5, 1, 1, 2),
	"4.8e9": dense(5, 1, 5, 1),
};
const cases = threshold
	? graded
	: {
			default: { product: [180], originReg: [1], consumedBy: [198], consumedReg: [2], techChange: [-20] },
			"electricity to manufacturing": {
				product: [6],
				originReg: [1],
				consumedBy: [4],
				consumedReg: [1],
				techChange: [-20],
			},
			"manufacturing to electricity": {
				product: [5],
				originReg: [1],
				consumedBy: [5],
				consumedReg: [1],
				techChange: [-20],
			},
		};

// Process-tree RSS includes shared mappings more than once; compare like-for-like browser trees.
function rss(pid) {
	try {
		const status = readFileSync(`/proc/${pid}/status`, "utf8");
		const own = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
		const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
		return own + (children ? children.split(/\s+/).reduce((sum, child) => sum + rss(child), 0) : 0);
	} catch {
		return 0;
	}
}
const samples = [];
for (let pair = -1; pair < repetitions; pair++) {
	for (const [name, step] of Object.entries(cases)) {
		if (limits && name !== "manufacturing to electricity") continue;
		let reference;
		const order = limits ? limits.slice() : [1, 4];
		if (pair % 2) order.reverse();
		for (const count of order) {
			const single = count === 1;
			const server = await chromium.launchServer({ headless: true });
			const browser = await chromium.connect(server.wsEndpoint());
			let peak = 0;
			const poll = setInterval(() => {
				peak = Math.max(peak, rss(server.process().pid));
			}, 25);
			try {
				const page = await browser.newPage();
				if (limits && !single) {
					await page.route("**/assets/browser-worker-*.js", async (route) => {
						const response = await route.fetch();
						const body = await response.text();
						const cap = /Math\.min\(4,Math\.max\(1,/g;
						assert.equal([...body.matchAll(cap)].length, 1, "expected one thread cap in worker bundle");
						await route.fulfill({ response, body: body.replace(cap, `Math.min(${count},Math.max(1,`) });
					});
				}
				await page.goto(origin);
				const trial = await page.evaluate(
					async ({ worker, origin, step, single }) => {
						if (!crossOriginIsolated) throw new Error("thread measurements need cross-origin isolation");
						const w = new Worker(worker, { type: "module" });
						const call = (body) =>
							new Promise((resolve, reject) => {
								const deadline = setTimeout(() => reject(new Error("measurement exceeded 90 seconds")), 90_000);
								w.onmessage = ({ data }) => {
									// computing messages only mark a threaded kernel call's start and end
									if ("computing" in data) return;
									clearTimeout(deadline);
									if (data.error || data.retrySingle) reject(new Error(data.error ?? "thread pool failed"));
									else resolve(data.value);
								};
								w.onerror = (e) => {
									clearTimeout(deadline);
									reject(new Error(e.message));
								};
								w.postMessage({ id: 1, base: new URL("data/browser-engine/", origin).href, body, single });
							});
						try {
							await call();
							const first = await call({ model_details: [step] });
							const warm = await call({ model_details: [step] });
							return {
								threads: first.threads,
								cold_s: first.duration_s,
								warm_s: warm.duration_s,
								flows: Array.from(first.result.flows.scenario),
							};
						} finally {
							w.terminate();
						}
					},
					{ worker, origin, step, single: single ? true : threshold ? false : undefined },
				);
				if (threshold) assert.ok(single ? trial.threads === 1 : trial.threads > 1, `${name}: ${trial.threads} threads`);
				else assert.equal(trial.threads, !single && name === "manufacturing to electricity" ? count : 1);
				if (reference) {
					const scale = Math.max(...reference.map(Math.abs));
					const error = Math.max(...trial.flows.map((v, i) => Math.abs(v - reference[i]))) / scale;
					assert.ok(error <= 1e-8, `threaded flow difference ${error}`);
				} else reference = trial.flows;
				delete trial.flows;
				if (pair >= 0) samples.push({ pair, name, single, ...trial, peak_tree_rss_kib: peak });
				console.log(JSON.stringify({ warmup: pair < 0, pair, name, single, ...trial, peak_tree_rss_kib: peak }));
			} finally {
				clearInterval(poll);
				await browser.close();
				await server.close();
			}
		}
	}
}
if (output)
	writeFileSync(
		output,
		`${JSON.stringify(
			{
				date: new Date().toISOString(),
				cpu: cpus()[0].model,
				affinity: /Cpus_allowed_list:\s+(.+)/.exec(readFileSync("/proc/self/status", "utf8"))?.[1],
				limits,
				mode: threshold ? "threshold" : undefined,
				container: "mcr.microsoft.com/playwright:v1.64.1-noble",
				browser: chromium.executablePath().split("/").at(-3),
				method:
					"one unrecorded warm-up pair per case, then paired fresh Chromium process trees; cold and repeated scenario including reads, alternating order, RSS sampled every 25 ms and includes repeated shared mappings",
				samples,
			},
			null,
			2,
		)}\n`,
	);
