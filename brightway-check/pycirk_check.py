"""The same footprint through pycirk, which builds the input-output table itself.

    docker run --rm -v "$PYCIRK_DIR":/pycirk:ro -v "$DATASETS_DIR":/data:ro -v "$PWD":/check \\
        <python 3.9 image with pycirk's pins and git> python /check/pycirk_check.py \\
        --pycirk /pycirk --sut /pycirk/pycirk/data/mrSUT_V3.3.pkl --data /data --out /check/results/pycirk.json

EXIOBASE v3.3.sm is pycirk's own output: EXIOBASE v3.3's supply and use tables,
with secondary materials split out (make_secondary), turned into a product-by-product
table with the industry-technology assumption (method 0). This route rebuilds that
table from pycirk's SUT file (Zenodo 10.5281/zenodo.4695823, CC BY 4.0), so unlike the
other routes it checks how RaMa-Scene's A was made, not only the algebra on it.
The footprint uses pycirk's L with RaMa-Scene's GHG row of B, so both sides score
the same extension.

pycirk pins pandas 1.2.4, so this runs on Python 3.9 with pycirk's pins, outside
this folder's environment. It uses pycirk's own functions in the order its
Settings.transform_to_io calls them, without writing the cached IO pickle into
the pycirk checkout.
"""

import argparse
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from case import GHG_ROW, K, array


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pycirk", type=Path, required=True, help="pycirk checkout")
    ap.add_argument("--sut", type=Path, required=True, help="pycirk's mrSUT_V3.3.pkl")
    ap.add_argument("--data", type=Path, required=True, help="DATASETS_DIR with 2011/{A,B,L}_v4.npy")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    sys.path.insert(0, str(args.pycirk))
    from pycirk.make_secondary_flows import make_secondary
    from pycirk.transformation_methods import Transform

    t = time.perf_counter()
    sut = make_secondary(pd.read_pickle(args.sut))
    # pycirk's product index has 9 levels (region group EU/ROW, country_code, ..., code, name, synonym, unit)
    label = sut["V"].index.to_frame(index=False).iloc[K]
    assert (label["country_code"], label["code"]) == ("NL", "p26.d"), f"row {K} is {label.tolist()}"
    iot = Transform(sut).IOTpxpSTA_TCm()
    del sut
    elapsed = time.perf_counter() - t
    A, L = np.asarray(iot["A"]), np.asarray(iot["L"])
    del iot

    shipped_A = array(args.data, "A")
    if A.shape != shipped_A.shape:
        raise SystemExit(f"pycirk's A is {A.shape}, RaMa-Scene's {shipped_A.shape}")
    diff = np.abs(A - shipped_A)
    i, j = np.unravel_index(diff.argmax(), diff.shape)
    A_max = {"row": int(i), "col": int(j), "pycirk": float(A[i, j]), "A_file": float(shipped_A[i, j])}
    del shipped_A
    b = array(args.data, "B")[GHG_ROW]
    shipped_L = np.asarray(array(args.data, "L", mmap_mode="r")[:, K])
    score = float(b @ L[:, K])
    commit = subprocess.run(
        ["git", "-C", str(args.pycirk), "rev-parse", "HEAD"], capture_output=True, text=True, check=False
    ).stdout.strip()
    out = {
        "pycirk_commit": commit,
        "score": score,
        "unit": "kg CO2 eq",
        "L_column_max_abs_vs_L_file": float(np.abs(L[:, K] - shipped_L).max()),
        "A_max_abs_vs_A_file": float(diff[i, j]),
        "A_max_abs_at": A_max,
        "A_entries_differing_above_1e-12": int((diff > 1e-12).sum()),
        "build_s": elapsed,
        "peak_rss_gib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
    }
    # No tolerance gate: how closely pycirk reproduces the published table is the result.
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
