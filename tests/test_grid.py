"""The material-efficiency grid: its definition as data, and the shipped results against it.

The definition tests need nothing installed. The results tests read
data/results.json when it exists and skip otherwise; they hold every published
scenario to the checks precompute.py ran.
"""

import json
import re
from pathlib import Path

import pytest

import precompute

GRID = precompute.grid_scenarios()
BY_ID = {s["id"]: s for s in GRID}
RESULTS = Path(__file__).parent.parent / "data" / "results.json"


def test_grid_is_five_products_by_five_regions_by_three_cuts():
    assert len(GRID) == 75 and len(BY_ID) == 75
    assert len(precompute.GRID_PRODUCTS) == 5 and len(precompute.GRID_REGIONS) == 5
    assert precompute.GRID_CUTS == [-10, -20, -50]
    products = [p["slug"] for p in precompute.GRID_PRODUCTS]
    regions = [r["slug"] for r in precompute.GRID_REGIONS]
    assert [s["grid"] for s in GRID] == [
        {"product": p, "region": r, "cut": c} for p in products for r in regions for c in precompute.GRID_CUTS
    ]


def test_regions_are_the_five_continental_aggregates_of_the_engine_database():
    assert [r["id"] for r in precompute.GRID_REGIONS] == precompute.REGIONS == [2, 3, 4, 5, 6]
    assert [r["name"] for r in precompute.GRID_REGIONS] == [
        "Europe",
        "Middle-East",
        "America",
        "Asia-Pacific",
        "Africa",
    ]


def test_products_are_named_by_their_exiobase_product_name():
    # ramascene_product global ids and names, as db.sqlite3 has them (checked 2026-09-27)
    assert {p["id"]: p["name"] for p in precompute.GRID_PRODUCTS} == {
        180: "Basic iron and steel and of ferro-alloys and first products thereof",
        184: "Aluminium and aluminium products",
        177: "Cement, lime and plaster",
        162: "Plastics, basic",
        196: "Electrical machinery and apparatus n.e.c.",
    }
    for p in precompute.GRID_PRODUCTS:
        assert re.fullmatch(r"[a-z]+", p["slug"]) and p["short"]


def test_every_cell_is_one_verbatim_intervention_of_the_same_shape():
    for s in GRID:
        product = next(p for p in precompute.GRID_PRODUCTS if p["slug"] == s["grid"]["product"])
        region = next(r for r in precompute.GRID_REGIONS if r["slug"] == s["grid"]["region"])
        (step,) = s["model_details"]
        assert step == {
            "product": [product["id"]],
            "originReg": precompute.ALL_REGIONS,
            "consumedBy": precompute.INDUSTRY_SECTIONS,
            "consumedReg": [region["id"]],
            "techChange": [s["grid"]["cut"]],
        }
        assert precompute.loads_A(s)  # a technical-coefficient cut: goes through the modified-A path
        assert s["id"] == f"{product['slug']}-{region['slug']}-{abs(s['grid']['cut'])}"
        assert (
            product["short"] in s["label"]
            and region["name"] in s["label"]
            and f"−{abs(s['grid']['cut'])}%" in s["label"]
        )
        assert product["name"].lower() in s["description"] and region["name"] in s["description"]


def test_consumed_by_is_the_fifteen_industry_sections():
    assert precompute.INDUSTRY_SECTIONS == list(range(1, 16))
    assert precompute.GRID["consumed_by"] == precompute.INDUSTRY_SECTIONS
    assert precompute.FINAL_CONSUMPTION not in precompute.INDUSTRY_SECTIONS


def test_all_scenarios_are_the_three_originals_then_the_grid_with_unique_ids():
    ids = [s["id"] for s in precompute.ALL_SCENARIOS]
    assert ids[:3] == ["vehicle-demand-europe", "steel-in-vehicles-europe", "cement-in-construction"]
    assert ids[3:] == list(BY_ID) and len(set(ids)) == 78
    assert precompute.SCENARIO_SETS["all"]() == precompute.ALL_SCENARIOS
    assert precompute.SCENARIO_SETS["grid"]() == GRID


# --- the shipped results -------------------------------------------------------


@pytest.fixture(scope="module")
def shipped():
    if not RESULTS.exists():
        pytest.skip("no data/results.json: run precompute.py --run first")
    return json.loads(RESULTS.read_text())


def test_shipped_results_are_engine_output_over_the_whole_grid(shipped):
    assert shipped["data_kind"] == "exiobase-v3"
    assert shipped["grid"] == precompute.GRID
    published = {s["id"] for s in shipped["scenarios"]} - {"baseline"}
    failed = {f["id"] for f in shipped["failed"]}
    assert not published & failed
    assert published | failed == {s["id"] for s in precompute.ALL_SCENARIOS}
    assert set(shipped["results"]) == published | {"baseline"}
    assert shipped["scenarios"][1:] == [s for s in precompute.ALL_SCENARIOS if s["id"] in published]


def test_every_published_scenario_passed_every_check(shipped):
    checks, runs = shipped["checks"], shipped["runs"]
    published = {s["id"] for s in shipped["scenarios"]}
    assert checks["published_passed_every_check"] is True
    assert shipped["provenance"]["reference_validation"]["passed"] is True
    assert checks["zero_change_control"]["passed"] is True
    independent = [c for c in checks["independent_by_region"] if c["run"] in published]
    assert {c["run"] for c in independent} == published
    assert all(c["passed"] for c in independent)
    assert len(independent) == len(published) * len(shipped["indicators"])
    direction = checks["scenario_direction"]
    assert not (set(direction["unchanged"]) | {r["scenario"] for r in direction["rises"]}) & published
    for sid in published - {"baseline"}:
        assert runs[sid]["status"] == "passed", sid
        assert runs[sid]["wall_s"] > 0 and runs[sid]["peak_rss_bytes"] > 0
    for f in shipped["failed"]:
        assert runs[f["id"]]["status"] == "failed" and f["reason"]


def test_shipped_provenance_names_the_engine_and_the_run(shipped):
    p = shipped["provenance"]
    assert re.fullmatch(r"[0-9a-f]{40}", p["engine"]["commit"])
    assert p["engine"]["label"] == f"{p['engine']['branch']} @ {p['engine']['commit'][:7]}"
    assert p["engine"]["dirty"] is False
    r = p["run"]
    assert r["scenarios_run"] == r["passed"] + r["failed"] == 78
    assert r["octave_reference_files"] == 4 and r["octave_reference_values"] == 122
    assert r["peak_rss_bytes"]["max"] <= p["peak_rss_bytes"]
    assert (RESULTS.parent / "run-log.md").exists()
