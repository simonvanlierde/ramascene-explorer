"""Run the RaMa-Scene engine over a fixed scenario grid and write one JSON file.

    uv run python precompute.py --run --engine ../ramascene-pr2 \\
        --data "$DATASETS_DIR" --out data/results.json

The engine is imported as a package and driven the way ramascene.tasks.execute_calc
drives it, without Celery, a broker or channels. Every scenario is an
intervention on the 2011 base year through ramascene.modelling.Modelling; the
engine makes no projection, so nothing here is a forecast.

Scenarios: the three original interventions plus a material-efficiency grid,
five products x five continental regions x three cut sizes (75), all defined
as data below.

Memory and process model: each technical-coefficient scenario solves against a
dense 9800x9800 (I - A). With the perf/solve-not-invert engine that peaked at
about 1.6 GB (1.53 GiB) per worker in the shipped run; the earlier inverting
engine at 3.97 GB per job (solve-not-invert PR description). Each scenario runs
in a fresh worker process (this script with --worker) so its peak RSS is that
process's ru_maxrss, measured the way the engine's own numbers were, and its
matrices are gone before the next starts. --run is required so the full-size
path is never started by accident.

Nothing is written unless the engine first reproduces the four Octave
reference files shipped with RaMa-Scene on the matrices given (checked before
any solve), the baseline matches an independent B . (L . sum Y) per region and the
0% control reproduces the baseline. A scenario that fails a per-scenario check
(non-finite output, regional mismatch, no change, a rise) is recorded as
failed with its reason and left out of the published results; it is never
dropped silently. data_kind is "exiobase-v3" only for output that passed.
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
import statistics
import sys
import tempfile
import time
import types
import warnings
from pathlib import Path

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


# --- material-efficiency grid ---------------------------------------------------
#
# One shape for every cell: the technical coefficient of a product (from all
# regions) into every industry of one continental region is scaled by the cut.
# Every industry in that region then uses that much less of the product per
# unit of output; nothing else changes. Modelled on cement-in-construction
# above, with the consuming side widened from one industry to all of them.
GRID_CUTS = [-10, -20, -50]  # techChange in %
# ModellingProduct level-2 aggregates "S: Agriculture, hunting and forestry"
# .. "S: Other service activities": the engine database's 15 industry
# sections, whose leaves together are all 200 industries.
INDUSTRY_SECTIONS = list(range(1, 16))
# ramascene_product global ids and names, as db.sqlite3 has them.
GRID_PRODUCTS = [
    {
        "slug": "steel",
        "id": 180,
        "name": "Basic iron and steel and of ferro-alloys and first products thereof",
        "short": "Basic iron and steel",
    },
    {"slug": "aluminium", "id": 184, "name": "Aluminium and aluminium products", "short": "Aluminium"},
    {"slug": "cement", "id": 177, "name": "Cement, lime and plaster", "short": "Cement, lime and plaster"},
    {"slug": "plastics", "id": 162, "name": "Plastics, basic", "short": "Basic plastics"},
    {
        "slug": "electrical",
        "id": 196,
        "name": "Electrical machinery and apparatus n.e.c.",
        "short": "Electrical machinery",
    },
]
# ramascene_country global ids: the five continental aggregates (REGIONS above).
GRID_REGIONS = [
    {"slug": "europe", "id": 2, "name": "Europe"},
    {"slug": "middle-east", "id": 3, "name": "Middle-East"},
    {"slug": "america", "id": 4, "name": "America"},
    {"slug": "asia-pacific", "id": 5, "name": "Asia-Pacific"},
    {"slug": "africa", "id": 6, "name": "Africa"},
]
GRID = {
    "shape": "Technical coefficient of the product (from all regions) into every industry of the region, "
    "scaled by the cut; consumedBy lists the engine database's 15 industry sections.",
    "products": GRID_PRODUCTS,
    "regions": GRID_REGIONS,
    "cuts": GRID_CUTS,
    "consumed_by": INDUSTRY_SECTIONS,
}


def grid_scenario_id(product, region, cut):
    return f"{product}-{region}-{abs(cut)}"


def grid_scenarios():
    """The 75 grid cells as scenarios, product-major, in GRID order."""
    return [
        {
            "id": grid_scenario_id(p["slug"], r["slug"], cut),
            "label": f"{p['short']} input to all industries in {r['name']} \u2212{abs(cut)}%",
            "description": f"Technical coefficient of {p['name'].lower()} (from all regions) into every "
            f"industry in {r['name']} (the 15 industry sections of the engine database), scaled by \u2212{abs(cut)}%.",
            "grid": {"product": p["slug"], "region": r["slug"], "cut": cut},
            "model_details": [
                {
                    "product": [p["id"]],
                    "originReg": ALL_REGIONS,
                    "consumedBy": INDUSTRY_SECTIONS,
                    "consumedReg": [r["id"]],
                    "techChange": [cut],
                },
            ],
        }
        for p in GRID_PRODUCTS
        for r in GRID_REGIONS
        for cut in GRID_CUTS
    ]


ALL_SCENARIOS = [*SCENARIOS, *grid_scenarios()]


# --- orchestration (engine injected) -----------------------------------------


def independent_by_region(indicator, Y, B, L, engine_values, region_leaves):
    """B_i * (L . sum(Y)) per region, computed without Analyze.

    L.dot() rather than @: the perf/solve-not-invert engine returns a
    LeontiefSolve, which has .dot and .T like the stored ndarray. Rows are country-major (index = country * 200 + product, as
    productindexmanger builds them), so the vector reshapes to (country,
    product); each region sums its leaf countries (leaf_children_local).
    """
    countries = sum(len(c) for c in region_leaves.values())
    per_country = (B[indicator - 1] * L.dot(Y.sum(axis=1))).reshape(countries, -1).sum(axis=1)
    regions = {
        region: {"engine": engine_values.get(region, math.nan), "direct": math.fsum(per_country[leaves])}
        for region, leaves in region_leaves.items()
    }
    return {
        "indicator": indicator,
        "regions": regions,
        "passed": set(engine_values) == set(region_leaves)
        and all(math.isclose(r["engine"], r["direct"], rel_tol=1e-9, abs_tol=ABS_FLOOR) for r in regions.values()),
    }


def relative_difference(value, reference):
    return abs(value - reference) / max(abs(reference), ABS_FLOOR)


def loads_A(scenario):
    return any(step["consumedBy"] != [FINAL_CONSUMPTION] for step in scenario["model_details"])


def modelled(engine, name, model_details, Y):
    """engine.apply_model, with an engine ValueError naming the scenario."""
    try:
        return engine.apply_model(model_details, Y)
    except ValueError as e:
        raise ValueError(f"scenario {name}: {e}") from e


def scenario_direction(scenarios, results, control, Y, B, indicators):
    """Every scenario is a cut: it must change the result and, on
    non-negative B, y, A and L, must not raise any indicator total.

    Final-demand scenarios are compared with the baseline (both use the stored
    L); technical-coefficient scenarios with the 0% control, which went through
    the same modified-A path, so stored-versus-solved noise cannot pass as a
    change. A and L are not checked for sign (A is only loaded inside Modelling).
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
            if total > ref_total and not math.isclose(total, ref_total, rel_tol=1e-9, abs_tol=ABS_FLOOR):
                rises.append({"scenario": s["id"], "indicator": int(i), "total": total, "reference": ref_total})
    return {
        "passed": not unchanged and not rises,
        "references": references,
        "unchanged": unchanged,
        "rises": rises,
        "rise_check_skipped_indicators": skipped,
    }


