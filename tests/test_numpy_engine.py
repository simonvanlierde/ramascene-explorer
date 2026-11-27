"""The numpy engine.

Checks the store reader on the fixture store, the maths against direct solves, and the
155 published scenarios against RaMa-Scene's results when the browser store is here.
"""

import json
import os
import shutil
from pathlib import Path

import numpy as np
import pytest
import zarr
from numpy.testing import assert_allclose

import numpy_engine as ne
from tests.make_fixture_store import MATRIX, PAIRS

ROOT = Path(__file__).resolve().parent.parent
STORE = os.environ.get("BROWSER_ENGINE_DATA")

CATALOG = {
    "products": [{"id": 10, "leaves": [0]}, {"id": 11, "leaves": [1]}, {"id": 12, "leaves": [0, 1]}],
    "regions": [{"id": 1, "leaves": [0]}, {"id": 2, "leaves": [1]}, {"id": 3, "leaves": [0, 1]}],
    "consumers": [
        {"id": 20, "leaves": [0]},
        {"id": 21, "leaves": [1]},
        {"id": 22, "leaves": [0, 1]},
        {"id": 30, "final": True, "leaves": [0]},
    ],
}
# L[K, J] through rows of L, or through columns of LC: the planner picks by stored bytes
VIA_ROWS = {"L": {"chunk_bytes": 1}, "LC": {"chunk_bytes": 1}}
VIA_COLUMNS = {"L": {"chunk_bytes": 100}, "LC": {"chunk_bytes": 1}}


class Tiny:
    """Two products per country with a known inverse, as in tests/browser-engine.test.js.

    `y` is final demand, one column per consuming country (one country by default). H = L^T
    and the baseline flows are X, so the flows are X' itself.
    """

    def __init__(self, a, arrays, y=((2.0,), (3.0,))):
        self.a = np.asarray(a)
        self.y = np.asarray(y)
        self.l = np.linalg.inv(np.eye(len(self.a)) - self.a)
        self.x = self.l @ self.y
        self.baseline = self.x.copy()
        self.meta = {"products": 2, "countries": self.y.shape[1], "catalog": CATALOG, "arrays": arrays}

    def read(self, name, rows, columns=None):
        m = {"A": self.a, "L": self.l, "LC": self.l.T, "H": self.l.T, "X": self.x, "Y": self.y}
        m = m[name][rows]
        return m if columns is None else m[:, columns]


def step(**over):
    return {"product": [10], "originReg": [1], "consumedBy": [21], "consumedReg": [1], "techChange": [-20]} | over


def direct(a, y):
    return np.linalg.solve(np.eye(len(a)) - a, y)


A = np.array([[0.1, 0.05], [0.15, 0.2]])
FINAL = step(consumedBy=[30], techChange=[-50])


def scaled(a, entries, f):
    a = a.copy()
    for i, j in entries:
        a[i, j] *= f
    return a


@pytest.mark.parametrize("arrays", [VIA_ROWS, VIA_COLUMNS])
@pytest.mark.parametrize("change", [-60, 40, 300])
@pytest.mark.parametrize("case", ["one cell", "two rows into a column", "a row into two columns", "mixed"])
def test_matches_a_direct_solve(case, change, arrays, monkeypatch):
    # one H row per batch, so the fold runs past its first batch
    monkeypatch.setattr(ne, "H_BATCH", 1)
    f = 1 + change / 100
    steps, changed, y = {
        "one cell": ([step(techChange=[change]), FINAL], scaled(A, [(0, 1)], f), [1, 3]),
        "two rows into a column": ([step(product=[12], techChange=[change])], scaled(A, [(0, 1), (1, 1)], f), [2, 3]),
        "a row into two columns": (
            [step(consumedBy=[22], techChange=[change])],
            scaled(A, [(0, 0), (0, 1)], f),
            [2, 3],
        ),
        # final demand on row 0 and a technical change on row 1: L's columns follow J, not R
        "mixed": ([step(product=[11], consumedBy=[20], techChange=[change]), FINAL], scaled(A, [(1, 0)], f), [1, 3]),
    }[case]
    got = ne.scenario_flows(Tiny(A, arrays), steps).ravel()
    # NOTE: condition number is about 2 here, so 1e-12 is far above rounding and far below any wrong term
    assert_allclose(got, direct(changed, y), rtol=1e-12, atol=0, strict=True)


