"""Run the RaMa-Scene engine over a fixed scenario grid and write one JSON file.

    uv run python precompute.py --run --engine ../ramascene-review \\
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
# Detail level of the extra outputs: the 49 leaf regions (country global ids
# 7..55) and the 15 level-2 product aggregates (product global ids 2..16).
COUNTRIES = list(range(7, 56))
SECTORS = list(range(2, 17))
TOP_FLOWS = 12
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


def independent_by_region(indicator, Y, B, L, engine_values, region_leaves):
    """B_i * (L . sum(Y)) per region, computed without Analyze.

    Rows are country-major (index = country * 200 + product, as
    productindexmanger builds them), so the vector reshapes to (country,
    product); each region sums its leaf countries (leaf_children_local).
    """
    countries = sum(len(c) for c in region_leaves.values())
    # L.dot, not @: the solving engine's L is an object with dot and T, not an array
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


class MemoDot:
    """L.dot(v) computed once per distinct v: a solving engine factorises on every call."""

    def __init__(self, L):
        self.L, self.seen = L, {}

    def dot(self, v):
        key = (v.shape, v.dtype.str, v.tobytes())
        if key not in self.seen:
            self.seen[key] = self.L.dot(v)
        return self.seen[key]


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
    """Every scenario is a -20% cut: it must change the result and, on
    non-negative B, y, A and L, must not raise any indicator total.

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
            if total > ref_total and not math.isclose(total, ref_total, rel_tol=1e-9, abs_tol=ABS_FLOOR):
                rises.append({"scenario": s["id"], "indicator": int(i), "total": total, "reference": ref_total})
    return {
        "passed": not unchanged and not rises,
        "references": references,
        "unchanged": unchanged,
        "rises": rises,
        "rise_check_skipped_indicators": skipped,
    }


def reconcile_aggregates(by_aggregate, by_country, members):
    """Each continental aggregate must equal the sum of its member countries.

    members: {aggregate name: [country name]}; the members must partition the
    countries. Relative 1e-9 with the absolute floor, per aggregate.
    """
    listed = sorted(c for cs in members.values() for c in cs)
    partition = listed == sorted(by_country)
    aggregates = {
        agg: {"aggregate": by_aggregate.get(agg, math.nan), "members": math.fsum(by_country[c] for c in cs if c in by_country)}
        for agg, cs in members.items()
    }
    return {
        "aggregates": aggregates,
        "passed": partition
        and set(by_aggregate) == set(members)
        and all(math.isclose(a["aggregate"], a["members"], rel_tol=1e-9, abs_tol=ABS_FLOOR) for a in aggregates.values()),
    }


def reconcile_sectors(by_country, by_sector_country):
    """Summed over the sectors, the sector × country cells must give each country's value."""
    sums = {c: math.fsum(cells[c] for cells in by_sector_country.values()) for c in by_country}
    worst = max((relative_difference(sums[c], by_country[c]) for c in by_country), default=0.0)
    return {"passed": worst <= 1e-9, "max_relative_difference": worst}


