// Byte-range reads for the browser store and the embodied-flows Parquet file, with a
// stall timer and one retry.

// A range read fails, with that read named, once the data host has sent nothing for this
// long: to it or to any other read in this thread. The reads share one link, and on a
// slow one the host can starve a small range for over a minute while large ones flow.
const RANGE_TIMEOUT_MS = 60_000;
// when any read here last got its headers or a chunk of its body
let lastData = Number.NEGATIVE_INFINITY;

// The file on the server is not the size the caller asked for: another copy of it.
export class SizeMismatch extends Error {}

export async function fetchRange(url, start, end, byteLength, signal, timeoutMs = RANGE_TIMEOUT_MS) {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > byteLength)
		throw new Error("invalid matrix byte range");
	// every failure names its read, so a failed run says which file and range broke
	const where = `${new URL(url).pathname} bytes ${start}-${end - 1}`;
	for (let retried = false; ; retried = true) {
		const began = performance.now();
		let phase = "before the response";
		const stall = new AbortController();
		let timer;
		const wait = (ms = timeoutMs) => {
			clearTimeout(timer);
			const due = performance.now() + ms;
			timer = setTimeout(() => {
				const idle = performance.now() - lastData;
				// A timer this late means a calculation held the worker's thread, so data may
				// have arrived unread: wait again.
				if (performance.now() - due > 1000) wait();
				else if (idle < timeoutMs) wait(timeoutMs - idle);
				else stall.abort(new DOMException(`no data for ${timeoutMs} ms`, "TimeoutError"));
			}, ms);
		};
		try {
			wait();
			const response = await fetch(url, {
				headers: { Range: `bytes=${start}-${end - 1}` },
				signal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal,
			});
			lastData = performance.now();
			if (response.status === 404) {
				await response.body?.cancel();
				// The manifest names the store by its hash: next to the page, a 404 means a newer
				// deploy; on the data host, a store that was never uploaded, which hosting/check.js
				// catches before main promotes a version.
				throw new Error(`the browser data was updated: reload the page (${where})`);
			}
			if (response.status >= 500) {
				await response.body?.cancel();
				// The Worker answers a passing R2 or cache failure with 503; that is the host, not its setup.
				throw new Error(`the data host failed: try again (${where}, status ${response.status})`);
			}
			const total = response.headers.get("Content-Range")?.match(/\/(\d+)$/)?.[1];
			if (response.status === 416 || (response.status === 206 && total && Number(total) !== byteLength)) {
				await response.body?.cancel();
				throw new SizeMismatch(
					`browser scenario data needs a server with HTTP range support (${where}, status ${response.status})`,
				);
			}
			if (
				response.status !== 206 ||
				response.headers.get("Content-Range") !== `bytes ${start}-${end - 1}/${byteLength}`
			) {
				await response.body?.cancel();
				throw new Error(
					`browser scenario data needs a server with HTTP range support (${where}, status ${response.status})`,
				);
			}
			phase = "reading the body";
			const bytes = new Uint8Array(end - start);
			let length = 0;
			if (!response.body) throw new Error(`truncated matrix range (${where}, 0 bytes)`);
			const reader = response.body.getReader();
			for (;;) {
				wait();
				const { done, value } = await reader.read();
				if (done) break;
				lastData = performance.now();
				if (length + value.length > bytes.length) {
					await reader.cancel();
					throw new Error(`oversized matrix range (${where}, over ${bytes.length} bytes)`);
				}
				bytes.set(value, length);
				length += value.length;
			}
			if (length !== bytes.length) throw new Error(`truncated matrix range (${where}, ${length} bytes)`);
			return bytes.buffer;
		} catch (e) {
			// A read the read-ahead stopped keeps its AbortError. Any other fetch failure, an
			// AbortError the signal did not cause and the range's own timeout included, also says
			// when it failed.
			if (signal?.aborted || !(e instanceof TypeError || ["AbortError", "TimeoutError"].includes(e.name))) throw e;
			// One more try, on a fresh request: Firefox sometimes aborts a body read the page
			// never stopped, and the data host now and then leaves one request of a thousand
			// unanswered, or sends its headers and no body, while the others pass.
			if (!retried) continue;
			const ms = Math.round(performance.now() - began);
			throw new Error(
				`the browser data could not be read (${e.name}: ${e.message.trim()}; ${where}, ${phase}, after ${ms} ms${retried ? ", second try" : ""})`,
				{ cause: e },
			);
		} finally {
			clearTimeout(timer);
		}
	}
}
