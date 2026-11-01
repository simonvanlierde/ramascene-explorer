import results from "../data/results.json" with { type: "json" };

// The hash pins the object to this build, so a data upload cannot change an older deployment.
const key = `embodied/${results.provenance.embodied.sha256}.parquet`;

// Cache API range reads slice a complete cached response without buffering it in JS.
async function shard(request, env) {
	if (!["GET", "HEAD"].includes(request.method))
		return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
	const cache = caches.default;
	const read = request.method === "HEAD" ? new Request(request.url) : request;
	const hit = await cache.match(read);
	if (hit) return request.method === "HEAD" ? new Response(null, hit) : hit;
	const whole = new Request(request.url);
	const response = await env.ASSETS.fetch(whole);
	if (response.status !== 200) return response;
	await cache.put(whole, response);
	const result = await cache.match(read);
	if (!result) return new Response("Data cache unavailable", { status: 503 });
	return request.method === "HEAD" ? new Response(null, result) : result;
}

export default {
	async fetch(request, env) {
		if (/^\/data\/browser-engine\/store-[a-f0-9]{64}\//.test(new URL(request.url).pathname)) return shard(request, env);
		if (new URL(request.url).pathname !== "/data/embodied.parquet") return new Response(null, { status: 404 });
		if (!["GET", "HEAD"].includes(request.method))
			return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
		const object = await env.EMBODIED.head(key);
		if (!object) return new Response("Published data is missing", { status: 404 });
		const headers = new Headers({
			"Accept-Ranges": "bytes",
			"Content-Type": "application/vnd.apache.parquet",
			"Cache-Control": "public, max-age=0, must-revalidate",
			"Cross-Origin-Resource-Policy": "same-origin",
			"X-Content-Type-Options": "nosniff",
			"X-Robots-Tag": "noindex",
			ETag: object.httpEtag,
		});
		let start = 0;
		let end = object.size - 1;
		const range = request.method === "GET" ? request.headers.get("Range") : null;
		if (range !== null) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(range);
			if (match && (match[1] || match[2])) {
				start = match[1] ? Number(match[1]) : Math.max(0, object.size - Number(match[2]));
				end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
			}
			if (
				!match ||
				(!match[1] && !match[2]) ||
				!Number.isSafeInteger(Number(match[1] || match[2])) ||
				(!match[1] && Number(match[2]) === 0) ||
				start > end ||
				start >= object.size
			) {
				headers.set("Content-Range", `bytes */${object.size}`);
				return new Response(null, { status: 416, headers });
			}
			headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
		}
		headers.set("Content-Length", String(end - start + 1));
		if (request.method === "HEAD") return new Response(null, { headers });
		const body = await env.EMBODIED.get(key, { range: { offset: start, length: end - start + 1 } });
		if (!body) return new Response("Published data is missing", { status: 404 });
		return new Response(body.body, { status: range === null ? 200 : 206, headers });
	},
};
