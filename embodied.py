r"""Emissions embodied in final demand: producer country x section x consumer country.

    uv run python embodied.py "$DATASETS_DIR/2011" "$ENGINE_DIR/db.sqlite3" data/regions.json out.json

E[r, s, c] = sum over products p in section s of B[i, (r, p)] * (L . Y[:, c])[(r, p)],
from the same stored L, Y and B the engine uses. Rows are country-major
(country * 200 + product). Sections are the engine database's 15 level-2
product aggregates. Nothing is written unless every producer's flows sum to the
engine's own per-country value in data/regions.json, and the world total
matches, to relative 1e-9.

Prototype behind the map-first flows view; it moves into precompute.py, with
the same flows for every scenario, before the redesign ships.
"""

import json
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np

INDICATORS = {5: "GHG", 3: "Employment", 7: "Metal ores"}
COUNTRIES, PRODUCTS, SECTIONS = 49, 200, 15
REL_TOL = 1e-9


def main(data_dir, engine_db, regions_json, out):
    con = sqlite3.connect(f"file:{engine_db}?mode=ro", uri=True)
    sections = [
        (name, [int(x) for x in leaves.split("#") if x])
        for name, leaves in con.execute(
            "select name, leaf_children_local from ramascene_product where level = 2 order by global_id"
        )
    ]
    countries = [
        name for (name,) in con.execute("select name from ramascene_country where level = 3 order by local_id")
    ]
    if len(sections) != SECTIONS or sorted(p for _, ps in sections for p in ps) != list(range(PRODUCTS)):
        sys.exit("the sections do not partition the 200 products")
    if len(countries) != COUNTRIES:
        sys.exit(f"expected {COUNTRIES} countries, got {len(countries)}")

    B = np.load(data_dir / "B_v4.npy")
    Y = np.load(data_dir / "Y_v4.npy")
    L = np.load(data_dir / "L_v4.npy", mmap_mode="r")
    X = np.asarray(L @ Y)  # output each consumer's final demand needs, 9800 x 49

    engine = json.loads(regions_json.read_text())["results"]["baseline"]
    result = {"countries": countries, "sections": [n for n, _ in sections], "indicators": {}, "checks": {}}
    for gid, label in INDICATORS.items():
        E = (B[gid - 1][:, None] * X).reshape(COUNTRIES, PRODUCTS, COUNTRIES)
        flows = np.stack([E[:, ps, :].sum(axis=1) for _, ps in sections], axis=1)  # (49, 15, 49)
        producer = flows.sum(axis=(1, 2))
        reference = engine[str(gid)]
        worst = max(abs(producer[k] - reference[c]) / max(abs(reference[c]), 1e-9) for k, c in enumerate(countries))
        total_ok = math.isclose(flows.sum(), sum(reference.values()), rel_tol=REL_TOL)
        result["checks"][label] = {"producer_sums_vs_engine_max_rel": worst, "global_total_matches": total_ok}
        print(label, "worst producer-sum difference vs engine", worst, "world total ok", total_ok)
        if worst > REL_TOL or not total_ok:
            sys.exit(f"{label}: producer sums do not match the engine; nothing written")
        result["indicators"][label] = flows.tolist()
    out.write_text(json.dumps(result))
    print("wrote", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main(*map(Path, sys.argv[1:5]))