# Two countries: rows and columns are country * 2 + product, Y has a column per consuming country.
A2 = np.array([[0.1, 0.05, 0.02, 0.08], [0.15, 0.2, 0.04, 0.01], [0.03, 0.06, 0.12, 0.09], [0.07, 0.02, 0.1, 0.05]])
Y2 = np.array([[1.0, 2.0], [3.0, 1.0], [2.0, 2.0], [1.0, 3.0]])


def block(a, rows, columns, f):
    a = a.copy()
    a[np.ix_(rows, columns)] *= f
    return a


@pytest.mark.parametrize("arrays", [VIA_ROWS, VIA_COLUMNS])
@pytest.mark.parametrize(
    "case",
    ["made in one country, used in the other", "a region over both countries", "final demand of the other country",
     "overlapping steps multiply"],
)  # fmt: skip
def test_two_countries_match_a_direct_solve(case, arrays):
    steps, changed, y = {
        # product 0 made in country 0, used by consumer 1 in country 1: A[0, 3]
        "made in one country, used in the other": (
            [step(consumedReg=[2], techChange=[-40])],
            block(A2, [0], [3], 0.6),
            Y2,
        ),
        "a region over both countries": (
            [step(originReg=[3], consumedReg=[3], techChange=[80])],
            block(A2, [0, 2], [1, 3], 1.8),
            Y2,
        ),
        # country 1's final demand for product 0 made in country 0: Y[0, 1]
        "final demand of the other country": (
            [step(consumedBy=[30], consumedReg=[2], techChange=[-50])],
            A2,
            block(Y2, [0], [1], 0.5),
        ),
        "overlapping steps multiply": (
            [
                step(product=[12], originReg=[3], consumedReg=[3], techChange=[-20]),
                step(originReg=[3], consumedBy=[22], consumedReg=[3], techChange=[50]),
            ],
            block(block(A2, [0, 1, 2, 3], [1, 3], 0.8), [0, 2], [0, 1, 2, 3], 1.5),
            Y2,
        ),
    }[case]
    store = Tiny(A2, arrays, Y2)
    got = ne.scenario_flows(store, steps)
    # NOTE: condition number is about 2 here, as above
    assert_allclose(got, direct(changed, y), rtol=1e-12, atol=0, strict=True)
    assert np.array_equal(store.baseline, store.x)


def test_final_demand_only_and_no_change():
    store = Tiny(A, VIA_ROWS)
    got = ne.scenario_flows(store, [FINAL]).ravel()
    assert_allclose(got, direct(A, [1, 3]), rtol=1e-12, atol=0, strict=True)
    assert np.array_equal(ne.scenario_flows(store, [step(techChange=[0])]), store.baseline)


@pytest.mark.parametrize("change", [-100, 1000])
def test_plan_accepts_the_bounds(change):
    assert ne.plan(Tiny(A, VIA_ROWS).meta, [step(techChange=[change])] * 10)["edits"]


# The pivot threshold, ported from the_threshold_uses_the_scale_before_cancellation and
# cancellation_is_refused_and_inputs_are_checked in engine/src/lib.rs. A pivot p after
# cancellation, with the terms before it near 2, is refused at or below epsilon * 2 * n.
EPS = 2.0**-23
L1 = 1 / (1 - 0.092)


def one(p):
    return [[(1 - p) / 2]], [[2.0]], [[1.0]]


def wide(p):
    # the K x K form: two rows into one column
    return [[(1 - p) / 4], [(1 - p) / 4]], [[2.0, 2.0]], [[1.0]]


def two(p):
    # n = 2: S = diag(1, p)
    return [[0.0, 0.0], [0.0, (1 - p) / 2]], [[0.0, 0.0], [0.0, 2.0]], [[1.0], [1.0]]