def evaluate(engine, name, Y_s, L_s, B, indicators):
    """Route three per indicator on (Y_s, L_s), each value checked against B . (L . sum Y).

    Returns (by_indicator, independent); raises ValueError on non-finite output.
    """
    by_indicator, independent = {}, []
    for i in indicators:
        values = engine.by_region(i, Y_s, B, L_s)
        if not np.isfinite(list(values.values())).all():
            raise ValueError(f"non-finite engine output, {name}, indicator {i}: {values}")
        by_indicator[str(i)] = values
        independent.append({"run": name, **independent_by_region(i, Y_s, B, L_s, values, engine.region_leaves)})
    return by_indicator, independent


def scenario_in_process(engine, name, model_details, indicators, Y, B):
    """One scenario in this process: the record compute() consumes.

    Passing modelled()'s result straight into evaluate() leaves no reference to
    the scenario's (Y, L) once this returns, so nothing survives into the next.
    """
    started = time.perf_counter()
    by_indicator, independent = evaluate(engine, name, *modelled(engine, name, model_details, Y), B, indicators)
    return {"results": by_indicator, "independent": independent, "engine_s": time.perf_counter() - started}


def compute(engine, scenarios, indicators):
    """Octave references, baseline, each scenario, then a 0% control, one at a time.

    engine: load(name) -> array, apply_model(model_details, Y) -> (Y, L),
    by_region(indicator, Y, B, L) -> {region: value}, region_leaves ->
    {region: [country index]}, reference_validation(Y, B, L); optionally
    scenario(name, model_details, indicators) -> record (the real engine runs
    each scenario in a worker process and adds wall_s and peak_rss_bytes).

    Run-level failures raise ValueError before anything is written: a failed
    Octave reference check (before any solve), a baseline that does not match
    the independent calculation, a leaky 0% control, or no scenario left.
    Scenario-level failures (engine error, non-finite output, regional
    mismatch, no change, a rise) go into "failed" with the reason; the
    scenario is not in "results".
    """
    Y, B = engine.load("Y"), engine.load("B")
    independent, results, failed, runs = [], {}, {}, {}

    def run_here(name, model_details, indicators):
        return scenario_in_process(engine, name, model_details, indicators, Y, B)

    def run_scenario(name, model_details):
        """The engine's record for one scenario, with wall_s measured here unless the worker reports one."""
        started = time.perf_counter()
        record = (getattr(engine, "scenario", None) or run_here)(name, model_details, indicators)
        return {"wall_s": time.perf_counter() - started, **record}

    # Baseline: the stored L, as a query without model_details uses it.
    L = engine.load("L")
    validation = engine.reference_validation(Y, B, L)
    if not validation["passed"]:
        raise ValueError(f"Octave reference check failed, nothing computed or written: {json.dumps(validation)}")
    results["baseline"], baseline_independent = evaluate(engine, "baseline", Y, L, B, indicators)
    independent.extend(baseline_independent)
    if not all(t["passed"] for t in baseline_independent):
        raise ValueError(
            f"verification failed (independent_by_region, baseline), nothing written: {baseline_independent}"
        )
    del L
    gc.collect()

    for scenario in scenarios:
        name = scenario["id"]
        started = time.perf_counter()
        try:
            record = run_scenario(name, scenario["model_details"])
        except ValueError as e:
            failed[name] = str(e)
            runs[name] = {"status": "failed", "wall_s": time.perf_counter() - started}
            continue
        finally:
            gc.collect()
        independent.extend(record["independent"])
        runs[name] = {
            "status": "passed",
            "wall_s": record["wall_s"],
            "engine_s": record["engine_s"],
            "peak_rss_bytes": record.get("peak_rss_bytes"),
        }
        mismatched = [c["indicator"] for c in record["independent"] if not c["passed"]]
        if mismatched:
            failed[name] = (
                f"independent_by_region: engine value differs from B . (L . sum Y) for indicators {mismatched}"
            )
            runs[name]["status"] = "failed"
            continue
        results[name] = record["results"]

    # A 0% change through the modified-A path must reproduce the stored L.
    step = next(st for s in scenarios for st in s["model_details"] if st["consumedBy"] != [FINAL_CONSUMPTION])
    control_details = [dict(step, techChange=[0])]
    control_record = run_scenario("zero_change_control", control_details)
    control = control_record["results"]
    independent.extend(control_record["independent"])
    runs["zero_change_control"] = {k: control_record.get(k) for k in ("wall_s", "engine_s", "peak_rss_bytes")}
    gc.collect()
    worst = max(relative_difference(control[i][r], results["baseline"][i][r]) for i in control for r in control[i])
    zero_change = {
        "passed": worst <= 1e-6,
        "max_relative_difference": worst,
        "tolerance": "relative 1e-6",
        "model_details": control_details,
    }
    if not all(c["passed"] for c in control_record["independent"]) or not zero_change["passed"]:
        raise ValueError(
            f"verification failed (zero_change_control), nothing written: {json.dumps(zero_change, indent=1)}"
        )

    computed = [s for s in scenarios if s["id"] in results]
    direction = scenario_direction(computed, results, control, Y, B, indicators)
    for name in direction["unchanged"]:
        failed[name] = f"scenario_direction: identical to its reference ({direction['references'][name]})"
    for rise in direction["rises"]:
        failed.setdefault(
            rise["scenario"],
            f"scenario_direction: indicator {rise['indicator']} total rises, {rise['total']} > {rise['reference']}",
        )
    for name in failed:
        results.pop(name, None)
        runs[name]["status"] = "failed"
    if len(results) == 1:
        raise ValueError(f"every scenario failed, nothing written: {json.dumps(failed, indent=1)}")
    checks = {
        "independent_by_region": independent,
        "zero_change_control": zero_change,
        "scenario_direction": direction,
        "published_passed_every_check": True,  # by construction: anything that failed is in "failed"
    }
    return {
        "scenarios": scenarios,
        "results": results,
        "failed": failed,
        "runs": runs,
        "checks": checks,
        "validation": validation,
    }


