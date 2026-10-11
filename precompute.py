r"""Run the RaMa-Scene engine over a fixed scenario grid and write one JSON file.

    uv run python precompute.py --run --engine ../ramascene-review \
        --data "$DATASETS_DIR" --out data/results.json

The engine is imported as a package and driven the way ramascene.tasks.execute_calc
drives it, without Celery, a broker or channels. Every scenario is an
intervention on the 2011 base year through ramascene.modelling.Modelling; the
engine makes no projection, so nothing here is a forecast.

Memory: each technical-coefficient scenario inverts a dense 9800x9800 matrix and
peaks near 4.0 GB (five live 9800×9800 float64 matrices, 768 MB each). Scenarios run one at a time and each
one's matrices are released before the next starts. --run is required so the
full-size path is never started by accident.

Nothing is written unless the engine first reproduces the four Octave
reference files shipped with RaMa-Scene on the matrices given (checked before
any inversion) and every later check passes; only then is data_kind
"exiobase-v3".
"""

import argparse
import datetime as dt
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
import warnings
from pathlib import Path
from typing import Any

import numpy as np

YEAR = 2011
FILE_SUFFIX = "v4"  # {A,L,Y,B}_v4.npy, the engine's DATASET_VERSION setting. Zenodo record
# 10.5281/zenodo.3533196 ships only _v4 files, for every year 1995-2011 (checked 2026-09-26).
# As https://zenodo.org/api/records/3533196 returns it (checked 2026-09-26).
DATASET = {
    "name": "EXIOBASE v3.3.sm",
    "version": "V1",
    "published": "2019-11-08",
    "creators": ["Franco Donati", "Arjan de Koning"],
    "description": "A new version of the monetary product-by-product ITA IO database EXIOBASE v3.3 where "
    "materials produced with secondary technologies (i.e. recycling industries) are explicitly represented.",
    "doi": "10.5281/zenodo.3533196",
    "file_suffix": FILE_SUFFIX,
}
# Absolute floor for comparisons, in indicator units (kg, 1000 p, kt): far
# below any value reported, far above the noise on a value that should be 0.
ABS_FLOOR = 1e-9
# Float64 results that should agree exactly: engine against the independent
# per-region sum, and the 0% control against the stored L. Measured worst
# cases in data/results.json are 2e-16 and 4e-15, so 1e-9 leaves room for
# summation order and still catches any real disagreement.
REL_TOL = 1e-9
# The Octave reference files print values with as few as 7 significant digits,
# so rounding alone moves a value by up to 5e-7 relative.
OCTAVE_REL_TOL = 1e-6
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
SCENARIOS: list[dict[str, Any]] = [
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


def independent_by_region(indicator, Y, B, L, engine_values, region_leaves):
    """B_i * (L . sum(Y)) per region, computed without Analyze.

    Rows are country-major (index = country * 200 + product, as
    productindexmanger builds them), so the vector reshapes to (country,
    product); each region sums its leaf countries (leaf_children_local).
    """
    countries = sum(len(c) for c in region_leaves.values())
    per_country = (B[indicator - 1] * (L @ Y.sum(axis=1))).reshape(countries, -1).sum(axis=1)
    regions = {
        region: {"engine": engine_values.get(region, math.nan), "direct": math.fsum(per_country[leaves])}
        for region, leaves in region_leaves.items()
    }
    return {
        "indicator": indicator,
        "regions": regions,
        "passed": set(engine_values) == set(region_leaves)
        and all(math.isclose(r["engine"], r["direct"], rel_tol=REL_TOL, abs_tol=ABS_FLOOR) for r in regions.values()),
    }


def relative_difference(value, reference):
    """|value - reference| relative to the reference, floored at ABS_FLOOR."""
    return abs(value - reference) / max(abs(reference), ABS_FLOOR)


def loads_A(scenario):
    """True when the scenario changes technical coefficients, so the engine inverts a new L."""
    return any(step["consumedBy"] != [FINAL_CONSUMPTION] for step in scenario["model_details"])


def modelled(engine, name, model_details, Y):
    """engine.apply_model, with an engine ValueError naming the scenario."""
    try:
        return engine.apply_model(model_details, Y)
    except ValueError as e:
        raise ValueError(f"scenario {name}: {e}") from e


def scenario_direction(scenarios, results, control, Y, B, indicators):
    """Check that every -20% cut changes the result and raises no indicator total.

    The rise check needs non-negative B, y, A and L.

    Final-demand scenarios are compared with the baseline (both use the stored
    L); technical-coefficient scenarios with the 0% control, which went through
    the same inversion, so stored-versus-inverted noise cannot pass as a change.
    A and L are not checked for sign (A is only loaded inside Modelling).
    """
    y_ok = bool((Y.sum(axis=1) >= 0).all())
    skipped = [i for i in indicators if not (y_ok and (B[i - 1] >= 0).all())]
    if skipped:
        warnings.warn(f"indicators {skipped}: negative entries in B or final demand, rise check skipped", stacklevel=2)
    references, unchanged, rises = {}, [], []
    for s in scenarios:
        ref_name = "zero_change_control" if loads_A(s) else "baseline"
        ref, got = (control if loads_A(s) else results["baseline"]), results[s["id"]]
        references[s["id"]] = ref_name
        if got == ref:
            unchanged.append(s["id"])
        for i in (str(i) for i in indicators if i not in skipped):
            total, ref_total = math.fsum(got[i].values()), math.fsum(ref[i].values())
            if total > ref_total and not math.isclose(total, ref_total, rel_tol=REL_TOL, abs_tol=ABS_FLOOR):
                rises.append({"scenario": s["id"], "indicator": int(i), "total": total, "reference": ref_total})
    return {
        "passed": not unchanged and not rises,
        "references": references,
        "unchanged": unchanged,
        "rises": rises,
        "rise_check_skipped_indicators": skipped,
    }


def compute(engine, scenarios, indicators):
    """Baseline, each scenario, then a 0% control, one at a time.

    engine: load(name) -> array, apply_model(model_details, Y) -> (Y, L),
    by_region(indicator, Y, B, L) -> {region: value}, region_leaves ->
    {region: [country index]}, reference_validation(Y, B, L).
    Raises ValueError, before anything is written, on a failed Octave reference
    check (before any inversion), non-finite output or a failed check.
    """
    Y, B = engine.load("Y"), engine.load("B")
    independent = []

    def run(name, Y_s, L_s):
        by_indicator = {}
        for i in indicators:
            values = engine.by_region(i, Y_s, B, L_s)
            if not np.isfinite(list(values.values())).all():
                raise ValueError(f"non-finite engine output, {name}, indicator {i}: {values}")
            by_indicator[str(i)] = values
            independent.append({"run": name, **independent_by_region(i, Y_s, B, L_s, values, engine.region_leaves)})
        return by_indicator

    # Baseline: the stored L, as a query without model_details uses it.
    L = engine.load("L")
    validation = engine.reference_validation(Y, B, L)
    if not validation["passed"]:
        raise ValueError(f"Octave reference check failed, nothing computed or written: {json.dumps(validation)}")
    results = {"baseline": run("baseline", Y, L)}
    del L
    gc.collect()

    # Passing modelled()'s result straight into run() leaves no reference to
    # the scenario's (Y, L) once run() returns, so nothing survives into the next.
    for scenario in scenarios:
        results[scenario["id"]] = run(scenario["id"], *modelled(engine, scenario["id"], scenario["model_details"], Y))
        gc.collect()

    # A 0% change through the modified-A path must reproduce the stored L.
    step = next(st for s in scenarios for st in s["model_details"] if st["consumedBy"] != [FINAL_CONSUMPTION])
    control_details = [dict(step, techChange=[0])]
    control = run("zero_change_control", *modelled(engine, "zero_change_control", control_details, Y))
    gc.collect()
    worst = max(relative_difference(control[i][r], results["baseline"][i][r]) for i in control for r in control[i])
    checks = {
        "independent_by_region": independent,
        "zero_change_control": {
            "passed": worst <= REL_TOL,
            "max_relative_difference": worst,
            "tolerance": f"relative {REL_TOL:g}",
            "model_details": control_details,
        },
        "scenario_direction": scenario_direction(scenarios, results, control, Y, B, indicators),
    }
    failed = [
        name
        for name, ok in (
            ("independent_by_region", all(t["passed"] for t in independent)),
            ("zero_change_control", checks["zero_change_control"]["passed"]),
            ("scenario_direction", checks["scenario_direction"]["passed"]),
        )
        if not ok
    ]
    if failed:
        raise ValueError(f"verification failed ({', '.join(failed)}), nothing written: {json.dumps(checks, indent=1)}")
    return {"results": results, "checks": checks, "validation": validation}


def assemble(computed, indicators, provenance, peak_rss_bytes):
    """The output document for a run that passed compute()'s checks."""
    results = computed["results"]
    return {
        "data_kind": "exiobase-v3",  # compute() raises unless the Octave reference check passed
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
    """Engine commit, dataset record and hashes, versions and the command, for the provenance panel."""
    import django

    def git(*a):
        done = subprocess.run(  # noqa: S603 -- fixed git arguments, no shell
            ["git", "-C", str(engine_dir), *a],  # noqa: S607 -- git from PATH, like the user would run it
            capture_output=True,
            text=True,
            check=False,
        )
        return done.stdout.strip() if done.returncode == 0 else None

    def sha256(path):
        with path.open("rb") as f:
            return hashlib.file_digest(f, "sha256").hexdigest()

    return {
        "engine": {
            "repository": public_remote(git("remote", "get-url", "origin")),
            "branch": git("branch", "--show-current"),
            "commit": git("rev-parse", "HEAD"),
            "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        },
        "dataset": {
            **DATASET,
            "year": YEAR,
            "sha256": {n: sha256(Path(data_dir) / str(YEAR) / f"{n}_{FILE_SUFFIX}.npy") for n in "ALYB"},
        },
        "command": public_command(argv),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "django": django.get_version(),
    }


def public_remote(url):
    """The engine's origin URL, or None for a local path, which must not reach the page."""
    return None if url is None or url.startswith(("/", ".", "~", "file:")) else url


def public_command(argv):
    """The command line, with the dataset directory as "$DATASETS_DIR", not a local path."""
    words, after_data = [], False
    for a in argv:
        if after_data:
            words.append('"$DATASETS_DIR"')
        elif a.startswith("--data="):
            words.append('--data="$DATASETS_DIR"')
        else:
            words.append(shlex.quote(a))
        after_data = a == "--data"
    return " ".join(["uv run python precompute.py", *words])


def peak_rss_bytes():
    """Peak resident memory of this process in bytes (macOS reports bytes, Linux KiB)."""
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
        DATASET_VERSION=FILE_SUFFIX,
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
        mismatches = [
            k for k, v in expected.items() if not math.isclose(got.get(k, math.nan), v, rel_tol=OCTAVE_REL_TOL)
        ]
        files[filename] = {"values": len(expected), "mismatches": len(mismatches)}
    return {
        "passed": all(f["mismatches"] == 0 for f in files.values()),
        "tolerance": f"relative {OCTAVE_REL_TOL:g}",
        "files": files,
    }


def region_leaves():
    """{region name: 0-based country indices} for REGIONS, from the engine database."""
    from ramascene import querymanagement as qm
    from ramascene.models import Country

    rows = {c.global_id: c for c in Country.objects.filter(global_id__in=REGIONS)}
    return {rows[g].name: qm.clean_local_leafs(rows[g].leaf_children_local) for g in REGIONS}


def real_engine():
    """The adapter compute() drives, backed by the RaMa-Scene package (after setup_django)."""
    from ramascene import querymanagement as qm

    return types.SimpleNamespace(
        load=lambda name: qm.get_numpy_objects(YEAR, name),
        apply_model=apply_model,
        by_region=by_region,
        region_leaves=region_leaves(),
        reference_validation=reference_validation,
    )


def indicator_meta(indicators):
    """Id, name and unit of each indicator, from the engine database."""
    from ramascene import querymanagement as qm

    names = qm.get_names_indicator(indicators)
    units = qm.get_indicator_units(indicators)
    return [{"id": i, "name": n, "unit": units[n]} for i, n in zip(indicators, names, strict=True)]


def main(argv=None):
    """Command-line entry point; see the module docstring."""
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="really run the full-size engine (~4.0 GB peak)")
    parser.add_argument("--engine", type=Path, required=True, help="RaMa-Scene checkout")
    parser.add_argument("--data", type=Path, required=True, help="DATASETS_DIR holding 2011/{A,L,Y,B}_v4.npy")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.run:
        parser.error("refusing to start the full-size engine (~4.0 GB peak per scenario) without --run")

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
    peak_gib = output["provenance"]["peak_rss_bytes"] / 2**30
    print(f"{args.out}: data_kind={output['data_kind']}, peak RSS {peak_gib:.2f} GiB")


if __name__ == "__main__":
    main()
