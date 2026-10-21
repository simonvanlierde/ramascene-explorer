"""Write EXIOBASE v3.3.sm (RaMa-Scene arrays, 2011) into a Brightway project.

    cp "$RAMASCENE_DIR/db.sqlite3" /tmp/ramascene-db.sqlite3
    BRIGHTWAY2_DIR=$PWD/bwdir uv run python build_db.py \\
        --data "$DATASETS_DIR" --db /tmp/ramascene-db.sqlite3

No bw2io importer runs here: Exiobase3MonetaryImporter reads the official
EXIOBASE 3.7+ text release (A.txt, x.txt, unit.txt, satellite/S.txt) and maps
its stressors onto ecoinvent's biosphere3. The RaMa-Scene arrays are numpy
files with 60 already-aggregated extension rows. This script therefore feeds A
and B directly into the backend the importer ends in (bw2data's IOTableBackend:
nodes in SQLite, edges straight into a bw_processing datapackage).

Technosphere: -a_ij for i != j (flip=True on a_ij) and 1 - a_ii on the diagonal,
i.e. the matrix I - A with one unit (1 M EUR) of output per activity.
Biosphere: the 60 rows of B, one flow per row, amounts per M EUR of output.
Method: CF = 1 on the "GHG emissions: Total" flow (B row 4, kg CO2 eq), since
that row is already characterised in the dataset.
"""

import argparse
import json
import resource
import sqlite3
import time
from pathlib import Path

import numpy as np

PROJECT = "exiobase-brightway-bridge"
DB = "EXIOBASE v3.3.sm 2011 monetary"
BIO = "EXIOBASE v3.3.sm 2011 extensions"
METHOD = ("EXIOBASE v3.3.sm", "GHG emissions: Total", "as aggregated in dataset")
GHG_ROW = 4  # indicator global_id 5 in the RaMa-Scene db; the engine reads B[global_id - 1]
THRESHOLD = 1e-15  # the same "small balancing correction" floor bw2io's EXIOBASE extractor drops


