import { parquetMetadataAsync, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";

export async function matrixReader(file, shape, { cacheBytes = 16 * 1024 ** 2 } = {}) {
	if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 0) throw new Error("invalid matrix cache budget");
	const metadata = await parquetMetadataAsync(file);
	const [height, width] = shape;
	if (metadata.row_groups.length !== height || metadata.row_groups.some((g) => Number(g.num_rows) !== width))
		throw new Error("matrix row groups do not match the manifest");
	const cache = new Map();
	const pending = new Map();
	let retained = 0;
	return (index) => {
		if (!Number.isInteger(index) || index < 0 || index >= height) throw new Error("invalid matrix row");
		if (cache.has(index)) {
			const value = cache.get(index);
			cache.delete(index);
			cache.set(index, value);
			return Promise.resolve(value);
		}
		if (!pending.has(index)) {
			const loading = (async () => {
				const values = new Float64Array(width);
				let count = 0;
				await parquetRead({
					file,
					metadata,
					compressors,
					columns: ["value"],
					rowStart: index * width,
					rowEnd: (index + 1) * width,
					onChunk: ({ rowStart, columnData }) => {
						values.set(columnData, rowStart - index * width);
						count += columnData.length;
					},
				});
				if (count !== width || !values.every(Number.isFinite)) throw new Error("invalid matrix values");
				if (values.byteLength <= cacheBytes) {
					while (retained + values.byteLength > cacheBytes) {
						const oldest = cache.keys().next().value;
						retained -= cache.get(oldest).byteLength;
						cache.delete(oldest);
					}
					cache.set(index, values);
					retained += values.byteLength;
				}
				return values;
			})().finally(() => pending.delete(index));
			pending.set(index, loading);
		}
		return pending.get(index);
	};
}

// openFile is injected for local parity tests. Browser calls stay on this
// data directory; the manifest cannot redirect a matrix to another origin.
export async function openEngine(meta, openFile) {
	if (
		meta.version !== 1 ||
		meta.products !== 200 ||
		meta.countries !== 49 ||
		!Number.isFinite(meta.baseline_residual) ||
		meta.baseline_residual > 1e-9
	)
		throw new Error("unsupported browser dataset");
	for (const [name, shape] of Object.entries({
		A: [9800, 9800],
		L: [9800, 9800],
		Y: [9800, 49],
		X: [9800, 49],
		B: [3, 9800],
		M: [60, 9800],
	})) {
		const info = meta.files?.[name];
		if (
			JSON.stringify(info?.shape) !== JSON.stringify(shape) ||
			!/^[a-f0-9]{64}$/.test(info?.sha256) ||
			!Number.isSafeInteger(info.bytes) ||
			info.bytes <= 0
		)
			throw new Error(`invalid ${name} matrix manifest`);
	}
	const readers = new Map();
	async function row(name, index) {
		if (!["A", "L", "M"].includes(name))
			throw new Error("matrix rows are available for A, L and M; use X, Y or B directly");
		if (!readers.has(name))
			readers.set(
				name,
				(async () => matrixReader(await openFile(name), meta.files[name].shape))().catch((e) => {
					readers.delete(name);
					throw e;
				}),
			);
		return (await readers.get(name))(index);
	}
	const all = async (name) => {
		const remote = await openFile(name);
		const buffer = await remote.slice(0, remote.byteLength);
		const file = { byteLength: buffer.byteLength, slice: (a, b) => buffer.slice(a, b) };
		const [height, width] = meta.files[name].shape;
		const metadata = await parquetMetadataAsync(file);
		if (Number(metadata.num_rows) !== height * width) throw new Error("invalid matrix dimensions");
		const values = new Float64Array(height * width);
		let count = 0;
		// Bound decoding so intermediate column buffers can be released between batches.
		for (let start = 0; start < height; start += 128) {
			await parquetRead({
				file,
				metadata,
				compressors,
				columns: ["value"],
				rowStart: start * width,
				rowEnd: Math.min(start + 128, height) * width,
				onChunk: ({ rowStart, columnData }) => {
					values.set(columnData, rowStart);
					count += columnData.length;
				},
			});
		}
		if (count !== values.length || !values.every(Number.isFinite)) throw new Error("invalid matrix values");
		return Array.from({ length: height }, (_, r) => values.subarray(r * width, (r + 1) * width));
	};
	const [X, Y, B] = await Promise.all([all("X"), all("Y"), all("B")]);
	return { meta, row, X, Y, B };
}

export async function fetchEngine(base) {
	const response = await fetch(new URL("manifest.json", base));
	if (!response.ok) throw new Error(`browser dataset: ${response.status}`);
	const meta = await response.json();
	return openEngine(meta, (name) =>
		rangeFile(new URL(`${name}-${meta.files[name].sha256}.parquet`, base), meta.files[name].bytes),
	);
}

export function rangeFile(url, byteLength) {
	return {
		byteLength,
		async slice(start, end = byteLength) {
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > byteLength)
				throw new Error("invalid matrix byte range");
			const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
			if (
				response.status !== 206 ||
				response.headers.get("Content-Range") !== `bytes ${start}-${end - 1}/${byteLength}`
			) {
				await response.body?.cancel();
				throw new Error("browser scenario data needs a server with HTTP range support");
			}
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength !== end - start) throw new Error("truncated matrix range");
			return buffer;
		},
	};
}

export function outputFlows(data, X) {
	const { countries: C, products: P, sections, indicators } = data.meta;
	const S = sections.length;
	const out = new Float64Array(indicators.length * C * S * C);
	for (let i = 0; i < indicators.length; i++)
		for (let p = 0; p < C; p++)
			for (let s = 0; s < S; s++)
				for (const product of sections[s].leaves) {
					const row = p * P + product;
					for (let c = 0; c < C; c++) out[((i * C + p) * S + s) * C + c] += data.B[i][row] * X[row * C + c];
				}
	return out;
}