def run_summary(runs, validation):
    """Counts and wall/RSS medians over the scenario runs (the control excluded)."""
    scenario_runs = {k: v for k, v in runs.items() if k != "zero_change_control"}
    walls = [r["wall_s"] for r in scenario_runs.values() if r.get("wall_s") is not None]
    engine_s = [r["engine_s"] for r in scenario_runs.values() if r.get("engine_s") is not None]
    rss = [r["peak_rss_bytes"] for r in scenario_runs.values() if r.get("peak_rss_bytes")]
    stat = lambda xs: {"median": statistics.median(xs), "max": max(xs), "n": len(xs)} if xs else None
    return {
        "scenarios_run": len(scenario_runs),
        "passed": sum(r["status"] == "passed" for r in scenario_runs.values()),
        "failed": sum(r["status"] == "failed" for r in scenario_runs.values()),
        "wall_s": {**stat(walls), "total": math.fsum(walls)} if walls else None,
        "engine_s": stat(engine_s),
        "peak_rss_bytes": stat(rss),
        "octave_reference_files": len(validation["files"]),
        "octave_reference_values": sum(f["values"] for f in validation["files"].values()),
    }


def assemble(computed, indicators, provenance, peak_rss_bytes):
    results, failed = computed["results"], computed["failed"]
    published = [s for s in computed["scenarios"] if s["id"] in results]
    child_peaks = [r["peak_rss_bytes"] for r in computed["runs"].values() if r.get("peak_rss_bytes")]
    return {
        "data_kind": "exiobase-v3",  # compute() raises unless the Octave reference check passed
        "status": STATUS,
        "base_year": YEAR,
        "breakdown": "Region where the impact occurs (RaMa-Scene route three, Hotspot × Geographic)",
        "regions": list(next(iter(results["baseline"].values()))),
        "indicators": indicators,
        "grid": GRID,
        "scenarios": [
            {
                "id": "baseline",
                "label": f"Baseline ({YEAR}, no intervention)",
                "description": f"EXIOBASE {YEAR} as stored, no intervention.",
                "model_details": None,
            },
            *published,
        ],
        "failed": [{**s, "reason": failed[s["id"]]} for s in computed["scenarios"] if s["id"] in failed],
        "results": results,
        "runs": computed["runs"],
        "checks": computed["checks"],
        "provenance": {
            **provenance,
            "reference_validation": computed["validation"],
            "run": run_summary(computed["runs"], computed["validation"]),
            "parent_peak_rss_bytes": peak_rss_bytes,
            "peak_rss_bytes": max([peak_rss_bytes, *child_peaks]),
        },
    }


