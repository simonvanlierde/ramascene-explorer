"""The numpy engine.

Checks the store reader on the fixture store, the maths against direct solves, and the
155 published scenarios against RaMa-Scene's results when the browser store is here.
"""

import json
import os
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

import numpy_engine as ne
from tests.make_fixture_store import MATRIX, PAIRS

ROOT = Path(__file__).resolve().parent.parent
STORE = os.environ.get("BROWSER_ENGINE_DATA")

CATALOG = {
    "products": [{"id": 10, "leaves": [0]}, {"id": 11, "leaves": [1]}, {"id": 12, "leaves": [0, 1]}],
    "regions": [{"id": 1, "leaves": [0]}],
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
    """Two products in one country with a known inverse, as in tests/browser-engine.test.js.

    H = L^T and the baseline flows are X, so the flows are X' itself.
    """

    def __init__(self, a, arrays):
        self.a = np.asarray(a)
        self.l = np.linalg.inv(np.eye(2) - self.a)
        self.x = self.l @ [2.0, 3.0]
        self.baseline = self.x
        self.meta = {"products": 2, "countries": 1, "catalog": CATALOG, "arrays": arrays}

    def read(self, name, rows, columns=None):
        m = {"A": self.a, "L": self.l, "LC": self.l.T, "H": self.l.T, "X": self.x[:, None], "Y": [[2.0], [3.0]]}
        m = np.asarray(m[name])[rows]
        return m if columns is None else m[:, columns]


def step(**over):
    return {"product": [10], "originReg": [1], "consumedBy": [21], "consumedReg": [1], "techChange": [-20]} | over


def direct(a, y):
    return np.linalg.solve(np.eye(2) - a, y)


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
def test_matches_a_direct_solve(case, change, arrays):
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
    ],
)
def test_plan_refuses_invalid_steps(bad):
    with pytest.raises(ValueError, match=r"\w"):
        ne.plan(Tiny(A, VIA_ROWS).meta, [step(**bad)])


def test_reader_matches_the_fixture_store():
    info = json.loads((ROOT / "tests/fixture-store/info.json").read_text())
    for name, matrix in (("M", MATRIX), ("P", PAIRS)):
        reader = ne.ArrayReader(
            info[name], lambda i, name=name: ROOT / "tests/fixture-store" / name / "c" / str(i) / "0"
        )
        want = matrix.astype(np.float32).astype(float)
        assert np.array_equal(reader.read(range(len(want))), want)
        # the order asked, repeated rows, and a column subset; row 2 of M is an empty chunk
        assert np.array_equal(reader.read([3, 2, 0, 3], [2, 0]), want[[3, 2, 0, 3]][:, [2, 0]])
    with pytest.raises(ValueError, match="invalid matrix row"):
        reader.read([len(want)])


def test_decode_refuses_a_corrupt_chunk():
    info = json.loads((ROOT / "tests/fixture-store/info.json").read_text())
    reader = ne.ArrayReader(info["M"], lambda i: ROOT / "tests/fixture-store/M/c" / str(i) / "0")
    data, index = reader._shard(0)  # noqa: SLF001
    offset, size = (int(v) for v in index[0])
    chunk = data[offset : offset + size]
    assert len(ne.decode_chunk(chunk, 12)) == 3
    with pytest.raises(ValueError, match="invalid matrix chunk"):
        ne.decode_chunk(chunk, 16)
    with pytest.raises(ValueError, match="invalid matrix chunk"):
        ne.decode_chunk(chunk[:-1] + bytes([chunk[-1] ^ 1]), 12)  # the trailer's size field


@pytest.mark.skipif(not STORE, reason="set BROWSER_ENGINE_DATA to the browser store (docs/browser-engine.md)")
def test_published_scenarios_match_ramascene():
    store = ne.open_store(STORE)
    meta = store.meta
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
    reference = json.loads((ROOT / "data/results.json").read_text())
    scenarios = [s for s in reference["scenarios"] if s["id"] != "baseline"]
    assert len(scenarios) == 155
    baseline = {"id": "baseline", "model_details": [{**scenarios[0]["model_details"][0], "techChange": [0]}]}
    regions = [r for r in meta["catalog"]["regions"] if 2 <= r["id"] <= 6]
    worst = 0.0
    for scenario in [baseline, *scenarios]:
        flows = ne.scenario_flows(store, scenario["model_details"])
        cube = flows.reshape(len(meta["indicators"]), meta["countries"], len(meta["sections"]), meta["countries"])
        for i, indicator in enumerate(meta["indicators"]):
            for region in regions:
                got = cube[i, region["leaves"]].sum()
                want = reference["results"][scenario["id"]][str(indicator)][region["name"]]
                worst = max(worst, abs(got - want) / max(abs(want), 1e-12))
    print(f"worst relative difference: {worst:.2e}")
    # NOTE: the page's own test measures 5.5e-9 against the same results (float32 store); 1e-8 catches a regression
    assert worst <= 1e-8
