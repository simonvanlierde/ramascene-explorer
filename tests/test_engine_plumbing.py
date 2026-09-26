"""The real-engine adapter in precompute.py, against a RaMa-Scene checkout.

Opt-in: `pytest --engine ../ramascene-review`. Needs the engine code and its
db.sqlite3, no dataset. The one full-size array is the harness's identity L
(768 MB, ramascene/tests/test_engine_regression.py::synthetic_matrices);
nothing here inverts a matrix or calls Modelling.apply_model.
"""

from pathlib import Path

import numpy as np
import pytest

import precompute

N, COUNTRIES, INDICATOR_ROWS = 9800, 49, 60


@pytest.fixture(scope="module")
def engine(request, tmp_path_factory):
    path = request.config.getoption("--engine")
    if not path:
        pytest.skip("needs --engine PATH (a RaMa-Scene checkout)")
    precompute.setup_django(
        Path(path).resolve(), tmp_path_factory.mktemp("data"), tmp_path_factory.mktemp("db") / "db.sqlite3"
    )
    from ramascene import querymanagement

    return querymanagement


EXPECTED = {
    # id: (product name, consumed-by name, origin leaves, consumed leaves, loads A)
    "vehicle-demand-europe": ("Motor vehicles, trailers and semi-trailers", "Y: Final Consumption", 32, 32, False),
    "steel-in-vehicles-europe": (
        "Basic iron and steel and of ferro-alloys and first products thereof",
        "S: Motor vehicles, trailers and semi-trailers",
        49,
        32,
        True,
    ),
    "cement-in-construction": ("Cement, lime and plaster", "S: Construction work", 49, 49, True),
}


@pytest.mark.parametrize("scenario", precompute.SCENARIOS, ids=lambda s: s["id"])
def test_scenario_ids_resolve_to_what_the_labels_say(engine, scenario):
    (step,) = scenario["model_details"]
    product, consumed_by, origin_leaves, consumed_leaves, loads_A = EXPECTED[scenario["id"]]
    assert engine.get_names_product(step["product"]) == [product]
    assert engine.get_modelled_names_product(step["consumedBy"]) == [consumed_by]
    ready, load_A = precompute.model_inputs(scenario["model_details"])
    assert len(ready["product"][0]) == 1
    assert len(ready["originReg"][0]) == origin_leaves
    assert len(ready["consumedReg"][0]) == consumed_leaves
    assert load_A == [loads_A]


def test_indicator_labels(engine):
    assert precompute.indicator_meta(precompute.INDICATORS) == [
        {"id": 5, "name": "GHG emissions: Total", "unit": "kg CO2 eq"},
        {"id": 3, "name": "Employment: Total", "unit": "1000 p"},
        {"id": 7, "name": "Domestic Extraction Used - Metal Ores - Total", "unit": "kt"},
    ]


def test_region_leaves_partition_the_49_countries(engine):
    leaves = precompute.region_leaves()
    assert list(leaves) == ["Europe", "Middle-East", "America", "Asia-Pacific", "Africa"]
    assert sorted(c for countries in leaves.values() for c in countries) == list(range(COUNTRIES))


def test_by_region_matches_the_direct_calculation_region_by_region(engine):
    rng = np.random.default_rng(0)
    Y, B = rng.random((N, COUNTRIES)), rng.random((INDICATOR_ROWS, N))
    L = np.identity(N)  # the harness stand-in: result is B applied to final demand
    leaves = precompute.region_leaves()
    for indicator in precompute.INDICATORS:
        values = precompute.by_region(indicator, Y, B, L)
        assert list(values) == list(leaves)
        assert np.isfinite(list(values.values())).all()
        assert precompute.independent_by_region(indicator, Y, B, L, values, leaves)["passed"]
        # values moved between regions, same sum: must fail
        moved = dict(values, Europe=values["Europe"] + values["Africa"], Africa=0.0)
        assert not precompute.independent_by_region(indicator, Y, B, L, moved, leaves)["passed"]
