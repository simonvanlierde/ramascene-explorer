"""The same footprint through pymrio, which computes its own Leontief inverse.

    uv run python pymrio_check.py --data "$DATASETS_DIR" --out results/pymrio.json

pymrio cannot read EXIOBASE v3.3.sm directly: its Zenodo record holds RaMa-Scene's
numpy arrays, and parse_exiobase3 reads the text release. So the IOSystem is built
from A, B's GHG row and a Y with a single 1 (M EUR) at NL cement, consumed in NL.
calc_all then computes x, Z, L and the accounts itself.
"""

import argparse
import json
import resource
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pymrio

from build_db import GHG_ROW

NL_LOCAL, CEMENT_LOCAL = 20, 100  # 0-based, region-major: row 4100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True, help="DATASETS_DIR with 2011/{A,B,L}_v4.npy")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    data = args.data / "2011"
    k = NL_LOCAL * 200 + CEMENT_LOCAL

    regions = [f"R{r:02d}" for r in range(49)]
    idx = pd.MultiIndex.from_product([regions, [f"S{s:03d}" for s in range(200)]], names=["region", "sector"])
    y = np.zeros((9800, 49))
    y[k, NL_LOCAL] = 1.0
    io = pymrio.IOSystem(
        A=pd.DataFrame(np.load(data / "A_v4.npy"), index=idx, columns=idx),
        Y=pd.DataFrame(y, index=idx, columns=pd.MultiIndex.from_product([regions, ["final demand"]])),
    )
    ghg = pd.Index(["GHG emissions: Total"], name="stressor")
    b = np.load(data / "B_v4.npy")[GHG_ROW]
    io.ghg = pymrio.Extension(
        name="ghg",
        S=pd.DataFrame(b[None, :], index=ghg, columns=idx),
        unit=pd.DataFrame({"unit": ["kg CO2 eq"]}, index=ghg),
    )
    t = time.perf_counter()
    io.calc_all()
    elapsed = time.perf_counter() - t

    score = float(io.ghg.D_cba.to_numpy().sum())
    shipped = np.asarray(np.load(data / "L_v4.npy", mmap_mode="r")[:, k])
    out = {
        "pymrio": pymrio.__version__,
        "score_D_cba": score,
        "unit": "kg CO2 eq",
        "numpy_L_file": float(b @ shipped),
        "relative_difference_vs_L_file": abs(score - b @ shipped) / abs(b @ shipped),
        "L_column_max_abs_vs_L_file": float(np.abs(io.L.to_numpy()[:, k] - shipped).max()),
        "calc_all_s": elapsed,
        "peak_rss_gib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
    }
    # pymrio inverts the full A, so it must match the shipped L to rounding
    if out["relative_difference_vs_L_file"] > 1e-10:
        raise SystemExit(f"pymrio vs L file is {out['relative_difference_vs_L_file']:.1e}, above 1e-10")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