def run_log(doc):
    """data/run-log.md: engine, date, per-scenario wall/RSS and check outcome."""
    p, e, r = doc["provenance"], doc["provenance"]["engine"], doc["provenance"]["run"]
    gib = lambda b: f"{b / 2**30:.2f}" if b else "—"
    sec = lambda x: f"{x:.2f}" if x is not None else "—"
    lines = [
        "# Precompute run log",
        "",
        f"- Engine: {e.get('label') or e.get('commit')} ({'uncommitted changes' if e.get('dirty') else 'clean tree'})",
        f"- Generated: {p['generated_at']}",
        f"- Dataset: {p['dataset']['name']} {p['dataset']['year']}, doi:{p['dataset']['doi']}",
        f"- Command: `{p['command']}`",
        f"- Octave reference files: {r['octave_reference_files']} ({r['octave_reference_values']} values), "
        f"{'passed' if p['reference_validation']['passed'] else 'NOT PASSED'} at {p['reference_validation']['tolerance']}",
        f"- Scenarios run: {r['scenarios_run']}, passed every check: {r['passed']}, failed: {r['failed']}",
    ]
    if r["wall_s"]:
        lines.append(
            f"- Wall per scenario job (process start to exit): median {sec(r['wall_s']['median'])} s, "
            f"max {sec(r['wall_s']['max'])} s, total {sec(r['wall_s']['total'])} s over {r['wall_s']['n']} jobs"
        )
    if r["engine_s"]:
        lines.append(
            f"- Engine time per scenario (apply_model + 3 routes + check): median {sec(r['engine_s']['median'])} s, max {sec(r['engine_s']['max'])} s"
        )
    if r["peak_rss_bytes"]:
        lines.append(
            f"- Peak RSS per scenario worker: median {gib(r['peak_rss_bytes']['median'])} GiB, max {gib(r['peak_rss_bytes']['max'])} GiB"
        )
    lines.append(f"- Parent process peak RSS (Octave references, baseline): {gib(p['parent_peak_rss_bytes'])} GiB")
    control = doc["checks"]["zero_change_control"]
    lines.append(
        f"- 0% control: max relative difference to baseline {control['max_relative_difference']:.2e} "
        f"({control['tolerance']})"
    )
    skipped = doc["checks"]["scenario_direction"]["rise_check_skipped_indicators"]
    if skipped:
        lines.append(f"- Rise check skipped for indicators {skipped} (negative entries in B or final demand)")
    lines += [
        "",
        "| scenario | status | wall s | engine s | peak RSS GiB | note |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    reasons = {f["id"]: f["reason"] for f in doc["failed"]}
    for name, run in doc["runs"].items():
        lines.append(
            f"| {name} | {run.get('status', 'control')} | {sec(run.get('wall_s'))} | {sec(run.get('engine_s'))} | "
            f"{gib(run.get('peak_rss_bytes'))} | {reasons.get(name, '')} |"
        )
    return "\n".join(lines) + "\n"


def collect_provenance(engine_dir, data_dir, argv):
    import django

    def git(*a):
        done = subprocess.run(["git", "-C", str(engine_dir), *a], capture_output=True, text=True, check=False)
        return done.stdout.strip() if done.returncode == 0 else None

    def sha256(path):
        with open(path, "rb") as f:
            return hashlib.file_digest(f, "sha256").hexdigest()

    branch, commit = git("branch", "--show-current"), git("rev-parse", "HEAD")
    return {
        "engine": {
            "repository": public_remote(git("remote", "get-url", "origin")),
            "branch": branch,
            "commit": commit,
            "label": f"{branch or '(detached)'} @ {commit[:7]}" if commit else None,
            "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        },
        "dataset": {
            **DATASET,
            "year": YEAR,
            "sha256": {n: sha256(Path(data_dir) / str(YEAR) / f"{n}_{FILE_SUFFIX}.npy") for n in "ALYB"},
        },
        "command": public_command(argv),
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
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
        mismatches = [k for k, v in expected.items() if not math.isclose(got.get(k, math.nan), v, rel_tol=1e-6)]
        files[filename] = {"values": len(expected), "mismatches": len(mismatches)}
    return {"passed": all(f["mismatches"] == 0 for f in files.values()), "tolerance": "relative 1e-6", "files": files}


def region_leaves():
    """{region name: 0-based country indices} for REGIONS, from the engine database."""
    from ramascene import querymanagement as qm
    from ramascene.models import Country

    rows = {c.global_id: c for c in Country.objects.filter(global_id__in=REGIONS)}
    return {rows[g].name: qm.clean_local_leafs(rows[g].leaf_children_local) for g in REGIONS}


def worker_scenario(engine_dir, data_dir):
    """scenario(name, model_details, indicators) that runs `precompute.py --worker`
    in a fresh process and returns its record plus wall_s and the worker's ru_maxrss."""

    def scenario(name, model_details, indicators):
        request = json.dumps({"name": name, "model_details": model_details, "indicators": indicators})
        command = [sys.executable, __file__, "--worker", "--engine", str(engine_dir), "--data", str(data_dir)]
        started = time.perf_counter()
        done = subprocess.run(command, input=request, capture_output=True, text=True, check=False)
        wall = time.perf_counter() - started
        if done.returncode != 0:
            tail = done.stderr.strip().splitlines()[-1:] or ["(no stderr)"]
            raise ValueError(f"scenario {name}: worker exited {done.returncode}: {tail[0]}")
        record = json.loads(done.stdout.splitlines()[-1])
        if "error" in record:
            raise ValueError(f"scenario {name}: {record['error']}")
        return {**record, "wall_s": wall}

    return scenario


def worker(engine_dir, data_dir):
    """Read one scenario request from stdin, run it, print the record as one JSON line."""
    from ramascene import querymanagement as qm

    request = json.loads(sys.stdin.read())
    engine = real_engine()
    Y, B = qm.get_numpy_objects(YEAR, "Y"), qm.get_numpy_objects(YEAR, "B")
    try:
        record = scenario_in_process(engine, request["name"], request["model_details"], request["indicators"], Y, B)
    except ValueError as e:
        record = {"error": str(e)}
    record["peak_rss_bytes"] = peak_rss_bytes()
    print(json.dumps(record, allow_nan=True))


def real_engine(engine_dir=None, data_dir=None):
    from ramascene import querymanagement as qm

    return types.SimpleNamespace(
        load=lambda name: qm.get_numpy_objects(YEAR, name),
        apply_model=apply_model,
        by_region=by_region,
        region_leaves=region_leaves(),
        reference_validation=reference_validation,
        scenario=worker_scenario(engine_dir, data_dir) if engine_dir else None,
    )


def indicator_meta(indicators):
    from ramascene import querymanagement as qm

    names = qm.get_names_indicator(indicators)
    units = qm.get_indicator_units(indicators)
    return [{"id": i, "name": n, "unit": units[n]} for i, n in zip(indicators, names)]


SCENARIO_SETS = {"all": lambda: ALL_SCENARIOS, "original": lambda: SCENARIOS, "grid": grid_scenarios}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="really run the full-size engine (about 1.6 GB (1.53 GiB) peak per worker in the shipped run)")
    parser.add_argument("--engine", type=Path, required=True, help="RaMa-Scene checkout")
    parser.add_argument("--data", type=Path, required=True, help="DATASETS_DIR holding 2011/{A,L,Y,B}_v4.npy")
    parser.add_argument("--out", type=Path, help="results JSON; data/run-log.md is written beside it")
    parser.add_argument("--scenarios", choices=sorted(SCENARIO_SETS), default="all")
    parser.add_argument("--limit", type=int, help="only the first N scenarios of the set (smoke test)")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker:
        with tempfile.TemporaryDirectory() as tmp:
            setup_django(args.engine.resolve(), args.data.resolve(), Path(tmp) / "db.sqlite3")
            worker(args.engine.resolve(), args.data.resolve())
        return
    if not args.out:
        parser.error("--out is required")
    if not args.run:
        parser.error("refusing to start the full-size engine (about 1.6 GB peak per scenario) without --run")
    scenarios = SCENARIO_SETS[args.scenarios]()[: args.limit]

    with tempfile.TemporaryDirectory() as tmp:
        setup_django(args.engine.resolve(), args.data.resolve(), Path(tmp) / "db.sqlite3")
        engine = real_engine(args.engine.resolve(), args.data.resolve())
        computed = compute(engine, scenarios, INDICATORS)
        output = assemble(
            computed,
            indicator_meta(INDICATORS),
            collect_provenance(args.engine, args.data, argv),
            peak_rss_bytes(),
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=1, ensure_ascii=False, allow_nan=False) + "\n")
    (args.out.parent / "run-log.md").write_text(run_log(output))
    r = output["provenance"]["run"]
    print(
        f"{args.out}: data_kind={output['data_kind']}, {r['passed']} of {r['scenarios_run']} scenarios passed, "
        f"{r['failed']} failed; peak RSS {output['provenance']['peak_rss_bytes'] / 2**30:.2f} GiB"
    )


if __name__ == "__main__":
    main()
