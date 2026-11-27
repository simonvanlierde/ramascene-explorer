"""The browser scenario engine in numpy and scipy: the same maths as src/lib/browser-engine/, no Rust.

    store = open_store("data/browser-engine")
    flows = scenario_flows(store, [{"product": [180], "originReg": [1], "consumedBy": [198],
                                    "consumedReg": [2], "techChange": [-20]}])

`flows` is the (indicator x producer x section) x consumer matrix the page draws, float64, from the
float32 browser store (docs/browser-engine.md). The steps use the page's catalogue ids. The maths and its
notation follow `scenario_flows` in browser-engine.js and `correction` in engine/src/lib.rs.
The page's download, memory and work budgets are not enforced: they size a phone, not a Python process.
"""

import json
import warnings
from numbers import Integral, Real
from pathlib import Path

import numpy as np
import scipy.linalg as la
import zarr

# The export stores float32, so a pivot this close to zero, relative to the system's scale, cannot be
# told apart from a singular system.
STORED_EPSILON = 2.0**-23
# H rows read and folded into the flows at once.
H_BATCH = 256


class Store:
    """The manifest and a reader per matrix, for the arrays the engine reads (A, L, LC, X, Y, H)."""

    def __init__(self, directory):
        directory = Path(directory)
        self.meta = json.loads((directory / "manifest-v3.json").read_text(encoding="utf-8"))
        m = self.meta
        residual = m.get("baseline_residual")
        baseline = m.get("baseline_flows")
        # the manifest checks of openEngine in browser-data.js that this reader relies on
        if (
            m.get("version") != 3  # noqa: PLR2004
            or m.get("products") != 200  # noqa: PLR2004
            or m.get("countries") != 49  # noqa: PLR2004
            or type(residual) not in {int, float}
            or not np.isfinite(residual)
            or residual > 1e-9  # noqa: PLR2004
            or not isinstance(baseline, list)
            or len(baseline) != len(m.get("indicators", [])) * 49 * len(m.get("sections", [])) * 49
        ):
            raise ValueError("unsupported browser dataset")
        self.baseline = np.asarray(baseline, dtype=float)
        if not np.isfinite(self.baseline).all():
            raise ValueError("unsupported browser dataset")
        root = directory / f"store-{m['store']}"
        self.arrays = {name: zarr.open_array(root / name, mode="r") for name in m["arrays"]}

    def read(self, name, rows, columns=None):
        """Rows x columns of a matrix (all columns when none are given), in the order asked, as float64."""
        rows = np.asarray(rows, dtype=np.intp)
        columns = slice(None) if columns is None else np.asarray(columns, dtype=np.intp)
        # zarr refuses an index past the end but counts a negative one from it
        if (rows < 0).any() or (not isinstance(columns, slice) and (columns < 0).any()):
            raise ValueError("invalid matrix index")
        out = self.arrays[name].get_orthogonal_selection((rows, columns))
        # zarr checks each chunk's CRC-32 and size; the engine also refuses NaN and infinity
        if not np.isfinite(out).all():
            raise ValueError("invalid matrix values")
        return np.asarray(out, dtype=float)


def open_store(directory):
    return Store(directory)


def _is_int(v):
    # numpy integers count, as Python users pass them; bool is an Integral but never an id
    return isinstance(v, Integral) and not isinstance(v, bool)


def _expand(items, ids, bound):
    if not isinstance(ids, list) or not ids:
        raise ValueError("select at least one id")
    by_id = {v["id"]: v for v in items}
    leaves = []
    for i in ids:
        if not _is_int(i) or i not in by_id:
            raise ValueError(f"unknown id {i}")
        leaves += by_id[i]["leaves"]
    if not all(type(v) is int and 0 <= v < bound for v in leaves):
        raise ValueError("invalid catalog indices")
    return sorted(set(leaves))


def _selection(meta, step):
    catalog = meta["catalog"]
    products = _expand(catalog["products"], step.get("product"), meta["products"])
    origins = _expand(catalog["regions"], step.get("originReg"), meta["countries"])
    destinations = _expand(catalog["regions"], step.get("consumedReg"), meta["countries"])
    change = step.get("techChange")
    if (
        not isinstance(change, list)
        or len(change) != 1
        or not isinstance(change[0], Real)
        or isinstance(change[0], bool)
        or not np.isfinite(change[0])
        or not -100 <= change[0] <= 1000  # noqa: PLR2004
    ):
        raise ValueError("change must be between -100 and 1000 percent")
    consumed_by = step.get("consumedBy")
    if not isinstance(consumed_by, list) or not consumed_by:
        raise ValueError("select a consumer")
    by_id = {v["id"]: v for v in catalog["consumers"]}
    for i in consumed_by:
        if not _is_int(i) or i not in by_id:
            raise ValueError(f"unknown consumer {i}")
    final = by_id[consumed_by[0]].get("final") is True
    if any((by_id[i].get("final") is True) != final for i in consumed_by):
        raise ValueError("cannot mix final demand and intermediate consumers")
    n = meta["products"]
    rows = [r * n + p for r in origins for p in products]
    if final:
        columns = destinations
    else:
        consumers = _expand(catalog["consumers"], consumed_by, n)
        columns = [r * n + p for r in destinations for p in consumers]
    return {"rows": rows, "columns": columns, "final": final, "factor": 1 + float(change[0]) / 100}