@pytest.mark.parametrize(
    ("args", "epsilon", "refused"),
    [
        (one(1.5 * EPS), EPS, True),
        (one(2.5 * EPS), EPS, False),
        (wide(1.5 * EPS), EPS, True),
        (wide(2.5 * EPS), EPS, False),
        (two(3 * EPS), EPS, True),
        (two(5 * EPS), EPS, False),
        # 1 - dA L = 0 for a = 0.092 and a change of 986.95...%
        (([[0.092 * 9.869_565_217_391_305]], [[L1]], [[1.0]]), EPS, True),
        (([[0.092 * 9.8]], [[L1]], [[1.0]]), EPS, False),
    ],
    ids=["one 1.5 eps", "one 2.5 eps", "wide 1.5 eps", "wide 2.5 eps", "two 3 eps", "two 5 eps", "cancels",
         "near cancelling"],
)  # fmt: skip
def test_the_threshold_matches_the_rust_kernel(args, epsilon, refused):
    delta, t, x = (np.asarray(m) for m in args)
    if refused:
        with pytest.raises(ValueError, match="singular or ill-conditioned"):
            ne.correction(delta, t, x, epsilon)
    else:
        assert np.isfinite(ne.correction(delta, t, x, epsilon)).all()


@pytest.mark.parametrize(("pivot", "refused"), [(1.5, True), (2.5, False)])
def test_the_default_threshold_is_the_stored_epsilon(pivot, refused):
    delta, t, x = (np.asarray(m) for m in one(pivot * EPS))
    if refused:
        with pytest.raises(ValueError, match="singular or ill-conditioned"):
            ne.correction(delta, t, x)
    else:
        assert np.isfinite(ne.correction(delta, t, x)).all()


def test_correction_refuses_an_overflowing_result():
    # finite inputs whose product overflows: S = I, dA X = inf
    with np.errstate(over="ignore"), pytest.raises(ValueError, match="singular or ill-conditioned"):
        ne.correction(np.array([[1e300]]), np.array([[0.0]]), np.array([[1e300]]))


def test_scenario_flows_refuses_an_overflowing_output():
    tiny = Tiny(A, VIA_ROWS, y=((1e308,), (1.0,)))
    with np.errstate(over="ignore"), pytest.raises(ValueError, match="non-finite scenario output"):
        ne.scenario_flows(tiny, [step(product=[10], consumedBy=[30], techChange=[1000])])


def test_correction_refuses_non_finite_input():
    with pytest.raises(ValueError, match="finite numbers"):
        ne.correction(np.array([[np.nan]]), np.array([[L1]]), np.array([[1.0]]), 1e-16)


@pytest.mark.parametrize(
    ("delta", "t", "x"),
    [
        # from cancellation_is_refused_and_inputs_are_checked: delta is 1 x 1, T is 1 x 1, X must be 2 rows
        (np.ones((1, 1)), np.ones((1, 1)), np.ones((2, 1))),
        (np.ones((1, 2)), np.ones((1, 2)), np.ones((2, 1))),
        (np.ones((2, 2)), np.ones((2, 2)), np.ones(2)),
        (np.ones((0, 2)), np.ones((2, 0)), np.ones((2, 1))),
        (np.ones((2, 2)), np.ones((2, 2)), np.ones((2, 0))),
        (np.ones(2), np.ones(2), np.ones((2, 1))),
    ],
    ids=["x rows", "T not K x R", "x one-dimensional", "no rows", "no columns", "delta one-dimensional"],
)
def test_correction_refuses_mismatched_dimensions(delta, t, x):
    with pytest.raises(ValueError, match="invalid solve dimensions"):
        ne.correction(delta, t, x)


def test_singular_scenario_is_refused():
    # a coefficient of 1 on the diagonal after the change makes I - A' singular
    a = np.array([[0.5, 0.0], [0.0, 0.2]])
    with pytest.raises(ValueError, match="singular or ill-conditioned"):
        ne.scenario_flows(Tiny(a, VIA_ROWS), [step(consumedBy=[20], techChange=[100])])


