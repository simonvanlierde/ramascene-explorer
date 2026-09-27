"""The 49-region breakdown and the sector → region flows, on a tiny injected engine.

Same four-sector fake as test_precompute.py (two countries × two products),
extended with the optional detail calls of the real adapter: by_country and
by_sector_country, country_leaves and aggregate_members.
"""

import math

import numpy as np
import pytest

import precompute
from tests.test_precompute import INDICATORS, fake_engine


def detailed_engine(skew_country=False, drop_sector=False):
    engine = fake_engine()

    def cells(indicator, Y, B, L):
        m = B[indicator - 1] * L.dot(Y.sum(axis=1))  # country-major: C1 (p0, p1), C2 (p0, p1)
        return {"S1": {"C1": float(m[0]), "C2": float(m[2])}, "S2": {"C1": float(m[1]), "C2": float(m[3])}}

    def by_country(indicator, Y, B, L):
        c = cells(indicator, Y, B, L)
        out = {k: c["S1"][k] + c["S2"][k] for k in ("C1", "C2")}
        if skew_country:
            out["C1"] *= 1.01
        return out

    def by_sector_country(indicator, Y, B, L):
        c = cells(indicator, Y, B, L)
        if drop_sector:
            del c["S2"]
        return c

    engine.by_country = by_country
    engine.by_sector_country = by_sector_country
    engine.country_leaves = {"C1": [0], "C2": [1]}
    engine.aggregate_members = {"R1": ["C1"], "R2": ["C2"]}
    return engine


def run(engine):
    return precompute.compute(engine, precompute.SCENARIOS, INDICATORS)


def test_detail_is_absent_for_an_engine_without_it():
    assert "detail" not in run(fake_engine())


def test_detail_has_every_run_by_indicator_by_country_and_passes_its_checks():
    detail = run(detailed_engine())["detail"]
    assert list(detail["countries"]) == ["baseline", *(s["id"] for s in precompute.SCENARIOS), "zero_change_control"]
    assert all(list(v) == ["C1", "C2"] for by_i in detail["countries"].values() for v in by_i.values())
    checks = detail["checks"]
    assert all(c["passed"] for k in ("independent_by_country", "aggregates", "sectors") for c in checks[k])
    assert checks["flows"]["passed"]


def test_a_country_value_off_its_independent_recomputation_writes_nothing():
    with pytest.raises(ValueError, match="detail verification failed.*independent_by_country"):
        run(detailed_engine(skew_country=True))


def test_sectors_that_do_not_cover_the_country_total_write_nothing():
    with pytest.raises(ValueError, match="detail verification failed.*sectors"):
        run(detailed_engine(drop_sector=True))


def test_aggregates_must_equal_the_sum_of_their_members_and_partition_them():
    ok = precompute.reconcile_aggregates({"R": 3.0}, {"a": 1.0, "b": 2.0}, {"R": ["a", "b"]})
    assert ok["passed"]
    assert not precompute.reconcile_aggregates({"R": 3.1}, {"a": 1.0, "b": 2.0}, {"R": ["a", "b"]})["passed"]
    # b is in no aggregate: not a partition, even though R matches its one member
    assert not precompute.reconcile_aggregates({"R": 1.0}, {"a": 1.0, "b": 2.0}, {"R": ["a"]})["passed"]


def cells_pair(rng, sectors=6, regions=7):
    base = {
        f"s{i}": {f"r{j}": float(rng.random() * 10 ** rng.integers(0, 9)) for j in range(regions)}
        for i in range(sectors)
    }
    scen = {s: {r: v * (1 + rng.normal(0, 0.1)) for r, v in by_r.items()} for s, by_r in base.items()}
    return base, scen


