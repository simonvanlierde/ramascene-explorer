// The decoded runs the page keeps, least recently used first out. A decoded run is about
// 864 KB (3 × 49 × 15 × 49 float64); keeping all 155 would hold 135 MB on a phone. The
// baseline is kept apart, and a dropped run is one range read away.

// read: (run) => Promise of the run. Returns get(run), which reads each run once while it stays
// among the `size` most recently asked for.
export function runCache(read, size) {
	const cache = new Map();
	return (run) => {
		if (cache.has(run)) {
			// most recent last, so the first key is the one to drop
			const hit = cache.get(run);
			cache.delete(run);
			cache.set(run, hit);
		} else {
			if (cache.size >= size) cache.delete(cache.keys().next().value);
			// a failed read leaves the cache, unless an evicted read failed after a fresh one took its place
			const reading = read(run).catch((e) => {
				if (cache.get(run) === reading) cache.delete(run);
				throw e;
			});
			cache.set(run, reading);
		}
		return cache.get(run);
	};
}