@pytest.mark.parametrize(
    "bad",
    [
        {"techChange": [-101]},
        {"techChange": [1001]},
        {"product": []},
        {"product": [99]},
        {"consumedBy": [20, 30]},
        {"techChange": [-100.001]},
        {"techChange": [1000.001]},
        # wrong types get the same messages, not a TypeError
        {"product": 10},
        {"product": [[10]]},
        {"product": [10.0]},
        {"originReg": "1"},
        {"consumedBy": 21},
        {"consumedBy": [[21]]},
        {"techChange": -20},
        {"techChange": ["-20"]},
        {"techChange": [True]},
        {"product": [True]},
        {"consumedBy": [np.True_]},
        {"techChange": [np.True_]},
    ],
)
def test_plan_refuses_invalid_steps(bad):
    with pytest.raises(ValueError, match=r"\w"):
        ne.plan(Tiny(A, VIA_ROWS).meta, [step(**bad)])


@pytest.mark.parametrize("key", ["product", "originReg", "consumedBy", "consumedReg", "techChange"])
def test_plan_refuses_a_step_without_a_field(key):
    with pytest.raises(ValueError, match=r"\w"):
        ne.plan(Tiny(A, VIA_ROWS).meta, [{k: v for k, v in step().items() if k != key}])


def test_plan_accepts_numpy_scalars():
    meta = Tiny(A, VIA_ROWS).meta
    numpy = step(product=[np.int64(10)], originReg=[np.int32(1)], consumedBy=[np.int64(21)],
                 consumedReg=[np.uint8(1)], techChange=[np.float32(-20)])  # fmt: skip
    assert ne.plan(meta, [numpy]) == ne.plan(meta, [step()])


def test_overlapping_ids_in_one_step_select_each_leaf_once():
    meta = Tiny(A, VIA_ROWS).meta
    assert ne.plan(meta, [step(product=[10, 12])])["edits"] == ne.plan(meta, [step(product=[12])])["edits"]


def test_plan_refuses_more_than_ten_steps():
    with pytest.raises(ValueError, match="1 to 10 interventions"):
        ne.plan(Tiny(A, VIA_ROWS).meta, [step()] * 11)
    with pytest.raises(ValueError, match="1 to 10 interventions"):
        ne.plan(Tiny(A, VIA_ROWS).meta, step())


def test_plan_refuses_bool_catalog_leaves():
    meta = Tiny(A, VIA_ROWS).meta | {"catalog": CATALOG | {"products": [{"id": 10, "leaves": [True]}]}}
    with pytest.raises(ValueError, match="invalid catalog indices"):
        ne.plan(meta, [step()])


def fixture_store(directory, source=ROOT / "tests/fixture-store", **over):
    """The arrays in `source` (tests/fixture-store's M and P) as a store with a manifest, `over` replacing fields."""
    info = json.loads((ROOT / "tests/fixture-store/info.json").read_text())
    manifest: dict = {
        "version": 3,
        "products": 200,
        "countries": 49,
        "baseline_residual": 1e-16,
        "indicators": [5],
        "sections": [1],
        "baseline_flows": [0.0] * 49 * 49,
        "store": "f" * 64,
        "arrays": info,
    } | over
    (directory / f"store-{manifest['store']}").mkdir()
    for name in manifest["arrays"]:
        (directory / f"store-{manifest['store']}" / name).symlink_to(source / name)
    (directory / "manifest-v3.json").write_text(json.dumps(manifest), encoding="utf-8")
    return directory


@pytest.mark.parametrize("residual", [1e-16, 1e-9])
def test_store_reads_the_fixture(tmp_path, residual):
    store = ne.open_store(fixture_store(tmp_path, baseline_residual=residual))
    assert np.array_equal(store.read("M", [3, 1], [0, 2]), MATRIX.astype(np.float32).astype(float)[[3, 1]][:, [0, 2]])


def test_store_reads_rows_in_the_order_asked(tmp_path):
    store = ne.open_store(fixture_store(tmp_path))
    for name, matrix in (("M", MATRIX), ("P", PAIRS)):
        want = matrix.astype(np.float32).astype(float)
        assert np.array_equal(store.read(name, range(len(want))), want)
        # repeated rows and a column subset; row 2 of M is an empty chunk
        assert np.array_equal(store.read(name, [3, 2, 0, 3], [2, 0]), want[[3, 2, 0, 3]][:, [2, 0]])
        assert store.read(name, []).shape == (0, 3)


