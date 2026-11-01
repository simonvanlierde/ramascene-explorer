export function browserClient() {
	const worker = new Worker(new URL("./browser-worker.js", import.meta.url), { type: "module" });
	const pending = new Map();
	let next = 0;
	let stopped = false;
	const base = new URL("data/browser-engine/", document.baseURI).href;
	worker.onmessage = ({ data: { id, value, error, fatal } }) => {
		const task = pending.get(id);
		if (!task) return;
		clearTimeout(task.timeout);
		pending.delete(id);
		if (error) task.reject(new Error(error));
		else task.resolve(value);
		if (fatal) close();
	};
	function close() {
		stopped = true;
		worker.terminate();
		for (const task of pending.values()) {
			clearTimeout(task.timeout);
			task.reject(new Error("browser worker stopped"));
		}
		pending.clear();
	}
	worker.onerror = close;
	return {
		close,
		get stopped() {
			return stopped;
		},
		// Starts the reads for a selection before Run; no reply.
		prefetch(body) {
			if (!stopped) worker.postMessage({ base, ahead: body.model_details });
		},
		request(body) {
			if (stopped) return Promise.reject(new Error("browser worker stopped"));
			const id = next++;
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					pending.delete(id);
					reject(new Error("browser computation timed out"));
					close();
				}, 120_000);
				pending.set(id, { resolve, reject, timeout });
				worker.postMessage({ id, base, body });
			});
		},
	};
}
