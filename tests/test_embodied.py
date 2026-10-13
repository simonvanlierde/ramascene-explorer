"""Flows embodied in final demand: the aggregation, its checks and the Parquet file.

Same four-sector fake as test_detail.py (two countries x two products), with
the embodied call of the real adapter: each product is its own section.
"""

import json
import math
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest

import precompute
from tests.test_detail import detailed_engine
from tests.test_precompute import INDICATORS


def embodied_engine(**kwargs):
    engine = detailed_engine(**kwargs)
    engine.embodied = lambda indicators, Y, B, L: precompute.embodied_flows(B, L.dot(Y), indicators, [[0], [1]])
    return engine


def run(engine):
    return precompute.compute(engine, precompute.SCENARIOS, INDICATORS, embodied=True)


def test_flows_sum_over_sections_and_consumers_to_each_producer():
    rng = np.random.default_rng(1)
    countries, products = 3, 4
    B, L, Y = rng.random((2, 12)), rng.random((12, 12)), rng.random((12, 3))
    flows = precompute.embodied_flows(B, L @ Y, [1, 2], [[0, 3], [1], [2]])
    assert flows.shape == (2, countries, 3, countries)
    for k, i in enumerate([1, 2]):
        per_row = B[i - 1] * (L @ Y.sum(axis=1))
        np.testing.assert_allclose(flows[k].sum(axis=(1, 2)), per_row.reshape(countries, products).sum(axis=1))
        # section 0 is products 0 and 3 of each producer, for consumer 2 alone
        cell = B[i - 1] * (L @ Y[:, 2])
        assert math.isclose(flows[k, 1, 0, 2], cell[4] + cell[7])


def test_sections_must_partition_the_products():
    B, X = np.ones((1, 4)), np.ones((4, 2))
    with pytest.raises(ValueError, match="partition"):
        precompute.embodied_flows(B, X, [1], [[0]])
    with pytest.raises(ValueError, match="partition"):
        precompute.embodied_flows(B, X, [1], [[0], [0, 1]])


def test_baseline_is_absolute_and_every_scenario_its_change():
    computed = run(embodied_engine())
    embodied = computed["embodied"]
    assert embodied["runs"] == ["baseline", *(s["id"] for s in precompute.SCENARIOS)]
    checks = embodied["checks"]
    assert all(c["passed"] for c in checks.values() if "passed" in c)
    assert checks["producer_by_country"]["runs"] == embodied["runs"]
    assert checks["rises"]["runs"] == 0
    base = embodied["flows"]["baseline"]
    for name in embodied["runs"][1:]:
        change = embodied["flows"][name]
        for k, i in enumerate(INDICATORS):
            want = math.fsum(computed["results"][name][str(i)].values()) - math.fsum(
                computed["results"]["baseline"][str(i)].values()
            )
            assert math.isclose(change[k].sum(), want, rel_tol=1e-9, abs_tol=1e-12), name
            assert (change[k] <= 1e-12 * np.abs(base[k])).all(), name


def test_without_the_option_there_are_no_flows():
    assert "embodied" not in precompute.compute(embodied_engine(), precompute.SCENARIOS, INDICATORS)


def checked(flows, results, **kw):
    return precompute.embodied_of(flows, results, [1], {"R1": [0], "R2": [1]}, **kw)


def flows_and_results(change=-0.5):
    base = np.ones((1, 2, 1, 2))
    scen = base.copy()
    scen[0, 0, 0, 0] += change
    results = {
        "baseline": {"1": {"R1": 2.0, "R2": 2.0}},
        "cut": {"1": {"R1": 2.0 + change, "R2": 2.0}},
    }
    return {"baseline": base, "cut": scen}, results


def test_producer_sums_must_match_the_continental_totals():
    flows, results = flows_and_results()
    assert checked(flows, results)["checks"]["producer_by_region"]["passed"]
    results["cut"]["1"]["R1"] *= 1 + 1e-6
    with pytest.raises(ValueError, match=r"failed \(producer_by_region, world_total\)"):
        checked(flows, results)