@pytest.mark.parametrize(("rows", "columns"), [([4], None), ([-1], None), ([0], [3]), ([0], [-1])])
def test_store_refuses_an_index_outside_the_matrix(tmp_path, rows, columns):
    store = ne.open_store(fixture_store(tmp_path))
    with pytest.raises(IndexError if -1 not in rows + (columns or []) else ValueError):
        store.read("M", rows, columns)


def test_store_refuses_non_finite_values(tmp_path):
    zarr.create_array(tmp_path / "src/N", shape=(2, 2), chunks=(1, 2), dtype="float32")[:] = [[1, 2], [np.nan, 3]]
    store = ne.open_store(fixture_store(tmp_path, tmp_path / "src", arrays={"N": {}}))
    with pytest.raises(ValueError, match="invalid matrix values"):
        store.read("N", [1])


def test_store_refuses_a_corrupt_chunk(tmp_path):
    copy = tmp_path / "src/M"
    shutil.copytree(ROOT / "tests/fixture-store/M", copy)
    shard = copy / "c/0/0"
    data = bytearray(shard.read_bytes())
    data[20] ^= 0xFF  # inside chunk 0's gzip member
    shard.write_bytes(data)
    store = ne.open_store(fixture_store(tmp_path, tmp_path / "src", arrays={"M": {}}))
    with pytest.raises(Exception, match=r"\w"):
        store.read("M", [0])


@pytest.mark.parametrize(
    "over",
    [
        {"version": 2},
        {"products": 199},
        {"countries": 48},
        {"baseline_residual": 1.0000001e-9},
        {"baseline_residual": float("nan")},
        {"baseline_residual": None},
        {"baseline_flows": [0.0] * 49 * 48},
        {"baseline_flows": [float("inf")] + [0.0] * (49 * 49 - 1)},
    ],
    ids=[
        "version",
        "products",
        "countries",
        "residual too large",
        "residual NaN",
        "residual missing",
        "baseline too short",
        "baseline not finite",
    ],
)
def test_store_refuses_an_unsupported_manifest(tmp_path, over):
    with pytest.raises(ValueError, match="unsupported browser dataset"):
        ne.open_store(fixture_store(tmp_path, **over))


# as tests/browser-parity.test.js: with CI set, a missing store fails instead of skipping
@pytest.mark.skipif(
    not STORE and not os.environ.get("CI"),
    reason="set BROWSER_ENGINE_DATA to the browser store (docs/browser-engine.md)",
)
def test_published_scenarios_match_ramascene(monkeypatch):
    assert STORE, "BROWSER_ENGINE_DATA is not set; fetch the browser store, see docs/browser-engine.md"
    assert (Path(STORE) / "manifest-v3.json").exists(), f"no manifest-v3.json in {STORE}"
    # brightway-check/scenario_check.py scores the scenarios as its numpy route does
    monkeypatch.syspath_prepend(ROOT / "brightway-check")
    import scenario_check  # ty: ignore[import-not-found]

    store = ne.open_store(STORE)
    reference = json.loads((ROOT / "data/results.json").read_text())
    runs = scenario_check.scenarios(reference)
    assert len(runs) == 156
    regions = [r for r in store.meta["catalog"]["regions"] if 2 <= r["id"] <= 6]
    worst = 0.0
    for s in runs:
        for (indicator, region), got in scenario_check.numpy_totals(store, s["model_details"], regions).items():
            want = reference["results"][s["id"]][str(indicator)][region]
            worst = max(worst, abs(got - want) / max(abs(want), 1e-12))
    print(f"worst relative difference: {worst:.2e}")
    # NOTE: the page's own test measures 5.5e-9 against the same results (float32 store); 1e-8 catches a regression
    assert worst <= 1e-8
    with pytest.raises(ValueError, match="singular or ill-conditioned"):
        ne.scenario_flows(
            store,
            [
                {
                    "product": [82],
                    "originReg": [7],
                    "consumedBy": [81],
                    "consumedReg": [7],
                    "techChange": [632.7954014961612],
                }
            ],
        )
