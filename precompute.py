"""Run the RaMa-Scene engine over a fixed scenario grid and write one JSON file.

    uv run python precompute.py --run --engine ../ramascene-review \\
        --data "$DATASETS_DIR" --out data/results.json

The engine is imported as a package and driven the way ramascene.tasks.execute_calc
drives it, without Celery, a broker or channels. Every scenario is an
intervention on the 2011 base year through ramascene.modelling.Modelling; the
engine makes no projection, so nothing here is a forecast.

Memory: each technical-coefficient scenario inverts a dense 9800x9800 matrix and
peaks near 3.7 GB (five float64 buffers). Scenarios run one at a time and each
one's matrices are released before the next starts. --run is required so the
full-size path is never started by accident.

data_kind is derived, never asserted: "exiobase-v3" only when the engine
reproduces the four Octave reference files shipped with RaMa-Scene on the
matrices given, "synthetic" otherwise.
"""

import argparse
import datetime
import gc
import hashlib
import json
import math
import platform
import resource
import shlex
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

import numpy as np

YEAR = 2011
DATASET_VERSION = "v3"
DATASET_DOI = "10.5281/zenodo.3533196"
# ramascene README.md:3 and :18-20
DATASET_NAME = "EXIOBASE-RaMa-Scene: EXIOBASE v3.3 modified to include secondary materials"
STATUS = "precomputed — not a live calculation"

# Global ids from the engine's db.sqlite3. Breakdown by the five continental
# aggregates the RaMa-Scene database defines; together they cover all 49 regions.
REGIONS = [2, 3, 4, 5, 6]  # Europe, Middle-East, America, Asia-Pacific, Africa
INDICATORS = [5, 3, 7]  # GHG emissions: Total; Employment: Total; DEU - Metal Ores - Total
EUROPE, ALL_REGIONS = [2], [1]
FINAL_CONSUMPTION = 276  # ModellingProduct "Y: Final Consumption"

# model_details exactly as the RaMa-Scene front end sends them (global ids).
# Modelling.model_final_demand / model_intermediates scale the selected cells
# by (1 + techChange / 100). Nothing else changes: no substitution, price or
# rebound effect is modelled.
SCENARIOS = [
    {
        "id": "vehicle-demand-europe",
        "label": "Final demand for European motor vehicles in Europe −20%",
        "description": "Final demand in European regions for motor vehicles, trailers and "
        "semi-trailers produced in European regions, scaled by −20%.",
        "model_details": [
            {
                "product": [199],  # Motor vehicles, trailers and semi-trailers
                "originReg": EUROPE,
                "consumedBy": [FINAL_CONSUMPTION],
                "consumedReg": EUROPE,
                "techChange": [-20],
            },
        ],
    },
    {
        "id": "steel-in-vehicles-europe",
        "label": "Steel input to European motor-vehicle manufacturing −20%",
        "description": "Technical coefficient of basic iron and steel (from all regions) into "
        "motor-vehicle manufacturing in European regions, scaled by −20%.",
        "model_details": [
            {
                "product": [180],  # Basic iron and steel and of ferro-alloys ...
                "originReg": ALL_REGIONS,
                "consumedBy": [198],  # S: Motor vehicles, trailers and semi-trailers
                "consumedReg": EUROPE,
                "techChange": [-20],
            },
        ],
    },
    {
        "id": "cement-in-construction",
        "label": "Cement input to construction −20%, all regions",
        "description": "Technical coefficient of cement, lime and plaster (from all regions) "
        "into construction work in all regions, scaled by −20%.",
        "model_details": [
            {
                "product": [177],  # Cement, lime and plaster
                "originReg": ALL_REGIONS,
                "consumedBy": [225],  # S: Construction work
                "consumedReg": ALL_REGIONS,
                "techChange": [-20],
            },
        ],
    },
]


# --- orchestration (engine injected) -----------------------------------------


def independent_total(indicator, Y, B, L, engine_values):
    """B_i . L . sum(Y) without the engine's index handling; the regions partition it."""
    direct = float(B[indicator - 1] @ (L @ Y.sum(axis=1)))
    engine = math.fsum(engine_values.values())
    return {
        "indicator": indicator,
        "engine": engine,
        "direct": direct,
        "passed": math.isclose(engine, direct, rel_tol=1e-9),
    }


def relative_difference(value, reference):
    if reference == 0:
        return 0.0 if value == 0 else math.inf
    return abs(value / reference - 1)