def test_producer_sums_must_match_the_engine_per_country_where_it_has_them():
    flows, results = flows_and_results()
    countries = {"C1": [0], "C2": [1]}
    detail = {"baseline": {"1": {"C1": 2.0, "C2": 2.0}}}
    out = checked(flows, results, country_leaves=countries, detail_countries=detail)
    assert out["checks"]["producer_by_country"]["runs"] == ["baseline"]
    detail["baseline"]["1"]["C2"] = 2.1
    with pytest.raises(ValueError, match=r"failed \(producer_by_country\)"):
        checked(flows, results, country_leaves=countries, detail_countries=detail)


def test_a_rising_cell_is_reported_not_refused():
    flows, results = flows_and_results()
    flows["cut"][0, 1, 0, 1] += 0.25
    results["cut"]["1"]["R2"] += 0.25
    rises = checked(flows, results)["checks"]["rises"]
    assert rises["runs"] == 1
    assert rises["by_run"]["cut"] == {"cells": 1, "largest": 0.25}


def test_changes_float32_cannot_hold_are_refused():
    # two cells that cancel to 1 in float64 but to 0 in float32
    flows, results = flows_and_results(change=1e9)
    flows["cut"][0, 0, 0, 1] -= 1e9 - 1
    results["cut"]["1"]["R1"] = 3.0
    with pytest.raises(ValueError, match=r"failed \(float32\)"):
        checked(flows, results)


def test_parquet_has_one_row_group_per_run_and_round_trips(tmp_path):
    rng = np.random.default_rng(2)
    flows = {"baseline": rng.random((2, 3, 2, 3)), "cut": -rng.random((2, 3, 2, 3))}
    flows["cut"][1, 2] = 0.0  # left out of the file
    path = tmp_path / "embodied.parquet"
    precompute.write_embodied(path, flows, [5, 7], {"runs": list(flows)})
    file = pq.ParquetFile(path)
    assert json.loads(file.metadata.metadata[b"ramascene"]) == {"runs": ["baseline", "cut"]}
    assert file.metadata.num_row_groups == 2
    for g, (name, values) in enumerate(flows.items()):
        table = file.read_row_group(g).to_pydict()
        assert set(table["run"]) == {name}
        assert len(table["value"]) == np.count_nonzero(values)
        back = np.zeros_like(values)
        k = [[5, 7].index(i) for i in table["indicator"]]
        back[k, table["producer"], table["section"], table["consumer"]] = table["value"]
        np.testing.assert_allclose(back, values, rtol=1e-7)


SHIPPED = Path(__file__).parent.parent / "data" / "embodied.parquet"


def test_shipped_flows_come_from_the_same_run_and_reconcile_with_results():
    if not SHIPPED.exists():
        pytest.skip("no data/embodied.parquet: run precompute.py --run with --out-embodied")
    results = json.loads((SHIPPED.parent / "results.json").read_text())
    file = pq.ParquetFile(SHIPPED)
    meta = json.loads(file.metadata.metadata[b"ramascene"])
    for key in ("engine", "dataset", "command", "generated_at"):
        assert meta["provenance"][key] == results["provenance"][key], key
    assert meta["runs"] == [s["id"] for s in results["scenarios"]]
    assert file.metadata.num_row_groups == len(meta["runs"])
    assert all(c["passed"] for c in meta["checks"].values() if "passed" in c)
    aggregate_of = {c: a for a, members in meta["aggregates"].items() for c in members}
    regions = list(results["regions"])
    region_of = np.array([regions.index(aggregate_of[c]) for c in meta["countries"]])
    base = results["results"]["baseline"]
    for g, name in enumerate(meta["runs"]):
        table = file.read_row_group(g, columns=["run", "indicator", "producer", "value"])
        assert set(table.column("run").to_pylist()) == {name}
        indicator, producer = table.column("indicator").to_numpy(), table.column("producer").to_numpy()
        value = table.column("value").to_numpy().astype(float)
        for i, by_region in results["results"][name].items():
            rows = indicator == int(i)
            got = np.bincount(region_of[producer[rows]], weights=value[rows], minlength=len(regions))
            want = np.array([by_region[r] - (0 if name == "baseline" else base[i][r]) for r in regions])
            # float32 values: within relative 1e-6 of the run's total (or total change)
            assert np.abs(got - want).max() <= 1e-6 * abs(want.sum()), (name, i)
