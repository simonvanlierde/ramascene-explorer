"""One product LCA in Brightway, checked against plain numpy on the same arrays.

    BRIGHTWAY2_DIR=$PWD/bwdir uv run python lca.py --data "$DATASETS_DIR" --out results/lca.json

Functional unit: 1 M EUR of final demand for "Cement, lime and plaster" (p26.d)
produced in the Netherlands. Score: GHG emissions: Total, kg CO2 eq.
"""

import argparse
import json
import resource
import time
from pathlib import Path

import numpy as np

from build_db import DB, METHOD, PROJECT, THRESHOLD
from case import GHG_ROW, K, array

CODE = "NL|p26.d"


def rss_gib():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20


def rel(a, b):
    return abs(a - b) / abs(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    out = {
        "functional_unit": "1 M EUR final demand, Cement, lime and plaster (p26.d), NL, 2011",
        "unit": "kg CO2 eq",
        "timings_s": {},
        "peak_rss_gib_after": {},
    }

    import bw2calc as bc
    import bw2data as bd

    bd.projects.set_current(PROJECT)
    act = bd.get_node(database=DB, code=CODE)
    k = act["matrix_index"]
    assert k == K, f"{CODE} is at matrix index {k}, not {K}"
    out["activity"] = {"name": act["name"], "location": act["location"], "matrix_index": k}

    t = time.perf_counter()
    fu, data_objs, remapping = bd.prepare_lca_inputs({act: 1}, method=METHOD)
    lca = bc.LCA(fu, data_objs=data_objs, remapping_dicts=remapping)
    lca.lci()
    t_lci = time.perf_counter() - t
    lca.lcia()
    out["brightway"] = float(lca.score)
    out["timings_s"]["brightway_lci_lcia"] = time.perf_counter() - t
    out["timings_s"]["brightway_lci"] = t_lci
    out["brightway_matrix"] = {
        "technosphere_nnz": int(lca.technosphere_matrix.nnz),
        "shape": list(lca.technosphere_matrix.shape),
        "solver": "pypardiso" if bc.PYPARDISO else "scipy.sparse.linalg.spsolve (SuperLU)",
    }
    # Brightway's own index order -> the RaMa-Scene row order, for a vector comparison
    order = np.empty(9800, dtype=np.int64)
    for node_id, col in lca.dicts.activity.items():
        order[bd.get_node(id=node_id)["matrix_index"]] = col
    x_bw = np.asarray(lca.supply_array)[order]
    out["peak_rss_gib_after"]["brightway"] = rss_gib()
    del lca, data_objs

    B = array(args.data, "B")
    b = B[GHG_ROW]
    A = array(args.data, "A")
    y = np.zeros(9800)
    y[k] = 1.0

    t = time.perf_counter()
    IA = -A
    IA[np.diag_indices(9800)] += 1.0
    x_full = np.linalg.solve(IA, y)
    out["numpy_solve_full_A"] = float(b @ x_full)
    out["timings_s"]["numpy_solve_full_A"] = time.perf_counter() - t
    out["residual_full_A"] = float(np.abs(IA @ x_full - y).max())

    # the same entries the Brightway build dropped (a dropped a_ii leaves a diagonal of 1)
    small = (np.abs(A) < THRESHOLD) & (A != 0)
    IA[small] = 0.0
    d = np.diag(A)
    IA[np.diag_indices(9800)] = 1.0 - np.where(np.diag(small), 0.0, d)
    del small
    x_cut = np.linalg.solve(IA, y)
    out["numpy_solve_cutoff_A"] = float(b @ x_cut)
    del IA, A
    out["peak_rss_gib_after"]["numpy_solve"] = rss_gib()

    L = array(args.data, "L", mmap_mode="r")
    x_L = np.asarray(L[:, k])
    out["numpy_L_file"] = float(b @ x_L)
    del L

    out["relative_differences"] = {
        "brightway_vs_numpy_full_A": rel(out["brightway"], out["numpy_solve_full_A"]),
        "brightway_vs_numpy_cutoff_A": rel(out["brightway"], out["numpy_solve_cutoff_A"]),
        "numpy_full_A_vs_L_file": rel(out["numpy_solve_full_A"], out["numpy_L_file"]),
        "brightway_vs_L_file": rel(out["brightway"], out["numpy_L_file"]),
        "supply_vector_max_abs_bw_vs_full_A": float(np.abs(x_bw - x_full).max()),
        "supply_vector_max_abs_full_A_vs_L_file": float(np.abs(x_full - x_L).max()),
    }
    rd = out["relative_differences"]
    # Same matrix both ways, and L is the inverse of the full A: anything above
    # rounding means a wrong build or a wrong index, not a cut-off effect.
    for key in ("brightway_vs_numpy_cutoff_A", "numpy_full_A_vs_L_file"):
        if rd[key] > 1e-10:
            raise SystemExit(f"{key} is {rd[key]:.1e}, above 1e-10")
    top = np.argsort(-(b * x_full))[:5]
    out["top5_contributions_full_A"] = [{"matrix_index": int(i), "kg_co2_eq": float(b[i] * x_full[i])} for i in top]
    out["peak_rss_gib"] = rss_gib()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
