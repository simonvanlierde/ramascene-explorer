export function browserClient() {
	let worker;
	let single;
	const pending = new Map();
	let next = 0;
	let stopped = false;
	// set when the worker script fails to load, so Try again would load it again in vain
	let outdated = false;
	const base = new URL("data/browser-engine/", document.baseURI).href;
	function start() {
		worker = new Worker(new URL("./browser-worker.js", import.meta.url), { type: "module" });
		const active = worker;
		worker.onmessage = ({ data: { id, value, error, fatal, retrySingle } }) => {
			if (active !== worker) return;
			const task = pending.get(id);
			if (!task) return;
			if (retrySingle) {
				retryOnOneThread();
				return;
			}
			clearTimeout(task.timeout);
			pending.delete(id);
			if (error) task.reject(new Error(error));
			else task.resolve(value);
			if (fatal) close();
		};
		worker.onerror = (event) => {
			if (active !== worker) return;
			// A script that throws sends an ErrorEvent. A plain Event means the script or one
			// of its imports did not load: after a deploy, the hashed file names this tab knows
			// are gone.
			outdated = !(event instanceof ErrorEvent);
			close(
				outdated
					? "The browser worker could not load. Reload the page; it may have been updated since you opened it."
					: undefined,
			);
		};
	}
	start();
	function retryOnOneThread() {
		if (single) {
			close();
			return;
		}
		worker.terminate();
		single = true;
		start();
		for (const [waiting, task] of pending) {
			// replayed requests get a full deadline on the new worker
			clearTimeout(task.timeout);
			task.timeout = task.arm();
			worker.postMessage({ id: waiting, base, body: task.body, single });
		}
	}
	function close(reason = "browser worker stopped") {
		stopped = true;
		worker.terminate();
		for (const task of pending.values()) {
			clearTimeout(task.timeout);
			task.reject(new Error(reason));
		}
		pending.clear();
	}
	return {
		close,
		get stopped() {
			return stopped;
		},
		get outdated() {
			return outdated;
		},
		// Starts the reads for a selection before Run; no reply.
		prefetch(body) {
			if (!stopped) worker.postMessage({ base, ahead: body.model_details });
		},
		request(body) {
			if (stopped) return Promise.reject(new Error("browser worker stopped"));
			const id = next++;
			return new Promise((resolve, reject) => {
				const task = { resolve, reject, body: structuredClone(body) };
				task.arm = () =>
					setTimeout(() => {
						// a trap in a pool thread leaves the call waiting, so a hang gets one try on one thread
						if (!single) {
							retryOnOneThread();
							return;
						}
						pending.delete(id);
						reject(new Error("browser computation timed out"));
						close();
					}, 120_000);
				task.timeout = task.arm();
				pending.set(id, task);
				worker.postMessage({ id, base, body: task.body, single });
			});
		},
	};
}