def plan(meta, steps):
    """The edits and the sorted matrix rows, columns and final-demand rows they touch."""
    if not isinstance(steps, list) or not 1 <= len(steps) <= 10:  # noqa: PLR2004
        raise ValueError("a scenario needs 1 to 10 interventions")
    edits = [e for e in (_selection(meta, s) for s in steps) if e["factor"] != 1]
    technical = [e for e in edits if not e["final"]]
    rows = sorted({r for e in technical for r in e["rows"]})
    columns = sorted({c for e in technical for c in e["columns"]})
    finals = sorted({r for e in edits if e["final"] for r in e["rows"]})
    j = sorted({*rows, *finals})
    # L[K, J] from K rows of L or J columns, whichever is less to fetch.
    arrays = meta.get("arrays", {})
    size = {n: arrays.get(n, {}).get("chunk_bytes", 1) for n in ("L", "LC")}
    by_rows = not rows or len(columns) * size["L"] <= len(j) * size["LC"]
    return {"edits": edits, "technical": technical, "rows": rows, "columns": columns, "finals": finals, "J": j,
            "by_rows": by_rows}  # fmt: skip


def _change(a, technical, rows, columns):
    """Delta A = A' - A on the selected rows and columns; each step scales a block, overlapping steps multiply."""
    factor = np.ones(a.shape)
    for e in technical:
        factor[np.ix_(np.searchsorted(rows, e["rows"]), np.searchsorted(columns, e["columns"]))] *= e["factor"]
    return a * (factor - 1)


def _row_scale(a, b_abs):
    """The largest row scale of I - A B before it cancels: 1 + sum_j |a_ij| * (abs row sum of B)_j."""
    return max(1.0, float((1 + np.abs(a) @ b_abs).max()))


def _solve(s, rhs, scale, epsilon):
    """LU with partial pivoting, refusing a pivot that float32 data cannot tell apart from zero."""
    n = len(s)
    norm = max(scale, float(np.abs(s).max()))
    with warnings.catch_warnings():
        # an exactly zero pivot is refused just below, with the engine's message
        warnings.simplefilter("ignore", la.LinAlgWarning)
        lu, piv = la.lu_factor(s, check_finite=False)
    if (np.abs(np.diag(lu)) <= epsilon * norm * n).any():
        raise ValueError("singular or ill-conditioned scenario")
    return la.lu_solve((lu, piv), rhs, check_finite=False)


def correction(delta, t, x, epsilon=STORED_EPSILON):
    """W = (I - dA T)^-1 dA X = dA (I - T dA)^-1 X, solved in whichever form is smaller (engine/src/lib.rs)."""
    if (
        delta.ndim != 2  # noqa: PLR2004
        or 0 in delta.shape
        or t.shape != delta.shape[::-1]
        or x.ndim != 2  # noqa: PLR2004
        or x.shape[0] != t.shape[0]
        or not x.shape[1]
    ):
        raise ValueError("invalid solve dimensions")
    r, k = delta.shape
    if not all(np.isfinite(m).all() for m in (delta, t, x)):
        raise ValueError("the solve needs finite numbers")
    if r <= k:
        s = np.eye(r) - delta @ t
        w = _solve(s, delta @ x, _row_scale(delta, np.abs(t).sum(axis=1)), epsilon)
    else:
        s = np.eye(k) - t @ delta
        w = delta @ _solve(s, x, _row_scale(t, np.abs(delta).sum(axis=1)), epsilon)
    if not np.isfinite(w).all():
        raise ValueError("singular or ill-conditioned scenario")
    return w


def scenario_flows(store, steps):
    """Flows for the changed economy, (indicator x producer x section) x consumer.

    X' = X0 + L[:,R] W with W = (I - dA L[K,R])^-1 dA X0[K,:], and X0 = X + L[:,F] dY for the final-demand
    rows F. The flows are G X' for the page's grouping G and H[j] = (G L[:,j])^T, so
    flows' = flows + sum_j H[j] (x) Z[j] with Z = dY on F plus W on R.
    """
    meta = store.meta
    c = meta["countries"]
    p = plan(meta, steps)
    rows, columns, finals, j = p["rows"], p["columns"], p["finals"], p["J"]
    out = store.baseline.reshape(-1, c).copy()
    position = {r: i for i, r in enumerate(j)}
    z = np.zeros((len(j), c))
    final_at = np.array([position[r] for r in finals], dtype=int)
    demand = store.read("Y", finals)
    before = demand.copy()
    for e in (e for e in p["edits"] if e["final"]):
        demand[np.ix_([finals.index(r) for r in e["rows"]], e["columns"])] *= e["factor"]
    z[final_at] = demand - before
    if rows:
        delta = _change(store.read("A", rows, columns), p["technical"], rows, columns)
        l = store.read("L", columns, j) if p["by_rows"] else store.read("LC", j, columns).T  # noqa: E741
        # X0[K,:] includes the final-demand changes.
        x = store.read("X", columns) + l[:, final_at] @ z[final_at]
        row_at = np.array([position[r] for r in rows], dtype=int)
        z[row_at] += correction(delta, l[:, row_at], x)
    for start in range(0, len(j), H_BATCH):
        out += store.read("H", j[start : start + H_BATCH]).T @ z[start : start + H_BATCH]
    if not np.isfinite(out).all():
        raise ValueError("non-finite scenario output")
    return out
