"""The page's what-if contract in Python: catalogue names in, the numpy engine's numbers out.

    store = numpy_engine.open_store("data/browser-engine")
    find_names(store, "products", "motor vehicles")
    run_whatif(store, [{"product": "Motor vehicles, trailers and semi-trailers", "origin_region": "Europe",
                        "consumed_by": ["Y: Final Consumption"], "consumed_region": "Europe",
                        "change_percent": -20}])

The same names, checks and messages as the Ask panel and the WebMCP tools (src/lib/ask.js,
src/lib/webmcp.js); tests/ask-cases.json holds the cases both suites run.
"""

import math
from numbers import Real

import numpy_engine

ALL = "All industries"
# the section consumers (ids 1 to 15) that "All industries" stands for
ALL_IDS = list(range(1, 16))
DETAIL = " (detail)"
MAX_LEVERS = 10
CHANGE_RANGE = (-100, 1000)
# find_names kinds, as the WebMCP tool names them, to catalogue kinds
KINDS = {"products": "products", "regions": "regions", "industries": "consumers"}


def names_of(catalog):
    """Name to id per catalogue kind, with the page's rule for repeated names (namesOf in ask.js).

    A repeated name with the same leaves as its first entry keeps the first id; one with other leaves
    becomes "<name> (detail)". NOTE: one suffix, so a third differing entry collapses into the second.
    """
    out = {}
    for kind in ("products", "regions", "consumers"):
        ids, leaves = {}, {}
        for item in catalog[kind]:
            name = item["name"]
            if name in leaves and leaves[name] != item.get("leaves"):
                name += DETAIL
            if name not in ids:
                ids[name], leaves[name] = item["id"], item.get("leaves")
        out[kind] = ids
    return out


def _find(catalog, kind, query):
    words = str(query).lower().split()
    names = [*names_of(catalog)[kind], *([ALL] if kind == "consumers" else [])]
    return [n for n in names if all(w in n.lower() for w in words)]


def find_names(store, kind, query):
    """Names of one kind (products, regions or industries) that contain every word of the query, ignoring case."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    return _find(store.meta["catalog"], KINDS[kind], query)


def _js(n):
    """String(n) in JavaScript, with its minus sign as the page prints it (minus in live.js).

    shortcut: exponents below 1e-6 print as Python's 1e-07, not 1e-7; fine for percent changes.
    """
    n = float(n)
    text = str(int(n)) if n.is_integer() and abs(n) < 1e21 else repr(n)  # noqa: PLR2004
    return text.replace("-", "−", 1)


def to_model_details(levers, catalog):
    """The levers as the engine's steps; raises ValueError naming the change, as toModelDetails in ask.js."""
    if not isinstance(levers, list | tuple) or not levers:
        raise ValueError("the answer has no changes to run")
    if len(levers) > MAX_LEVERS:
        raise ValueError(f"the answer has more than {MAX_LEVERS} changes")
    names = names_of(catalog)
    steps = []
    for n, lever in enumerate(levers, 1):
        if not isinstance(lever, dict):
            raise ValueError(f"change {n} is not a change")  # noqa: TRY004  one type for every refusal, as the engine

        def id_of(kind, name, n=n):
            v = names[kind].get(name) if isinstance(name, str) else None
            if v is None:
                raise ValueError(f'change {n}: "{name}" is not in the catalogue')
            return v

        by = lever.get("consumed_by")
        by = by if isinstance(by, list) else []
        if not by:
            raise ValueError(f"change {n}: no industry given")
        consumers = list(
            dict.fromkeys(i for name in by for i in (ALL_IDS if name == ALL else [id_of("consumers", name)]))
        )
        change = lever.get("change_percent")
        if not isinstance(change, Real) or isinstance(change, bool) or not math.isfinite(change):
            raise ValueError(f"change {n}: the change must be a number (percent)")
        low, high = CHANGE_RANGE
        if not low <= change <= high:
            raise ValueError(f"change {n}: {_js(change)}% is outside the allowed {_js(low)} to {high} percent")
        steps.append(
            {
                "product": [id_of("products", lever.get("product"))],
                "originReg": [id_of("regions", lever.get("origin_region"))],
                "consumedBy": consumers,
                "consumedReg": [id_of("regions", lever.get("consumed_region"))],
                "techChange": [change],
            }
        )
    return steps


def lever_text(lever):
    """One lever in plain words, as leverText in ask.js."""
    where = lambda r: "all regions" if r == "Total" else r  # noqa: E731
    change = lever["change_percent"]
    return (
        f"{lever['product']}, made in {where(lever['origin_region'])}, used by {', '.join(lever['consumed_by'])} "
        f"in {where(lever['consumed_region'])}: {'+' if change > 0 else ''}{_js(change)}%"
    )


def run_whatif(store, levers):
    """Runs the levers on the store; the page's result for a browser run (browserResult in browser-results.js).

    Returns `changes` (each lever in words), `model_details` (the engine's steps), `regions` (the 49
    producing countries), `indicators` ([{"id": ...}]), `results` ({"baseline", "scenario"}: indicator id
    to country name to the total of the flows its producers carry, as Details → Method lists them) and
    `flows` ({"baseline", "scenario"}: indicator x producer x section x consumer arrays, float64).
    Raises ValueError with the page's message for a lever the catalogue cannot map or the engine refuses.
    """
    meta = store.meta
    steps = to_model_details(levers, meta["catalog"])
    changes = [lever_text(lever) for lever in levers]
    c = meta["countries"]
    shape = (len(meta["indicators"]), c, len(meta["sections"]), c)
    flows = {
        "baseline": store.baseline.reshape(shape).copy(),
        "scenario": numpy_engine.scenario_flows(store, steps).reshape(shape),
    }
    countries = sorted((r for r in meta["catalog"]["regions"] if len(r["leaves"]) == 1), key=lambda r: r["leaves"][0])

    def totals(f):
        by = f.sum(axis=(2, 3))
        return {
            i: {r["name"]: float(by[k, r["leaves"][0]]) for r in countries} for k, i in enumerate(meta["indicators"])
        }

    return {
        "changes": changes,
        "model_details": steps,
        "regions": [r["name"] for r in countries],
        "indicators": [{"id": i} for i in meta["indicators"]],
        "results": {k: totals(f) for k, f in flows.items()},
        "flows": flows,
    }
