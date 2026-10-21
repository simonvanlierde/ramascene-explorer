"""Benchmarks of the precompute checks and aggregation, for CodSpeed.

Run with `uv run pytest tests/benchmarks --codspeed`. The inputs are synthetic and
seeded, shaped like the real run where that is cheap (49 countries, 15
sections, three indicators) and smaller where a full EXIOBASE matrix would not
fit a benchmark (the Leontief inverse). Every benchmark asserts on its result,
so a change that breaks the code fails here too.
"""

import json
from pathlib import Path

import numpy as np
import pytest

import compare_data
import precompute
from tests.test_embodied import embodied_engine
from tests.test_precompute import INDICATORS, fake_engine

COUNTRIES = 49
SECTIONS = 15
PRODUCTS = 200
REGION_NAMES = ["Europe", "Middle-East", "America", "Asia-Pacific", "Africa"]
DATA = Path(__file__).parent.parent.parent / "data"


def partition(n, parts):
    """range(n) split into `parts` contiguous, non-empty leaves."""
    return [list(chunk) for chunk in np.array_split(np.arange(n), parts)]


REGION_LEAVES = {
    name: [int(c) for c in leaves] for name, leaves in zip(REGION_NAMES, partition(COUNTRIES, 5), strict=True)
}
SECTION_LEAVES = [[int(p) for p in leaves] for leaves in partition(PRODUCTS, SECTIONS)]


@pytest.fixture(scope="module")
def rng():
    return np.random.default_rng(42)


@pytest.fixture(scope="module")
def embodied_inputs(rng):
    """B and X = L . Y at full size: 49 countries x 200 products, one column per consumer."""
    B = rng.random((3, COUNTRIES * PRODUCTS))
    X = rng.random((COUNTRIES * PRODUCTS, COUNTRIES))
    return B, X


@pytest.fixture(scope="module")
def flows_and_results(embodied_inputs):
    """Embodied flows of a baseline and three cuts, with results that reconcile with them."""
    B, X = embodied_inputs
    base = precompute.embodied_flows(B, X, [1, 2, 3], SECTION_LEAVES)
    flows = {"baseline": base}
    for n, cut in enumerate((0.9, 0.8, 0.5)):
        scenario = base.copy()
        scenario[:, n * 10 : n * 10 + 10] *= cut
        flows[f"cut-{n}"] = scenario
    results = {}
    for name, values in flows.items():
        producer = values.sum(axis=(2, 3))
        results[name] = {
            str(i): {r: float(producer[k, leaves].sum()) for r, leaves in REGION_LEAVES.items()}
            for k, i in enumerate([1, 2, 3])
        }
    return flows, results


def test_compute_every_scenario_on_the_fake_engine(benchmark):
    """The whole orchestration: baseline, controls and every scenario, with every check."""

    @benchmark
    def computed():
        return precompute.compute(fake_engine(), precompute.ALL_SCENARIOS, INDICATORS)

    assert len(computed["results"]) == len(precompute.ALL_SCENARIOS) + 1


def test_compute_with_detail_and_embodied_flows(benchmark):
    computed = benchmark(lambda: precompute.compute(embodied_engine(), precompute.SCENARIOS, INDICATORS, embodied=True))
    assert computed["embodied"]["runs"][0] == "baseline"


def test_grid_scenarios(benchmark):
    assert len(benchmark(precompute.grid_scenarios)) == 150


def test_embodied_flows(benchmark, embodied_inputs):
    B, X = embodied_inputs
    out = benchmark(precompute.embodied_flows, B, X, [1, 2, 3], SECTION_LEAVES)
    assert out.shape == (3, COUNTRIES, SECTIONS, COUNTRIES)


def test_embodied_of(benchmark, flows_and_results):
    flows, results = flows_and_results
    checked = benchmark(precompute.embodied_of, flows, results, [1, 2, 3], REGION_LEAVES)
    assert checked["runs"] == list(flows)


def test_embodied_table(benchmark, flows_and_results):
    flows, _ = flows_and_results
    table = benchmark(precompute.embodied_table, "baseline", flows["baseline"], [1, 2, 3])
    assert len(table["value"]) == flows["baseline"].size


def test_write_embodied(benchmark, flows_and_results, tmp_path):
    flows, _ = flows_and_results
    path = tmp_path / "embodied.parquet"
    benchmark(precompute.write_embodied, path, flows, [1, 2, 3], {"runs": list(flows)})
    assert path.stat().st_size > 0


def test_independent_by_region(benchmark, rng):
    """The per-region check against the engine, on a 49 x 4 product Leontief inverse."""
    n = COUNTRIES * 4
    L, Y, B = rng.random((n, n)), rng.random((n, COUNTRIES)), rng.random((3, n))
    per_country = (B[0] * (L @ Y.sum(axis=1))).reshape(COUNTRIES, -1).sum(axis=1)
    engine_values = {r: float(per_country[leaves].sum()) for r, leaves in REGION_LEAVES.items()}
    check = benchmark(precompute.independent_by_region, 1, Y, B, L, engine_values, REGION_LEAVES)
    assert check["passed"]


def test_top_flows(benchmark, rng):
    """The named sector -> region flows of one change, over 15 sections x 49 countries."""
    base = {f"s{s}": {f"c{c}": float(v) for c, v in enumerate(rng.random(COUNTRIES))} for s in range(SECTIONS)}
    scen = {s: {c: v * (1 - 0.1 * rng.random()) for c, v in cells.items()} for s, cells in base.items()}
    flows = benchmark(precompute.top_flows, base, scen)
    assert flows["reconciled"]


def test_reconcile_aggregates_and_sectors(benchmark, rng):
    by_country = {f"c{c}": float(v) for c, v in enumerate(rng.random(COUNTRIES))}
    members = {r: [f"c{c}" for c in leaves] for r, leaves in REGION_LEAVES.items()}
    by_aggregate = {r: sum(by_country[c] for c in cs) for r, cs in members.items()}
    share = rng.dirichlet(np.ones(SECTIONS), size=COUNTRIES)
    by_sector_country = {
        f"s{s}": {f"c{c}": by_country[f"c{c}"] * share[c, s] for c in range(COUNTRIES)} for s in range(SECTIONS)
    }

    def reconcile():
        return (
            precompute.reconcile_aggregates(by_aggregate, by_country, members),
            precompute.reconcile_sectors(by_country, by_sector_country),
        )

    aggregates, sectors = benchmark(reconcile)
    assert aggregates["passed"]
    assert sectors["passed"]


@pytest.mark.parametrize("name", compare_data.FILES)
def test_compare_shipped_data(benchmark, name):
    """compare_data.compare over a shipped file against itself: every value walked."""
    doc = json.loads((DATA / name).read_text())
    report = benchmark(compare_data.compare, doc, doc)
    assert not report["mismatches"]