def labels(db_path):
    """Leaf products (200) and countries (49) in matrix order, from a copy of RaMa-Scene's db.sqlite3.

    Row index = country_local * 200 + product_local (0-based), region-major, as the engine
    reshapes B.L.y into (countries, products).
    """
    c = sqlite3.connect(db_path)
    q = "select local_id, name, code from ramascene_{} where identifier='LEAF' order by local_id"
    products = c.execute(q.format("product")).fetchall()
    countries = c.execute(q.format("country")).fetchall()
    indicators = c.execute("select global_id, name, unit from ramascene_indicator order by global_id").fetchall()
    assert [p[0] for p in products] == list(range(1, 201))
    assert [r[0] for r in countries] == list(range(1, 50))
    return products, countries, indicators


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True, help="DATASETS_DIR with 2011/{A,B}_v4.npy")
    ap.add_argument("--db", type=Path, required=True, help="a COPY of RaMa-Scene's db.sqlite3")
    ap.add_argument("--out", type=Path, default=Path("results/build.json"))
    args = ap.parse_args()

    import bw2data as bd
    from bw2data.backends.iotable import IOTableBackend

    t0 = time.perf_counter()
    products, countries, indicators = labels(args.db)
    B = np.load(args.data / "2011" / "B_v4.npy")
    assert B.shape[0] == 60
    indicators = indicators[: B.shape[0]]
    assert indicators[GHG_ROW][1] == "GHG emissions: Total"

    if PROJECT in bd.projects:
        bd.projects.delete_project(PROJECT, delete_dir=True)
    bd.projects.set_current(PROJECT)
    bd.geomapping.add([code for _, _, code in countries])

    bio = bd.Database(BIO)
    bio.register(format="RaMa-Scene B_v4.npy rows")
    bio.write(
        {
            (BIO, f"B{row}"): {
                "name": name,
                "unit": unit,
                "categories": ("air",) if row == GHG_ROW else ("other",),
                "type": "emission",
                "exchanges": [],
                "ramascene_indicator_global_id": gid,
            }
            for row, (gid, name, unit) in enumerate(indicators)
        }
    )

    db = IOTableBackend(DB)
    db.register(format="RaMa-Scene A_v4.npy, EXIOBASE v3.3.sm pxp 2011")
    db.write(
        {
            (DB, f"{ccode}|{pcode}"): {
                "name": pname,
                "reference product": pname,
                "location": ccode,
                "unit": "million euro",
                "type": "process",
                "exchanges": [],
                "matrix_index": (ci - 1) * 200 + (pi - 1),
            }
            for ci, _, ccode in countries
            for pi, pname, pcode in products
        }
    )
    ids = np.empty(9800, dtype=np.int64)
    for act in db:
        ids[act["matrix_index"]] = act.id
    t_meta = time.perf_counter() - t0

    # Technosphere, row block by row block, so the dense 9800x9800 A never sits in memory twice.
    A = np.load(args.data / "2011" / "A_v4.npy", mmap_mode="r")
    rows, cols, vals, flips = [], [], [], []
    nnz_total = dropped = 0
    mass_total = mass_dropped = 0.0
    diag = np.zeros(9800)
    for start in range(0, 9800, 700):
        blk = np.asarray(A[start : start + 700])
        r, c = np.nonzero(blk)
        v = blk[r, c]
        r += start
        nnz_total += v.size
        mass_total += np.abs(v).sum()
        small = np.abs(v) < THRESHOLD
        dropped += int(small.sum())
        mass_dropped += float(np.abs(v[small]).sum())
        r, c, v = r[~small], c[~small], v[~small]
        on_diag = r == c
        diag[r[on_diag]] = v[on_diag]
        r, c, v = r[~on_diag], c[~on_diag], v[~on_diag]
        rows.append(ids[r])
        cols.append(ids[c])
        vals.append(v)
        flips.append(np.ones(v.size, bool))
    rows.append(ids)
    cols.append(ids)
    vals.append(1.0 - diag)
    flips.append(np.zeros(9800, bool))
    del A

    tech_idx = np.empty(sum(x.size for x in vals), dtype=[("row", np.int64), ("col", np.int64)])
    tech_idx["row"], tech_idx["col"] = np.concatenate(rows), np.concatenate(cols)
    technosphere = {"indices_array": tech_idx, "data_array": np.concatenate(vals), "flip_array": np.concatenate(flips)}
    del rows, cols, vals, flips

    bio_ids = np.array([bd.get_node(database=BIO, code=f"B{row}").id for row in range(B.shape[0])])
    br, bc = np.nonzero(B)
    bio_idx = np.empty(br.size, dtype=[("row", np.int64), ("col", np.int64)])
    bio_idx["row"], bio_idx["col"] = bio_ids[br], ids[bc]
    biosphere = {"indices_array": bio_idx, "data_array": B[br, bc], "flip_array": np.zeros(br.size, bool)}

    t1 = time.perf_counter()
    db.write_exchanges(technosphere, biosphere, [BIO])
    t_write = time.perf_counter() - t1

    m = bd.Method(METHOD)
    m.register(unit="kg CO2 eq", description="CF 1 on RaMa-Scene's aggregated GHG row (B row 4)")
    m.write([((BIO, f"B{GHG_ROW}"), 1.0)])

    size = sum(f.stat().st_size for f in Path(bd.projects.dir).rglob("*") if f.is_file())
    print(f"activities {len(db)}, biosphere flows {len(bio)}")
    print(
        f"A nonzeros {nnz_total} (density {nnz_total / 9800**2:.4f}); dropped |a|<{THRESHOLD}: {dropped}, "
        f"abs mass dropped {mass_dropped:.3e} of {mass_total:.6e} (share {mass_dropped / mass_total:.3e})"
    )
    print(f"technosphere entries written {tech_idx.size}, biosphere entries {bio_idx.size}")
    print(f"metadata {t_meta:.1f} s, datapackage write {t_write:.1f} s, project dir {size / 2**20:.1f} MiB")
    out = {
        "activities": len(db),
        "biosphere_flows": len(bio),
        "threshold": THRESHOLD,
        "A_nonzeros": nnz_total,
        "A_density": nnz_total / 9800**2,
        "A_dropped": dropped,
        "A_abs_share_dropped": mass_dropped / mass_total,
        "technosphere_entries": int(tech_idx.size),
        "biosphere_entries": int(bio_idx.size),
        "project_dir_mib": size / 2**20,
        "timings_s": {"metadata": t_meta, "datapackage_write": t_write, "total": time.perf_counter() - t0},
        "peak_rss_gib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
