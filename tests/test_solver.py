"""precompute leaves the solver to the engine and records which L each run got.

A fake ramascene.modelling stands in for the engine: no checkout, no matrix.
The performance engine (PR #74) picks a Woodbury update of the published L
(LowRankLeontief) or one factorization of (I - A) (LeontiefSolve) inside
Modelling.apply_model, which takes no solver argument, so neither does
precompute.
"""

import sys
import types

import numpy as np

import precompute


def fake_modelling(monkeypatch, L):
    calls = []

    class Modelling:
        def __init__(self, ready, Y, load_A, year, model_details, *args, **kwargs):
            calls.append((args, kwargs))

        def apply_model(self):
            return "Y_s", L

    module = types.ModuleType("ramascene.modelling")
    module.__dict__["Modelling"] = Modelling
    monkeypatch.setitem(sys.modules, "ramascene.modelling", module)
    monkeypatch.setattr(precompute, "model_inputs", lambda model_details: ({}, [True]))
    return calls


def test_modelling_gets_no_solver_argument(monkeypatch):
    calls = fake_modelling(monkeypatch, "L_s")
    assert precompute.apply_model([], None) == ("Y_s", "L_s")
    assert calls == [((), {})]


def test_each_run_records_the_class_of_its_L():
    LowRankLeontief = type("LowRankLeontief", (), {"dot": lambda self, v: v})
    engine = types.SimpleNamespace(
        apply_model=lambda model_details, Y: (Y, LowRankLeontief()),
        by_region=lambda i, Y, B, L: {"Europe": 1.0},
        region_leaves={"Europe": [0]},
    )
    record = precompute.scenario_in_process(engine, "s", [], [1], np.ones((1, 1)), np.ones((1, 1)))
    assert record["solver"] == "LowRankLeontief"


def test_run_summary_counts_the_solvers_and_the_run_log_names_them():
    from tests.test_precompute import assembled

    doc = assembled()
    runs = {
        "a": {"status": "passed", "solver": "LowRankLeontief"},
        "b": {"status": "passed", "solver": "LeontiefSolve"},
        "c": {"status": "passed", "solver": "LowRankLeontief"},
        "zero_change_control": {"solver": "LowRankLeontief"},
    }
    summary = precompute.run_summary(runs, doc["provenance"]["reference_validation"])
    assert summary["solvers"] == {"LowRankLeontief": 2, "LeontiefSolve": 1}
    doc["provenance"]["run"] = summary
    assert "- L per scenario: LowRankLeontief (2), LeontiefSolve (1)" in precompute.run_log(doc)


def test_run_log_names_the_pull_request():
    from tests.test_precompute import assembled

    doc = assembled()
    p = doc["provenance"]
    url = "https://github.com/CMLPlatform/ramascene/pull/74"
    doc["provenance"] = {**p, "engine": {**p["engine"], "pull_request": url}}
    assert url in precompute.run_log(doc).splitlines()[2]
