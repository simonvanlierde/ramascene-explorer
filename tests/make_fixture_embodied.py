"""Write tests/fixture-embodied.parquet: synthetic embodied flows for tests/fixture.json.

Same layout as data/embodied.parquet (precompute.write_embodied), with random
numbers, so the page and the browser tests run without the 51 MB release asset.
Each consumer draws on itself and three other producers, through five random
sections; each run cuts a random share of every flow.
Run: uv run python -m tests.make_fixture_embodied
"""

import json
from pathlib import Path

import numpy as np

import precompute

HERE = Path(__file__).parent
COUNTRIES = (
    "AT Austria|BE Belgium|BG Bulgaria|CY Cyprus|CZ Czech Republic|DE Germany|DK Denmark|EE Estonia|"
    "ES Spain|FI Finland|FR France|GR Greece|HR Croatia|HU Hungary|IE Ireland|IT Italy|LT Lithuania|"
    "LU Luxembourg|LV Latvia|MT Malta|NL Netherlands|PL Poland|PT Portugal|RO Romania|SE Sweden|"
    "SI Slovenia|SK Slovakia|GB United Kingdom|US United States|JP Japan|CN China|CA Canada|"
    "KR South Korea|BR Brazil|IN India|MX Mexico|RU Russia|AU Australia|CH Switzerland|TR Turkey|"
    "TW Taiwan|NO Norway|ID Indonesia|ZA South Africa|WA Rest of Asia and Pacific|WL Rest of America|"
    "WE Rest of Europe|WF Rest of Africa|WM Rest of Middle East"
)
SECTIONS = [
    "Agriculture, hunting and forestry",
    "Fishing",
    "Mining and quarrying",
    "Manufacturing",
    "Electricity, gas and water supply",
    "Construction",
    "Trade",
    "Hotels and restaurants",
    "Transport, storage and communication",
    "Financial intermediation",
    "Real estate, renting and business activities",
    "Public administration",
    "Education",
    "Health and social work",
    "Other service activities",
]
AGGREGATES = {
    "Europe": "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK GB RU CH NO WE",
    "Middle-East": "TR WM",
    "America": "US CA BR MX WL",
    "Asia-Pacific": "JP CN KR IN AU TW ID WA",
    "Africa": "ZA WF",
}
# typical size of one producer x section x consumer cell, in each indicator's unit
MAGNITUDE = {5: 2e9, 3: 50.0, 7: 200.0}


def main():
    fixture = json.loads((HERE / "fixture.json").read_text())
    codes, names = zip(*(row.split(" ", 1) for row in COUNTRIES.split("|")), strict=True)
    n, s = len(codes), len(SECTIONS)
    ids = [i["id"] for i in fixture["indicators"]]
    rng = np.random.default_rng(2011)
    base = np.zeros((len(ids), n, s, n))
    for c in range(n):
        producers = [c, *rng.choice([p for p in range(n) if p != c], 3, replace=False)]
        for p in producers:
            weight = 3.0 if p == c else 1.0
            secs = rng.choice(s, 5, replace=False)
            base[:, p, secs, c] = weight * rng.random((len(ids), 5)) * np.array([MAGNITUDE[i] for i in ids])[:, None]
    runs = ["baseline", *(sc["id"] for sc in fixture["scenarios"] if sc["id"] != "baseline")]
    flows = {"baseline": base.astype(np.float32)}
    for run in runs[1:]:
        cut = rng.random(base.shape) * rng.choice([0.002, 0.02, 0.1])
        flows[run] = (-base * cut).astype(np.float32)
    name_of = dict(zip(codes, names, strict=True))
    aggregates = {a: [name_of[c] for c in members.split()] for a, members in AGGREGATES.items()}
    meta = {
        "data_kind": fixture["data_kind"],
        "status": "synthetic test fixture, not a result",
        "base_year": fixture["base_year"],
        "breakdown": "Synthetic flows in the layout of data/embodied.parquet",
        "layout": "One row group per run, in the order of runs; baseline absolute, every other run its change.",
        "countries": list(names),
        "country_codes": list(codes),
        "aggregates": aggregates,
        "sections": SECTIONS,
        "indicators": [{**i, "scale": 1} for i in fixture["indicators"]],
        "value_type": "float32; value x scale is in the indicator's unit",
        "runs": runs,
        "checks": {},
        "provenance": fixture["provenance"],
    }
    precompute.write_embodied(HERE / "fixture-embodied.parquet", flows, ids, meta)


if __name__ == "__main__":
    main()