def compute(engine, scenarios, indicators):
    """Baseline, each scenario, then a 0% control, one at a time.

    engine: load(name) -> array, apply_model(model_details, Y) -> (Y, L),
    by_region(indicator, Y, B, L) -> {region: value}, reference_validation(Y, B, L).
    Raises ValueError, before anything is written, on non-finite output or a failed check.
    """
    Y, B = engine.load("Y"), engine.load("B")
    totals = []

    def run(Y_s, L_s):
        by_indicator = {}
        for i in indicators:
            values = engine.by_region(i, Y_s, B, L_s)
            if not np.isfinite(list(values.values())).all():
                raise ValueError(f"non-finite engine output, indicator {i}: {values}")
            by_indicator[str(i)] = values
            totals.append(independent_total(i, Y_s, B, L_s, values))
        return by_indicator

    # Baseline: the stored L, as a query without model_details uses it.
    L = engine.load("L")
    validation = engine.reference_validation(Y, B, L)
    results = {"baseline": run(Y, L)}
    del L
    gc.collect()

    # Passing apply_model's result straight into run() leaves no reference to
    # the scenario's (Y, L) once run() returns, so nothing survives into the next.
    for scenario in scenarios:
        results[scenario["id"]] = run(*engine.apply_model(scenario["model_details"], Y))
        gc.collect()

    # A 0% change through the modified-A path must reproduce the stored L.
    step = next(st for s in scenarios for st in s["model_details"] if st["consumedBy"] != [FINAL_CONSUMPTION])
    control_details = [dict(step, techChange=[0])]
    control = run(*engine.apply_model(control_details, Y))
    gc.collect()
    worst = max(relative_difference(control[i][r], results["baseline"][i][r]) for i in control for r in control[i])
    checks = {
        "independent_totals": totals,
        "zero_change_control": {
            "passed": worst <= 1e-6,
            "max_relative_difference": worst,
            "tolerance": "relative 1e-6",
            "model_details": control_details,
        },
    }
    failed = [
        name
        for name, ok in (
            ("independent_totals", all(t["passed"] for t in totals)),
            ("zero_change_control", checks["zero_change_control"]["passed"]),
        )
        if not ok
    ]
    if failed:
        raise ValueError(f"verification failed ({', '.join(failed)}), nothing written: {json.dumps(checks, indent=1)}")
    return {"results": results, "checks": checks, "validation": validation}


def assemble(computed, indicators, provenance, peak_rss_bytes):
    results = computed["results"]
    return {
        "data_kind": "exiobase-v3" if computed["validation"]["passed"] else "synthetic",
        "status": STATUS,
        "base_year": YEAR,
        "breakdown": "Region where the impact occurs (RaMa-Scene route three, Hotspot × Geographic)",
        "regions": list(next(iter(results["baseline"].values()))),
        "indicators": indicators,
        "scenarios": [
            {
                "id": "baseline",
                "label": f"Baseline ({YEAR}, no intervention)",
                "description": f"EXIOBASE {YEAR} as stored, no intervention.",
                "model_details": None,
            },
            *SCENARIOS,
        ],
        "results": results,
        "checks": computed["checks"],
        "provenance": {
            **provenance,
            "reference_validation": computed["validation"],
            "peak_rss_bytes": peak_rss_bytes,
        },
    }


def collect_provenance(engine_dir, data_dir, argv):
    import django

    def git(*a):
        done = subprocess.run(["git", "-C", str(engine_dir), *a], capture_output=True, text=True, check=False)
        return done.stdout.strip() if done.returncode == 0 else None

    def sha256(path):
        with open(path, "rb") as f:
            return hashlib.file_digest(f, "sha256").hexdigest()

    return {
        "engine": {
            "repository": git("remote", "get-url", "origin"),
            "branch": git("branch", "--show-current"),
            "commit": git("rev-parse", "HEAD"),
            "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        },
        "dataset": {
            "name": DATASET_NAME,
            "doi": DATASET_DOI,
            "version": DATASET_VERSION,
            "year": YEAR,
            "sha256": {n: sha256(Path(data_dir) / str(YEAR) / f"{n}_{DATASET_VERSION}.npy") for n in "ALYB"},
        },
        "command": shlex.join(["uv", "run", "python", "precompute.py", *argv]),
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "django": django.get_version(),
    }


def peak_rss_bytes():
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024


# --- the real engine, Celery-free ---------------------------------------------

ROUTE_THREE = "route_three"  # tasks.execute_calc: Hotspot x Geographic
LEGACY_VOCABULARY = {
    "Consumption": "Contribution",
    "Production": "Hotspot",
    "GeoMap": "Geographic",
    "TreeMap": "Sectoral",
}
ROUTES = {
    ("Contribution", "Geographic"): "route_two",
    ("Hotspot", "Geographic"): "route_three",
    ("Contribution", "Sectoral"): "route_one",
    ("Hotspot", "Sectoral"): "route_four",
}


def setup_django(engine_dir, data_dir, db_copy):
    """Import the engine, labels from a copy of its db.sqlite3.

    A copy because ramascene/__init__.py forces WAL mode, which rewrites the
    database it touches.
    """
    shutil.copy(Path(engine_dir) / "db.sqlite3", db_copy)
    sys.path.insert(0, str(engine_dir))
    import django
    from django.conf import settings

    settings.configure(
        INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth", "ramascene"],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": str(db_copy)}},
        DATASET_DIR=str(data_dir),
        DATASET_VERSION=DATASET_VERSION,
        USE_TZ=True,
    )
    django.setup()