def top_flows(baseline_cells, scenario_cells, n=TOP_FLOWS):
    """Sector → region flows of the change, the n largest cells by |delta| named.

    Sectors and regions that appear in a named cell become nodes; every other
    cell is added to the flow between "Other sectors" / "Other regions" (or the
    named node on the side that is named), so the shown flows plus the "other"
    flows sum to the total delta exactly (fsum), with nothing dropped.
    """
    deltas = {
        (sector, region): scenario_cells[sector][region] - baseline_cells[sector][region]
        for sector in baseline_cells
        for region in baseline_cells[sector]
    }
    top = sorted(deltas, key=lambda k: abs(deltas[k]), reverse=True)[:n]
    named_sectors, named_regions = {s for s, _ in top}, {r for _, r in top}
    lumped = {}
    for (sector, region), d in deltas.items():
        if (sector, region) in top:
            continue
        key = (sector if sector in named_sectors else "Other sectors", region if region in named_regions else "Other regions")
        lumped.setdefault(key, []).append(d)
    flows = [{"sector": s, "region": r, "delta": deltas[(s, r)], "named": True} for s, r in top]
    flows += [{"sector": s, "region": r, "delta": math.fsum(v), "named": False, "cells": len(v)} for (s, r), v in sorted(lumped.items())]
    total = math.fsum(deltas.values())
    shown = math.fsum(f["delta"] for f in flows)
    return {
        "total_delta": total,
        "flows": flows,
        "cells": len(deltas),
        "reconciled": math.isclose(shown, total, rel_tol=1e-12, abs_tol=ABS_FLOOR),
        "shown_plus_other": shown,
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
    # Optional detail (the real engine has it, a minimal fake need not): the 49
    # leaf regions and the sector × region cells, with their reconciliations.
    detailed = hasattr(engine, "by_country")
    countries, cells, detail_checks = {}, {}, {"independent_by_country": [], "aggregates": [], "sectors": []}

    def run(name, Y_s, L_s):
        by_indicator = {}
        L_memo = MemoDot(L_s)
        for i in indicators:
            values = engine.by_region(i, Y_s, B, L_s)
            if not np.isfinite(list(values.values())).all():
                raise ValueError(f"non-finite engine output, {name}, indicator {i}: {values}")
            by_indicator[str(i)] = values
            independent.append({"run": name, **independent_by_region(i, Y_s, B, L_memo, values, engine.region_leaves)})
            if detailed:
                # L_memo: the 16 detail routes share one L·y, solved once per run
                by_country = engine.by_country(i, Y_s, B, L_memo)
                by_sector = engine.by_sector_country(i, Y_s, B, L_memo)
                if not np.isfinite([*by_country.values(), *(v for c in by_sector.values() for v in c.values())]).all():
                    raise ValueError(f"non-finite engine detail output, {name}, indicator {i}")
                countries.setdefault(name, {})[str(i)] = by_country
                cells.setdefault(name, {})[str(i)] = by_sector
                tag = {"run": name, "indicator": i}
                detail_checks["independent_by_country"].append(
                    {**tag, **independent_by_region(i, Y_s, B, L_memo, by_country, engine.country_leaves)}
                )
                detail_checks["aggregates"].append({**tag, **reconcile_aggregates(values, by_country, engine.aggregate_members)})
                detail_checks["sectors"].append({**tag, **reconcile_sectors(by_country, by_sector)})
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
            "passed": worst <= 1e-6,
            "max_relative_difference": worst,
            "tolerance": "relative 1e-6",
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
    computed = {"results": results, "checks": checks, "validation": validation}
    if detailed:
        flows = {
            s["id"]: {i: top_flows(cells["baseline"][i], cells[s["id"]][i]) for i in cells[s["id"]]}
            for s in scenarios
        }
        detail_checks["flows"] = {
            "passed": all(f["reconciled"] for by_i in flows.values() for f in by_i.values()),
            "tolerance": "relative 1e-12",
        }
        failed = [k for k, v in detail_checks.items() if not (v["passed"] if isinstance(v, dict) else all(t["passed"] for t in v))]
        if failed:
            raise ValueError(f"detail verification failed ({', '.join(failed)}), nothing written: {json.dumps(detail_checks, indent=1)}")
        computed["detail"] = {"countries": countries, "flows": flows, "checks": detail_checks}
    return computed


def scenario_list():
    baseline = {
        "id": "baseline",
        "label": f"Baseline ({YEAR}, no intervention)",
        "description": f"EXIOBASE {YEAR} as stored, no intervention.",
        "model_details": None,
    }
    return [baseline, *SCENARIOS]


def assemble(computed, indicators, provenance, peak_rss_bytes):
    results = computed["results"]
    return {
        "data_kind": "exiobase-v3",  # compute() raises unless the Octave reference check passed
        "status": STATUS,
        "base_year": YEAR,
        "breakdown": "Region where the impact occurs (RaMa-Scene route three, Hotspot × Geographic)",
        "regions": list(next(iter(results["baseline"].values()))),
        "indicators": indicators,
        "scenarios": scenario_list(),
        "results": results,
        "checks": computed["checks"],
        "provenance": {
            **provenance,
            "reference_validation": computed["validation"],
            "peak_rss_bytes": peak_rss_bytes,
        },
    }




def assemble_regions(computed, indicators, country_meta, provenance, peak_rss_bytes):
    """The 49-region breakdown, same route as results.json but not aggregated."""
    detail = computed["detail"]
    return {
        "data_kind": "exiobase-v3",
        "status": STATUS,
        "base_year": YEAR,
        "breakdown": "Region where the impact occurs (RaMa-Scene route three, Hotspot × Geographic), the 49 EXIOBASE regions",
        "regions": [c["name"] for c in country_meta],
        "region_codes": {c["name"]: c["code"] for c in country_meta},
        "aggregates": {agg: [c["name"] for c in country_meta if c["aggregate"] == agg] for agg in dict.fromkeys(c["aggregate"] for c in country_meta)},
        "indicators": indicators,
        "scenarios": scenario_list(),
        # the published runs only; the 0% control stays in the checks
        "results": {s["id"]: detail["countries"][s["id"]] for s in scenario_list()},
        "checks": {k: detail["checks"][k] for k in ("independent_by_country", "aggregates")},
        "provenance": {**provenance, "reference_validation": computed["validation"], "peak_rss_bytes": peak_rss_bytes},
    }


def assemble_flows(computed, indicators, sector_names, provenance, peak_rss_bytes):
    """Sector → region flows of the change, top cells named, the rest lumped."""
    detail = computed["detail"]
    return {
        "data_kind": "exiobase-v3",
        "status": STATUS,
        "base_year": YEAR,
        "breakdown": "Change (intervention minus baseline) per sector of production × region where the impact occurs; "
        "RaMa-Scene route three (Hotspot × Geographic) run once per level-2 product aggregate over the 49 regions",
        "method": f"The {TOP_FLOWS} cells with the largest |delta| are named; every other cell is added to the flow "
        "between the named node on its side or 'Other sectors' / 'Other regions', so named plus other flows sum to the total delta.",
        "sectors": sector_names,
        "indicators": indicators,
        "scenarios": scenario_list(),
        "results": detail["flows"],
        "checks": {k: detail["checks"][k] for k in ("sectors", "flows")},
        "provenance": {**provenance, "reference_validation": computed["validation"], "peak_rss_bytes": peak_rss_bytes},
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


def by_country(indicator, Y, B, L):
    """Where the impact occurs (route three), per leaf region, all products."""
    selection = {
        "dimType": "Hotspot",
        "vizType": "Geographic",
        "nodesSec": [1],
        "nodesReg": list(COUNTRIES),
        "extn": [indicator],
        "year": YEAR,
    }
    return run_route(selection, Y, B, L)


def by_sector_country(indicator, Y, B, L):
    """Route three once per level-2 product aggregate: {sector: {leaf region: value}}."""
    from ramascene import querymanagement as qm

    out = {}
    for sector, name in zip(SECTORS, qm.get_names_product(SECTORS)):
        selection = {
            "dimType": "Hotspot",
            "vizType": "Geographic",
            "nodesSec": [sector],
            "nodesReg": list(COUNTRIES),
            "extn": [indicator],
            "year": YEAR,
        }
        out[name] = run_route(selection, Y, B, L)
    return out


def country_meta():
    """The 49 leaf regions of the engine database: name, code, 0-based index, aggregate."""
    from ramascene.models import Country

    parents = {c.global_id: c.name for c in Country.objects.filter(global_id__in=REGIONS)}
    rows = Country.objects.filter(global_id__in=COUNTRIES).order_by("local_id")
    return [{"name": c.name, "code": c.code, "index": c.local_id - 1, "aggregate": parents[c.parent_id]} for c in rows]


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


def real_engine():
    from ramascene import querymanagement as qm

    meta = country_meta()
    return types.SimpleNamespace(
        load=lambda name: qm.get_numpy_objects(YEAR, name),
        apply_model=apply_model,
        by_region=by_region,
        by_country=by_country,
        by_sector_country=by_sector_country,
        region_leaves=region_leaves(),
        country_leaves={c["name"]: [c["index"]] for c in meta},
        aggregate_members={
            agg: [c["name"] for c in meta if c["aggregate"] == agg] for agg in dict.fromkeys(c["aggregate"] for c in meta)
        },
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
    parser.add_argument("--run", action="store_true", help="really run the full-size engine (~4.0 GB peak)")
    parser.add_argument("--engine", type=Path, required=True, help="RaMa-Scene checkout")
    parser.add_argument("--data", type=Path, required=True, help="DATASETS_DIR holding 2011/{A,L,Y,B}_v4.npy")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--out-regions", type=Path, help="also write the 49-region breakdown here")
    parser.add_argument("--out-flows", type=Path, help="also write the sector → region flows of the change here")
    args = parser.parse_args(argv)
    if not args.run:
        parser.error("refusing to start the full-size engine (~4.0 GB peak per scenario) without --run")

    started = time.monotonic()
    with tempfile.TemporaryDirectory() as tmp:
        setup_django(args.engine.resolve(), args.data.resolve(), Path(tmp) / "db.sqlite3")
        computed = compute(real_engine(), SCENARIOS, INDICATORS)
        indicators = indicator_meta(INDICATORS)
        provenance = {**collect_provenance(args.engine, args.data, argv), "wall_seconds": round(time.monotonic() - started, 1)}
        peak = peak_rss_bytes()
        output = assemble(computed, indicators, provenance, peak)
        extra = {}
        if args.out_regions:
            extra[args.out_regions] = assemble_regions(computed, indicators, country_meta(), provenance, peak)
        if args.out_flows:
            from ramascene import querymanagement as qm

            extra[args.out_flows] = assemble_flows(computed, indicators, qm.get_names_product(SECTORS), provenance, peak)
    for path, doc in {args.out: output, **extra}.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False, allow_nan=False) + "\n")
        print(f"{path}: data_kind={doc['data_kind']}, peak RSS {peak / 2**30:.2f} GiB, wall {provenance['wall_seconds']} s")


if __name__ == "__main__":
    main()
