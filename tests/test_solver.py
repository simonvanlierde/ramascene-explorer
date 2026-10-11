"""precompute.apply_model hands Modelling the engine's kept-LU solver when it has one.

A fake ramascene.modelling stands in for the engine: no checkout, no matrix.
With perf/lu-reuse (LeontiefLU) each modified A is factorized once and every
route and check of the scenario solves from those factors; an engine without
it (perf/solve-not-invert, whose Modelling takes no solver argument) gets its
own default.
"""

import sys
import types

import pytest

import precompute


def fake_modelling(monkeypatch, with_lu):
    calls = []

    class Modelling:
        def __init__(self, ready, Y, load_A, year, model_details, **kwargs):
            calls.append(kwargs)

        def apply_model(self):
            return "Y_s", "L_s"

    module = types.ModuleType("ramascene.modelling")
    module.__dict__["Modelling"] = Modelling
    if with_lu:
        module.__dict__["LeontiefLU"] = type("LeontiefLU", (), {})
    monkeypatch.setitem(sys.modules, "ramascene.modelling", module)
    monkeypatch.setattr(precompute, "model_inputs", lambda model_details: ({}, [True]))
    return module, calls


def test_an_engine_with_a_kept_lu_gets_it_as_the_solver(monkeypatch):
    module, calls = fake_modelling(monkeypatch, with_lu=True)
    assert precompute.leontief_solver() is module.LeontiefLU
    assert precompute.apply_model([], None) == ("Y_s", "L_s")
    assert calls == [{"solver": module.LeontiefLU}]


def test_an_engine_without_it_is_called_as_before(monkeypatch):
    _, calls = fake_modelling(monkeypatch, with_lu=False)
    assert precompute.leontief_solver() is None
    assert precompute.apply_model([], None) == ("Y_s", "L_s")
    assert calls == [{}]  # no solver keyword: a258e63's Modelling would reject it


@pytest.mark.parametrize(("with_lu", "name"), [(True, "LeontiefLU"), (False, "engine default")])
def test_the_solver_is_named_for_the_provenance(monkeypatch, with_lu, name):
    fake_modelling(monkeypatch, with_lu)
    assert precompute.solver_name() == name


def test_run_log_names_the_solver():
    from tests.test_precompute import assembled

    doc = assembled()
    p = doc["provenance"]
    doc["provenance"] = {**p, "engine": {**p["engine"], "solver": "LeontiefLU"}}
    assert "solver LeontiefLU" in precompute.run_log(doc).splitlines()[2]