@pytest.mark.parametrize("seed", range(5))
def test_named_plus_other_flows_reconcile_to_the_total_change(seed):
    base, scen = cells_pair(np.random.default_rng(seed))
    out = precompute.top_flows(base, scen, n=5)
    total = math.fsum(scen[s][r] - base[s][r] for s in base for r in base[s])
    assert out["reconciled"]
    assert math.isclose(math.fsum(f["delta"] for f in out["flows"]), total, rel_tol=1e-12)
    assert math.isclose(out["total_delta"], total, rel_tol=1e-12)
    # every cell is counted once: the named ones plus those lumped into "other" flows
    assert sum(1 if f["named"] else f["cells"] for f in out["flows"]) == out["cells"] == 42
    # per region (and per sector) the flows also reconcile, so the Sankey's nodes do
    for key, side in (("region", {r for s in base for r in base[s]}), ("sector", set(base))):
        named = {f[key] for f in out["flows"]}
        for node in side & named:
            want = math.fsum(
                scen[s][r] - base[s][r] for s in base for r in base[s] if (r if key == "region" else s) == node
            )
            got = math.fsum(f["delta"] for f in out["flows"] if f[key] == node)
            assert math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-9)


def test_the_named_flows_are_the_largest_cells_by_absolute_change():
    base = {"a": {"x": 10.0, "y": 10.0}, "b": {"x": 10.0, "y": 10.0}}
    scen = {"a": {"x": 4.0, "y": 11.0}, "b": {"x": 10.5, "y": 17.0}}
    out = precompute.top_flows(base, scen, n=2)
    named = [(f["sector"], f["region"], f["delta"]) for f in out["flows"] if f["named"]]
    assert named == [("b", "y", 7.0), ("a", "x", -6.0)]
    other = [f for f in out["flows"] if not f["named"]]
    # a·y lumps under named sector a and named region y; b·x under b and x
    assert {(f["sector"], f["region"]) for f in other} == {("a", "y"), ("b", "x")}


def test_grid_cells_keep_the_continental_aggregates_only():
    grid_cell = precompute.grid_scenarios()[0]
    computed = precompute.compute(detailed_engine(), [*precompute.SCENARIOS, grid_cell], INDICATORS)
    assert grid_cell["id"] in computed["results"]
    assert grid_cell["id"] not in computed["detail"]["countries"]
    assert grid_cell["id"] not in computed["detail"]["flows"]
    assert [s["id"] for s in precompute.detail_scenarios(computed)] == [
        "baseline",
        *(s["id"] for s in precompute.SCENARIOS),
    ]


DATA = __import__("pathlib").Path(__file__).parent.parent / "data"


@pytest.fixture(scope="module")
def shipped_trio():
    import json

    paths = [DATA / f"{n}.json" for n in ("results", "regions", "flows")]
    if not all(p.exists() for p in paths):
        pytest.skip("no data/{results,regions,flows}.json: run precompute.py --run with --out-regions/--out-flows")
    return [json.loads(p.read_text()) for p in paths]


def test_shipped_sidecars_come_from_the_same_run_as_results(shipped_trio):
    results, regions, flows = shipped_trio
    for doc in (regions, flows):
        assert doc["data_kind"] == "exiobase-v3"
        for key in ("engine", "dataset", "command", "generated_at"):
            assert doc["provenance"][key] == results["provenance"][key], key
    originals = ["baseline", *(s["id"] for s in precompute.SCENARIOS)]
    assert [s["id"] for s in regions["scenarios"]] == [s["id"] for s in flows["scenarios"]] == originals
    assert list(flows["results"]) == originals[1:]


def test_shipped_sidecars_passed_their_checks_and_reconcile_with_results(shipped_trio):
    results, regions, flows = shipped_trio
    assert all(c["passed"] for k in ("independent_by_country", "aggregates") for c in regions["checks"][k])
    assert all(c["passed"] for c in flows["checks"]["sectors"]) and flows["checks"]["flows"]["passed"]
    for sid, by_i in regions["results"].items():
        for i, by_country in by_i.items():
            total = math.fsum(results["results"][sid][i].values())
            assert math.isclose(math.fsum(by_country.values()), total, rel_tol=1e-9), (sid, i)
            if sid != "baseline":
                base = math.fsum(regions["results"]["baseline"][i].values())
                change = flows["results"][sid][i]
                assert change["reconciled"]
                assert math.isclose(change["total_delta"], math.fsum(by_country.values()) - base, rel_tol=1e-9), (
                    sid,
                    i,
                )
