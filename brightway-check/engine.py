"""The same footprint through RaMa-Scene's own engine (Analyze.route_one), without Celery.

    uv run --project .. python engine.py \\
        --engine "$RAMASCENE_DIR" --data "$DATASETS_DIR" --out results/engine.json

Run it with the explorer's environment (--project ..), as precompute.py runs,
not this folder's. The engine adapter (setup_django, run_route, reference_validation,
engine_revision) is the explorer's own, imported from ../precompute.py. Final
demand is a 9800x49 matrix with a single 1 (M EUR) at NL cement, consumed in NL.
"""

import argparse
import json
import resource
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import precompute  # noqa: E402

from case import GHG_ROW, NL_LOCAL, YEAR, K  # noqa: E402

CEMENT, NL, GHG = 177, 27, GHG_ROW + 1  # global ids in db.sqlite3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    engine = precompute.engine_revision(args.engine.resolve())
    with tempfile.TemporaryDirectory() as tmp:
        precompute.setup_django(args.engine.resolve(), args.data.resolve(), Path(tmp) / "db.sqlite3")
        from ramascene import querymanagement as qm

        Y, B, L = (qm.get_numpy_objects(YEAR, n) for n in ("Y", "B", "L"))
        validation = precompute.reference_validation(Y, B, L)
        y = np.zeros_like(Y)
        y[K, NL_LOCAL] = 1.0
        t = time.perf_counter()
        sel = {
            "dimType": "Contribution",
            "vizType": "Sectoral",
            "nodesSec": [CEMENT],
            "nodesReg": [NL],
            "extn": [GHG],
            "year": YEAR,
        }
        values = precompute.run_route(sel, y, B, L)
        elapsed = time.perf_counter() - t
    out = {
        "engine": engine,
        "selection": sel,
        "engine_result": values,
        "unit": "kg CO2 eq",
        "route_one_seconds": elapsed,
        "octave_reference_validation": validation,
        "peak_rss_gib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
    }
    args.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
