"""pipeline/ask.py: the cases tests/ask.test.js runs on src/lib/ask.js, the result shape, and one published scenario."""

import json
import os
import re
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import ask
import ask_eval
import numpy_engine as ne

ROOT = Path(__file__).resolve().parent.parent
STORE = os.environ.get("BROWSER_ENGINE_DATA")
CASES = json.loads((ROOT / "tests/ask-cases.json").read_text(encoding="utf-8"))
CATALOG = CASES["catalog"]
DETAIL = CATALOG | {"products": CASES["detail_products"]}
# the WebMCP tool's kinds, by the catalogue kinds the cases name
TOOL_KINDS = {v: k for k, v in ask.KINDS.items()}


def catalog_of(case):
    return DETAIL if case.get("detail") else CATALOG


def levers_of(case):
    return [CASES["lever"] | lever if isinstance(lever, dict) else lever for lever in case["levers"]]


@pytest.mark.parametrize("case", CASES["find_names"], ids=lambda c: f"{c['kind']} {c['query']!r}")
def test_find_names_matches_the_shared_cases(case):
    store = SimpleNamespace(meta={"catalog": catalog_of(case)})
    assert ask.find_names(store, TOOL_KINDS[case["kind"]], case["query"]) == case["names"]


def test_find_names_refuses_an_unknown_kind():
    with pytest.raises(ValueError, match="kind must be one of products, regions, industries"):
        ask.find_names(SimpleNamespace(meta={"catalog": CATALOG}), "consumers", "steel")


@pytest.mark.parametrize(
    "case",
    CASES["to_model_details"],
    ids=[f"{i} {c.get('error', 'maps')}" for i, c in enumerate(CASES["to_model_details"])],
)
def test_to_model_details_matches_the_shared_cases(case):
    if "error" in case:
        with pytest.raises(ValueError, match=f"^{re.escape(case['error'])}$"):
            ask.to_model_details(levers_of(case), catalog_of(case))
    else:
        assert ask.to_model_details(levers_of(case), catalog_of(case)) == case["model_details"]


def test_to_model_details_refuses_more_than_ten_levers():
    with pytest.raises(ValueError, match="the answer has more than 10 changes"):
        ask.to_model_details([CASES["lever"]] * 11, CATALOG)
    assert len(ask.to_model_details([CASES["lever"]] * 10, CATALOG)) == 10


def test_to_model_details_rejects_non_finite_and_accepts_tuple_consumers():
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError, match=r"^change 1: the change must be a number \(percent\)$"):
            ask.to_model_details([CASES["lever"] | {"change_percent": bad}], CATALOG)
    got = ask.to_model_details([CASES["lever"] | {"consumed_by": ("Y: Final Consumption",)}], CATALOG)
    assert got[0]["consumedBy"] == [276]


@pytest.mark.parametrize("case", CASES["lever_text"], ids=lambda c: c["text"])
def test_lever_text_matches_the_shared_cases(case):
    assert ask.lever_text(CASES["lever"] | case["lever"]) == case["text"]


def test_the_eval_names_the_catalogue_as_the_api_does(tmp_path):
    # evals/ask/ask_eval.py keeps its own copy, as it runs on a model host with the stdlib only
    for catalog in (CATALOG, DETAIL):
        (tmp_path / "m.json").write_text(json.dumps({"catalog": catalog}), encoding="utf-8")
        (tmp_path / "r.json").write_text(json.dumps({"scenarios": []}), encoding="utf-8")
        assert ask_eval.load(tmp_path / "m.json", tmp_path / "r.json")[0] == ask.names_of(catalog)


