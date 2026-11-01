export function browserClient() {
	let worker;
	let single;
	const pending = new Map();
	let next = 0;
	let stopped = false;
	const base = new URL("data/browser-engine/", document.baseURI).href;
	function start() {
		worker = new Worker(new URL("./browser-worker.js", import.meta.url), { type: "module" });
		const active = worker;
		worker.onmessage = ({ data: { id, value, error, fatal, retrySingle } }) => {
			if (active !== worker) return;
			const task = pending.get(id);
			if (!task) return;
			if (retrySingle) {
				if (single) {
					close();
					return;
				}
				worker.terminate();
				single = true;
				start();
				for (const [waiting, task] of pending) worker.postMessage({ id: waiting, base, body: task.body, single });
				return;
			}
			clearTimeout(task.timeout);
			pending.delete(id);
			if (error) task.reject(new Error(error));
			else task.resolve(value);
			if (fatal) close();
		};
		worker.onerror = () => {
			if (active === worker) close();
		};
	}
	start();
	function close() {
		stopped = true;
		worker.terminate();
		for (const task of pending.values()) {
			clearTimeout(task.timeout);
			task.reject(new Error("browser worker stopped"));
		}
		pending.clear();
	}
	return {
		close,
		request(body) {
			if (stopped) return Promise.reject(new Error("browser worker stopped; reload to try again"));
			const id = next++;
			return new Promise((resolve, reject) => {
				const parameters = structuredClone(body);
				const timeout = setTimeout(() => {
					pending.delete(id);
					reject(new Error("browser computation timed out; reload to try again"));
					close();
				}, 120_000);
				pending.set(id, { resolve, reject, timeout, body: parameters });
				worker.postMessage({ id, base, body: parameters, single });
			});
		},
	};
}
