"""Export the 2011 EXIOBASE arrays as float64 Parquet rows for browser scenarios.

    uv run python export_browser.py --data /path/to/datasets --db /path/to/db.sqlite3 --out data/browser-engine

A rows and L columns are separate files, so a scenario reads just the
changed products. The manifest is written last. Generate into a new directory;
an existing manifest is refused to prevent mixing exports.
"""

import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from precompute import INDICATORS, SECTORS, embodied_flows

TOLERANCE = 1e-9


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


def write_matrix(path, matrix, rows_per_group=1):
    schema = pa.schema([("value", pa.float64())])
    with pq.ParquetWriter(path, schema, compression="gzip", use_dictionary=False) as writer:
        for start in range(0, len(matrix), rows_per_group):
            values = np.asarray(matrix[start : start + rows_per_group], dtype=np.float64).ravel()
            if not np.isfinite(values).all():
                raise ValueError(f"non-finite values in {path.name}")
            writer.write_table(pa.table({"value": values}))
    with path.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"shape": list(matrix.shape), "bytes": path.stat().st_size, "sha256": sha}


def write_row_matrix(directory, name, matrix):
    """Store bounded row files under the hash of their ordered SHA-256 digests."""
    staging = directory / name
    staging.mkdir()
    digest = hashlib.sha256()
    size = 0
    for index, row in enumerate(matrix):
        info = write_matrix(staging / f"{index}.parquet", row.reshape(1, -1))
        if info["bytes"] > 128 * 1024:
            raise ValueError("matrix row file exceeds the browser byte limit")
        digest.update(bytes.fromhex(info["sha256"]))
        size += info["bytes"]
    sha = digest.hexdigest()
    staging.rename(directory / f"{name}-{sha}")
    return {"shape": list(matrix.shape), "bytes": size, "sha256": sha, "storage": "rows"}


def verify_arrays(data, expected):
    for name, want in expected.items():
        with (data / "2011" / f"{name}_v4.npy").open("rb") as stream:
            got = hashlib.file_digest(stream, "sha256").hexdigest()
        if got != want:
            raise ValueError(f"{name} does not match the published EXIOBASE arrays")


def export(data, db, out):
    if any((out / name).exists() for name in ("manifest.json", "manifest-v2.json")):
        raise ValueError("output already has a manifest; use a new directory")
    reference = json.loads((Path(__file__).parent / "data" / "results.json").read_text(encoding="utf-8"))
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
    # This also checks that the 15 sections partition all 200 products.
    baseline = embodied_flows(B, X, INDICATORS, [p["leaves"] for p in sections])
    out.mkdir(parents=True, exist_ok=True)
    matrices = {"A": A, "L": L.T, "Y": Y, "X": X, "B": B[[i - 1 for i in INDICATORS]], "M": B @ L}
    files = {}
    for name, matrix in matrices.items():
        if name in {"A", "L"}:
            files[name] = write_row_matrix(out, name, matrix)
            print(f"{name}: {files[name]['bytes']} bytes", flush=True)
            continue
        files[name] = write_matrix(out / f"{name}.parquet", matrix, rows_per_group=128 if name in {"X", "Y"} else 1)
        (out / f"{name}.parquet").rename(out / f"{name}-{files[name]['sha256']}.parquet")
        print(f"{name}: {files[name]['bytes']} bytes", flush=True)
    metadata = {
        "version": 2,
        "products": 200,
        "countries": 49,
        "catalog": labels,
        "sections": sections,
        "indicators": INDICATORS,
        "files": files,
        "baseline_residual": float(residual),
        "baseline_flows": baseline.ravel().tolist(),
        "dataset": {"name": "EXIOBASE v3.3.sm", "year": 2011, "doi": "10.5281/zenodo.3533196", "license": "CC BY 4.0"},
    }
    (out / "manifest-v2.json").write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")
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