def test_run_whatif_returns_the_page_result(monkeypatch):
    # 2 indicators, 2 countries, 2 sections; each flow's value is known so multi-section totals are checked
    regions = [{"id": 1, "name": "Total", "leaves": [0, 1]}, {"id": 7, "name": "China", "leaves": [1]},
               {"id": 6, "name": "Austria", "leaves": [0]}]  # fmt: skip
    meta = {"countries": 2, "indicators": [5, 3], "sections": [1, 2], "catalog": CATALOG | {"regions": regions}}
    store = SimpleNamespace(meta=meta, baseline=np.arange(16.0, 32.0))
    sent = []
    monkeypatch.setattr(ne, "scenario_flows", lambda s, steps: sent.append(steps) or np.arange(16.0).reshape(8, 2))
    lever = CASES["lever"] | {"origin_region": "Total", "consumed_region": "Total"}
    got = ask.run_whatif(store, [lever])
    assert sent == [got["model_details"]] == [[{"product": [180], "originReg": [1], "consumedBy": [276],
                                                "consumedReg": [1], "techChange": [-20]}]]  # fmt: skip
    assert got["changes"] == ["Motor vehicles, made in all regions, used by Y: Final Consumption in all regions: −20%"]
    assert got["regions"] == ["Austria", "China"]
    assert got["indicators"] == [{"id": 5}, {"id": 3}]
    # flat index ((indicator * 2 + producer) * 2 + section) * 2 + consumer
    assert got["results"] == {
        "baseline": {5: {"Austria": 70.0, "China": 86.0}, 3: {"Austria": 102.0, "China": 118.0}},
        "scenario": {5: {"Austria": 6.0, "China": 22.0}, 3: {"Austria": 38.0, "China": 54.0}},
    }
    assert got["flows"]["scenario"].shape == got["flows"]["baseline"].shape == (2, 2, 2, 2)
    got["flows"]["baseline"][:] = 0
    assert store.baseline[0] == 16.0


def test_run_whatif_checks_the_levers_before_the_engine(monkeypatch):
    monkeypatch.setattr(ne, "scenario_flows", lambda *_: pytest.fail("the engine ran"))
    store = SimpleNamespace(meta={"catalog": CATALOG})
    with pytest.raises(ValueError, match='"Gold" is not in the catalogue'):
        ask.run_whatif(store, [CASES["lever"] | {"product": "Gold"}])


needs_store = pytest.mark.skipif(
    not STORE and not os.environ.get("CI"),
    reason="set BROWSER_ENGINE_DATA to the browser store (docs/browser-engine.md)",
)


@pytest.mark.store
@needs_store
def test_published_levers_map_to_their_steps():
    # every published scenario, as names, maps back to its own steps on the real catalogue
    assert STORE, "BROWSER_ENGINE_DATA is not set; fetch the browser store, see docs/browser-engine.md"
    names, scenarios, _ = ask_eval.load(Path(STORE) / "manifest-v3.json", ROOT / "data/results.json")
    catalog = json.loads((Path(STORE) / "manifest-v3.json").read_text(encoding="utf-8"))["catalog"]
    assert len(scenarios) == 155
    for s in scenarios.values():
        levers = [ask_eval.to_names(step, names) for step in s["model_details"]]
        assert ask.to_model_details(levers, catalog) == s["model_details"], s["id"]


# the Ask panel's few-shot examples (EXAMPLES in ask.js): a final-demand change and a technical one
PUBLISHED = {
    "vehicle-demand-europe": {"product": "Motor vehicles, trailers and semi-trailers", "origin_region": "Europe",
                              "consumed_by": ["Y: Final Consumption"], "consumed_region": "Europe",
                              "change_percent": -20},
    "aluminium-europe-10": {"product": "Aluminium and aluminium products", "origin_region": "Total",
                            "consumed_by": [ask.ALL], "consumed_region": "Europe", "change_percent": -10},
}  # fmt: skip


@pytest.mark.store
@needs_store
@pytest.mark.parametrize("scenario", PUBLISHED)
def test_run_whatif_matches_a_published_scenario(scenario):
    assert STORE, "BROWSER_ENGINE_DATA is not set; fetch the browser store, see docs/browser-engine.md"
    store = ne.open_store(STORE)
    reference = json.loads((ROOT / "data/results.json").read_text(encoding="utf-8"))
    published = next(s for s in reference["scenarios"] if s["id"] == scenario)
    got = ask.run_whatif(store, [PUBLISHED[scenario]])
    assert got["model_details"] == published["model_details"]
    continents = [r for r in store.meta["catalog"]["regions"] if 2 <= r["id"] <= 6]
    names = got["regions"]
    worst = 0.0
    for indicator, by_country in got["results"]["scenario"].items():
        for r in continents:
            total = sum(by_country[names[leaf]] for leaf in r["leaves"])
            want = reference["results"][scenario][str(indicator)][r["name"]]
            worst = max(worst, abs(total - want) / abs(want))
    print(f"worst relative difference: {worst:.2e}")
    # NOTE: test_published_scenarios_match_ramascene holds all 155 to 1e-8 (float32 store, 5.5e-9 measured)
    assert worst <= 1e-8
