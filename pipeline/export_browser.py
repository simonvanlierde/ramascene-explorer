"""Export the 2011 EXIOBASE arrays as a float32 Zarr v3 store for browser scenarios.

    uv run python pipeline/export_browser.py --data /path/to/datasets --db /path/to/db.sqlite3 --out data/browser-engine

Each array is sharded by producing country (200 rows per shard file) with one
gzip chunk per row, so a scenario reads just the rows it needs, a country's
rows in one range request. L is stored twice, as rows (L) and as columns (LC),
so the reader can take whichever of L[K, J] is smaller to fetch. H holds the flow totals of each L column: what the
page draws for one unit of that product's output. The manifest is written last.
Generate into a new directory; an existing manifest is refused to prevent
mixing exports.
"""

import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import numpy as np
import scipy.sparse as sp
import zarr
from zarr.codecs import BytesCodec, GzipCodec, ShardingCodec
from zarr.storage import LocalStore

from precompute import INDICATORS, SECTORS, embodied_flows

TOLERANCE = 1e-9
SHARD_ROWS = 200
# X and Y load a country's 200 rows at once, from one shard file each, so a
# scenario reads one shard index for them; the other arrays load single rows.
CHUNK_ROWS = {"X": 200, "Y": 200}


def catalog(db):
    with closing(sqlite3.connect(f"file:{db.resolve()}?immutable=1", uri=True)) as con:

        def listing(table):
            rows = con.execute(
                "SELECT global_id, name, identifier, local_id, leaf_children_local "  # noqa: S608
                f"FROM ramascene_{table} ORDER BY global_id"
            )
            return [
                {
                    "id": gid,
                    "name": name,
                    "final": kind == "FINALCONSUMPTION",
                    "leaves": [int(local) - 1]
                    if kind in {"LEAF", "FINALCONSUMPTION"}
                    else [int(x) for x in leaves.split("#")],
                }
                for gid, name, kind, local, leaves in rows
            ]

        return {"products": listing("product"), "regions": listing("country"), "consumers": listing("modellingproduct")}


