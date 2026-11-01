import results from "../data/results.json" with { type: "json" };

// The hash pins the object to this build, so a data upload cannot change an older deployment.
const key = `embodied/${results.provenance.embodied.sha256}.parquet`;

// Cache API range reads slice a complete cached response without buffering it in JS.
async function shard(request, env) {
	const cache = caches.default;
	// the key drops the query string, so ?x=N cannot force a whole-shard fetch per request
	const url = new URL(request.url);
	url.search = "";
	const whole = new Request(url);
	const read = request.method === "HEAD" ? whole : new Request(url, { headers: request.headers });
	const hit = await cache.match(read);
	if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
	const response = await env.ASSETS.fetch(whole);
	if (response.status !== 200) return response;
	await cache.put(whole, response);
	const result = await cache.match(read);
	if (!result) return new Response("Data cache unavailable", { status: 503 });
	return request.method === "HEAD" ? new Response(null, result) : result;
}

// One byte range as R2 takes it, or null for a header this Worker refuses (several
// ranges, reversed, empty or too large). R2 itself would answer those with the whole file.
function parseRange(header) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (!match[1] && !match[2])) return null;
	const [first, last] = match.slice(1).map((v) => (v ? Number(v) : undefined));
	if (![first, last].every((v) => v === undefined || Number.isSafeInteger(v))) return null;
	if (first === undefined) return last > 0 ? { suffix: last } : null;
	if (last === undefined) return { offset: first };
	return last >= first ? { offset: first, length: last - first + 1 } : null;
}

// The first and last byte a range covers in an object of this size, or null past its end.
function span(range, size) {
	if (range.suffix !== undefined) return [Math.max(0, size - range.suffix), size - 1];
	if (range.offset >= size) return null;
	return [range.offset, Math.min(size, range.offset + (range.length ?? size)) - 1];
}

async function parquet(request, env) {
	const header = request.method === "GET" ? request.headers.get("Range") : null;
	// undefined: the whole file; null: a range this Worker refuses
	let range = header === null ? undefined : parseRange(header);
	const ifRange = request.headers.get("If-Range");
	// A ranged GET is one R2 read; HEAD, a refused range and If-Range need the object first.
	let object;
	if (request.method === "HEAD" || range === null || ifRange !== null) {
		object = await env.EMBODIED.head(key);
		if (!object) return new Response("Published data is missing", { status: 404 });
		// a range against an older ETag would mix two files' bytes, so it gets the whole file
		if (ifRange !== null && ifRange !== object.httpEtag) range = undefined;
	}
	if (request.method === "GET" && range !== null) {
		try {
			object = await env.EMBODIED.get(key, range ? { range } : {});
		} catch (e) {
			// R2 refuses a range that starts past the end; any other failure stays an error
			const info = range && (await env.EMBODIED.head(key));
			if (!info || span(range, info.size)) throw e;
			object = info;
		}
		if (!object) return new Response("Published data is missing", { status: 404 });
	}
	const headers = new Headers({
		"Accept-Ranges": "bytes",
		"Content-Type": "application/vnd.apache.parquet",
		"Cache-Control": "public, max-age=0, must-revalidate",
		"Cross-Origin-Resource-Policy": "same-origin",
		"X-Content-Type-Options": "nosniff",
		"X-Robots-Tag": "noindex",
		ETag: object.httpEtag,
	});
	const bytes = range === undefined ? [0, object.size - 1] : range && span(range, object.size);
	if (!bytes) {
		await object.body?.cancel();
		headers.set("Content-Range", `bytes */${object.size}`);
		return new Response(null, { status: 416, headers });
	}
	if (range !== undefined) headers.set("Content-Range", `bytes ${bytes[0]}-${bytes[1]}/${object.size}`);
	headers.set("Content-Length", String(bytes[1] - bytes[0] + 1));
	if (request.method === "HEAD") return new Response(null, { headers });
	return new Response(object.body, { status: range === undefined ? 200 : 206, headers });
}

export default {
	async fetch(request, env) {
		// the site lives under BASE_PATH (wrangler.jsonc); unset, it is at the root
		const base = env.BASE_PATH ?? "";
		const { pathname } = new URL(request.url);
		const path = pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : "";
		const isShard = /^\/data\/browser-engine\/store-[a-f0-9]{64}\//.test(path);
		if (!isShard && path !== "/data/embodied.parquet") return new Response(null, { status: 404 });
		if (!["GET", "HEAD"].includes(request.method))
			return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
		try {
			return await (isShard ? shard(request, env) : parquet(request, env));
		} catch {
			// an R2 or cache failure is worth a retry, unlike Cloudflare's own error page
			return new Response("Published data is unavailable", { status: 503, headers: { "Retry-After": "5" } });
		}
	},
};
