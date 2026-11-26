"""The 155 published scenarios through the numpy driver or through pymrio, against RaMa-Scene's results.

    uv run --project .. python scenario_check.py numpy --store ../data/browser-engine --out results/scenarios-numpy.json
    uv run python scenario_check.py pymrio --data "$DATASETS_DIR" --store ../data/browser-engine \\
        --out results/scenarios-pymrio.json

Both routes score each scenario on the page's three indicators and five continental regions, as
tests/browser-parity.test.js does, and report the worst relative difference to ../data/results.json.
`numpy` runs pipeline/numpy_engine.py on the float32 browser store. `pymrio` applies the same edits to the
float64 A and Y, lets pymrio compute its own Leontief inverse for every scenario (about 20 s and 5 GiB each),
and takes the stressor totals of the producing regions from x = L y. The store's manifest supplies the
catalogue the steps are written in.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "pipeline"))
import numpy_engine as ne  # noqa: E402

from case import array  # noqa: E402

BASELINE = "baseline"


def scenarios(results):
    """The baseline (no change) and the published scenarios, with their steps."""
    published = [s for s in results["scenarios"] if s["id"] != BASELINE]
    first = published[0]["model_details"][0]
    return [{"id": BASELINE, "model_details": [{**first, "techChange": [0]}]}, *published]


def numpy_totals(store, steps, regions):
    meta = store.meta
    flows = ne.scenario_flows(store, steps)
    cube = flows.reshape(len(meta["indicators"]), meta["countries"], len(meta["sections"]), meta["countries"])
    return {(i, r["name"]): cube[k, r["leaves"]].sum() for k, i in enumerate(meta["indicators"]) for r in regions}


def pymrio_totals(meta, steps, regions, arrays):
    import pandas as pd  # noqa: PLC0415
    import pymrio  # noqa: PLC0415

    a, y, b = (arrays[n].copy() if n != "B" else arrays[n] for n in ("A", "Y", "B"))
    for e in ne.plan(meta, steps)["edits"]:
        target = y if e["final"] else a
        target[np.ix_(e["rows"], e["columns"])] *= e["factor"]
    countries, products = meta["countries"], meta["products"]
    idx = pd.MultiIndex.from_product(
        [[f"R{r:02d}" for r in range(countries)], [f"S{s:03d}" for s in range(products)]], names=["region", "sector"]
    )
    io = pymrio.IOSystem(
        A=pd.DataFrame(a, index=idx, columns=idx),
        Y=pd.DataFrame(y, index=idx, columns=pd.MultiIndex.from_product([idx.levels[0], ["final demand"]])),
    )
    io.calc_system()
    x = io.x.to_numpy().ravel()
    producing = {r["name"]: np.repeat(np.isin(range(countries), r["leaves"]), products) for r in regions}
    return {(i, name): float(b[i - 1][mask] @ x[mask]) for i in meta["indicators"] for name, mask in producing.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route", choices=["numpy", "pymrio"])
    ap.add_argument("--store", type=Path, required=True, help="the browser store: manifest and, for numpy, the arrays")
    ap.add_argument("--data", type=Path, help="DATASETS_DIR with 2011/{A,B,Y}_v4.npy (pymrio)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, help="only the first N scenarios, for a quick run")
    args = ap.parse_args()

    reference = json.loads((HERE.parent / "data" / "results.json").read_text(encoding="utf-8"))
    store = ne.Store(args.store)
    meta = store.meta
    regions = [r for r in meta["catalog"]["regions"] if 2 <= r["id"] <= 6]  # noqa: PLR2004
    arrays = {n: array(args.data, n) for n in ("A", "B", "Y")} if args.route == "pymrio" else None
    worst, where, seconds = 0.0, None, []
    runs = scenarios(reference)[: args.limit]
    for s in runs:
        t = time.perf_counter()
        steps = s["model_details"]
        got = (
            numpy_totals(store, steps, regions)
            if args.route == "numpy"
            else pymrio_totals(meta, steps, regions, arrays)
        )
        seconds.append(time.perf_counter() - t)
        for (indicator, region), value in got.items():
            want = reference["results"][s["id"]][str(indicator)][region]
            error = abs(value - want) / max(abs(want), 1e-12)
            if error > worst:
                worst, where = error, f"{s['id']}: {region}, indicator {indicator}"
        print(f"{s['id']}: worst so far {worst:.2e} ({seconds[-1]:.1f} s)", file=sys.stderr, flush=True)
    out = {
        "route": args.route,
        "scenarios": len(runs),
        "worst_relative_difference": worst,
        "worst_at": where,
        "seconds_per_scenario_median": float(np.median(seconds)),
    }
    if args.route == "pymrio":
        import pymrio  # noqa: PLC0415

        out["pymrio"] = pymrio.__version__
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