def write_array(directory, name, matrix, chunk_rows=1, shard_rows=SHARD_ROWS):
    """Write one float32 array and describe it for the reader.

    Chunks are written in row order, so a shard's offsets rise with the row and
    neighbouring rows coalesce into one range. An all-zero chunk is stored as
    empty (offset and size 2**64 - 1), as the sharding spec allows.
    """
    values = np.asarray(matrix)
    if values.ndim != 2 or values.shape[0] % shard_rows or shard_rows % chunk_rows:  # noqa: PLR2004
        raise ValueError(f"{name} must have whole shards of {shard_rows} rows")
    if not np.isfinite(values).all():
        raise ValueError(f"non-finite values in {name}")
    with np.errstate(over="ignore"):
        single = values.astype(np.float32)
    if not np.isfinite(single).all():
        raise ValueError(f"{name} overflows float32")
    width = values.shape[1]
    array = zarr.create_array(
        LocalStore(directory),
        name=name,
        shape=values.shape,
        dtype="float32",
        chunks=(shard_rows, width),
        serializer=ShardingCodec(
            chunk_shape=(chunk_rows, width),
            codecs=[BytesCodec(), GzipCodec(level=9)],
            index_codecs=[BytesCodec()],
            subchunk_write_order="lexicographic",
        ),
        compressors=None,
        filters=None,
        fill_value=0,
    )
    for start in range(0, len(single), shard_rows):
        array[start : start + shard_rows] = single[start : start + shard_rows]
    shards = [directory / name / "c" / str(i) / "0" for i in range(len(values) // shard_rows)]
    # zarr writes no file for a shard of empty chunks, and the reader expects one per shard.
    if missing := [str(p) for p in shards if not p.exists()]:
        raise ValueError(f"{name} has all-zero shards: {missing}")
    sizes = [p.stat().st_size for p in shards]
    chunks = len(values) // chunk_rows
    stored = sum(sizes) - 16 * chunks
    return {
        "shape": list(values.shape),
        "chunk_rows": chunk_rows,
        "shard_rows": shard_rows,
        "shard_bytes": sizes,
        "chunk_bytes": stored / chunks,
    }


def flow_totals(B, L, section_leaves):
    """H = G L as rows: H[j] is the page's flows for one unit of L's column j.

    G sums B_i over the products of each section, per producing country, in the
    order the page keeps flows: indicator, producer, section.
    """
    rows = B.shape[1]
    products = sum(len(leaves) for leaves in section_leaves)
    countries = rows // products
    section = np.empty(products, int)
    for s, leaves in enumerate(section_leaves):
        section[leaves] = s
    group = (np.arange(rows) // products) * len(section_leaves) + section[np.arange(rows) % products]
    width = countries * len(section_leaves)
    G = sp.vstack(
        [sp.csr_matrix((B[k], (group, np.arange(rows))), shape=(width, rows)) for k in range(len(B))], format="csr"
    )
    return np.asarray((G @ L).T)


def store_hash(directory):
    """SHA-256 over every file's path and SHA-256, in path order."""
    digest = hashlib.sha256()
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        with path.open("rb") as stream:
            digest.update(path.relative_to(directory).as_posix().encode() + b"\0")
            digest.update(hashlib.file_digest(stream, "sha256").digest())
    return digest.hexdigest()


def verify_arrays(data, expected):
    for name, want in expected.items():
        with (data / "2011" / f"{name}_v4.npy").open("rb") as stream:
            got = hashlib.file_digest(stream, "sha256").hexdigest()
        if got != want:
            raise ValueError(f"{name} does not match the published EXIOBASE arrays")


def export(data, db, out):
    if any((out / name).exists() for name in ("manifest.json", "manifest-v2.json", "manifest-v3.json")):
        raise ValueError("output already has a manifest; use a new directory")
    results = Path(__file__).resolve().parent.parent / "data" / "results.json"
    reference = json.loads(results.read_text(encoding="utf-8"))
    verify_arrays(data, reference["provenance"]["dataset"]["sha256"])
    A, L, Y, B = (np.load(data / "2011" / f"{name}_v4.npy", mmap_mode="r") for name in ("A", "L", "Y", "B"))
    if A.shape != (9800, 9800) or L.shape != A.shape or Y.shape != (9800, 49) or B.shape != (60, 9800):
        raise ValueError("expected EXIOBASE v3.3.sm 2011 array dimensions")
    X = L @ Y
    residual = np.linalg.norm(X - A @ X - Y) / np.linalg.norm(Y)
    if not np.isfinite(residual) or residual > TOLERANCE:
        raise ValueError(f"the published inverse fails the baseline residual: {residual}")
    labels = catalog(db)
    sections = [next(p for p in labels["products"] if p["id"] == i) for i in SECTORS]
    leaves = [p["leaves"] for p in sections]
    # This also checks that the 15 sections partition all 200 products.
    baseline = embodied_flows(B, X, INDICATORS, leaves)
    H = flow_totals(B[[i - 1 for i in INDICATORS]], L, leaves)
    flows = (H.T @ Y).ravel()
    if np.max(np.abs(flows - baseline.ravel())) > TOLERANCE * np.max(np.abs(baseline)):
        raise ValueError("the flow totals do not reproduce the baseline flows")
    out.mkdir(parents=True, exist_ok=True)
    staging = out / "store"
    zarr.open_group(LocalStore(staging), mode="w-", zarr_format=3)
    arrays = {}
    for name, matrix in {"A": A, "L": L, "LC": L.T, "H": H, "X": X, "Y": Y}.items():
        arrays[name] = write_array(
            staging, name, matrix, CHUNK_ROWS.get(name, 1), len(matrix) if name in CHUNK_ROWS else SHARD_ROWS
        )
        print(f"{name}: {sum(arrays[name]['shard_bytes'])} bytes", flush=True)
    sha = store_hash(staging)
    staging.rename(out / f"store-{sha}")
    metadata = {
        "version": 3,
        "products": 200,
        "countries": 49,
        "catalog": labels,
        "sections": sections,
        "indicators": INDICATORS,
        "store": sha,
        "arrays": arrays,
        "baseline_residual": float(residual),
        "baseline_flows": baseline.ravel().tolist(),
        "dataset": {"name": "EXIOBASE v3.3.sm", "year": 2011, "doi": "10.5281/zenodo.3533196", "license": "CC BY 4.0"},
    }
    (out / "manifest-v3.json").write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    export(args.data, args.db, args.out)


if __name__ == "__main__":
    main()