def run_route(query_selection, Y, B, L):
    """One Analyze route, argument for argument as tasks.execute_calc builds it."""
    from ramascene import querymanagement as qm
    from ramascene.analyze import Analyze

    ready = qm.calc_ready_selection(query_selection)
    analyze = Analyze(
        qm.convert_to_numpy(ready["nodesSec"]),
        qm.convert_to_numpy(ready["nodesReg"]),
        qm.convert_to_numpy(ready["extn"]),
        query_selection,
        ready["idx_units"],
        "precompute",
        0,
        np.arange(0, 49),
        Y,
        B,
        L,
    )
    result = json.loads(getattr(analyze, ROUTES[(query_selection["dimType"], query_selection["vizType"])])())
    return {name: float(v) for name, v in result["rawResultData"].items()}


def by_region(indicator, Y, B, L):
    """Where the impact occurs (route three), per continental aggregate, all products."""
    selection = {
        "dimType": "Hotspot",
        "vizType": "Geographic",
        "nodesSec": [1],
        "nodesReg": list(REGIONS),
        "extn": [indicator],
        "year": YEAR,
    }
    return run_route(selection, Y, B, L)


def model_inputs(model_details):
    """The model_details preprocessing of consumers.py (websocket_receive, action "model")."""
    from ramascene import querymanagement as qm

    ready = {k: [] for k in ("product", "originReg", "consumedReg", "consumedBy", "techChange", "identifiers")}
    load_A = []
    for step in model_details:
        ready["product"].append(qm.get_leafs_product(step["product"]))
        ready["originReg"].append(qm.get_leafs_country(step["originReg"]))
        ready["consumedReg"].append(qm.get_leafs_country(step["consumedReg"]))
        ready["consumedBy"].append(qm.get_leafs_modelled_product(step["consumedBy"]))
        ready["techChange"].append(step["techChange"])
        identifier = qm.identify_modelling_product(step["consumedBy"][0])
        ready["identifiers"].append(identifier)
        load_A.append(identifier != "FINALCONSUMPTION")
    return ready, load_A


def apply_model(model_details, Y):
    """(Y, L) after the intervention, via ramascene.modelling.Modelling."""
    from ramascene.modelling import Modelling

    ready, load_A = model_inputs(model_details)
    Y_s, L_s = Modelling(ready, Y, load_A, YEAR, model_details).apply_model()
    # the Modelling instance (and its modified A) is dropped here, unlike
    # tasks.execute_calc, which holds it through the route call
    return Y_s, L_s


def reference_validation(Y, B, L):
    """Reproduce the Octave reference files in ramascene/tests/validation_files."""
    from ramascene.tests.validation_data import FILES_TO_TEST_AGAINST, VALIDATION_DIR, open_validation_file

    files = {}
    for filename in FILES_TO_TEST_AGAINST:
        query, expected, _ = open_validation_file(str(Path(VALIDATION_DIR) / filename))
        selection = query["querySelection"]
        selection["year"] = int(selection["year"][0])
        selection["dimType"] = LEGACY_VOCABULARY[selection["dimType"]]
        selection["vizType"] = LEGACY_VOCABULARY[selection["vizType"]]
        got = run_route(selection, Y, B, L)
        mismatches = [k for k, v in expected.items() if not math.isclose(got.get(k, math.nan), v, rel_tol=1e-6)]
        files[filename] = {"values": len(expected), "mismatches": len(mismatches)}
    return {"passed": all(f["mismatches"] == 0 for f in files.values()), "tolerance": "relative 1e-6", "files": files}


def real_engine():
    from ramascene import querymanagement as qm

    return types.SimpleNamespace(
        load=lambda name: qm.get_numpy_objects(YEAR, name),
        apply_model=apply_model,
        by_region=by_region,
        reference_validation=reference_validation,
    )


def indicator_meta(indicators):
    from ramascene import querymanagement as qm

    names = qm.get_names_indicator(indicators)
    units = qm.get_indicator_units(indicators)
    return [{"id": i, "name": n, "unit": units[n]} for i, n in zip(indicators, names)]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="really run the full-size engine (~3.7 GB peak)")
    parser.add_argument("--engine", type=Path, required=True, help="RaMa-Scene checkout")
    parser.add_argument("--data", type=Path, required=True, help="DATASETS_DIR holding 2011/{A,L,Y,B}_v3.npy")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.run:
        parser.error("refusing to start the full-size engine (~3.7 GB peak per scenario) without --run")

    with tempfile.TemporaryDirectory() as tmp:
        setup_django(args.engine.resolve(), args.data.resolve(), Path(tmp) / "db.sqlite3")
        computed = compute(real_engine(), SCENARIOS, INDICATORS)
        output = assemble(
            computed,
            indicator_meta(INDICATORS),
            collect_provenance(args.engine, args.data, argv),
            peak_rss_bytes(),
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=1, ensure_ascii=False, allow_nan=False) + "\n")
    print(
        f"{args.out}: data_kind={output['data_kind']}, peak RSS {output['provenance']['peak_rss_bytes'] / 2**30:.2f} GiB"
    )


if __name__ == "__main__":
    main()
