"""Compare two precompute runs value by value: results, regions and flows.

    uv run python compare_data.py OLD_DATA_DIR NEW_DATA_DIR [--rtol 1e-12]

Every number under every key but provenance, runs and checks (timings, and
check residuals that are float noise by design) must agree to the relative
tolerance, |a - b| <= rtol * max(|a|, |b|); keys, list lengths and every
non-number (ids, labels, sector and region names) must be equal. Exits 1 on
any mismatch.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

FILES = ["results.json", "regions.json", "flows.json"]
SKIPPED = {"provenance", "runs", "checks"}


def compare(old, new, rtol=1e-12):
    report: dict[str, Any] = {"values": 0, "max_relative_difference": 0.0, "where": None, "mismatches": []}

    def walk(a, b, path):
        where = "/".join(path)
        if isinstance(a, dict) and isinstance(b, dict):
            if a.keys() != b.keys():
                report["mismatches"].append(f"{where}: keys differ, {sorted(a.keys() ^ b.keys())}")
            for k in a.keys() & b.keys():
                walk(a[k], b[k], [*path, str(k)])
        elif isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                report["mismatches"].append(f"{where}: length {len(a)} != {len(b)}")
            for i, (x, y) in enumerate(zip(a, b, strict=False)):
                walk(x, y, [*path, str(i)])
        elif all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (a, b)):
            report["values"] += 1
            scale = max(abs(a), abs(b))
            rel = abs(a - b) / scale if scale else 0.0
            if rel > report["max_relative_difference"]:
                report["max_relative_difference"], report["where"] = rel, where
            if rel > rtol:
                report["mismatches"].append(f"{where}: {a!r} != {b!r} (relative {rel:.3e})")
        elif a != b:
            report["mismatches"].append(f"{where}: {a!r} != {b!r}")

    walk({k: v for k, v in old.items() if k not in SKIPPED}, {k: v for k, v in new.items() if k not in SKIPPED}, [])
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--rtol", type=float, default=1e-12)
    args = parser.parse_args(argv)
    failed = False
    for name in FILES:
        old, new = (json.loads((d / name).read_text()) for d in (args.old, args.new))
        r = compare(old, new, args.rtol)
        print(
            f"{name}: {r['values']} values, max relative difference {r['max_relative_difference']:.3e}"
            f" at {r['where']}, {len(r['mismatches'])} mismatches beyond {args.rtol:g}"
        )
        for m in r["mismatches"][:20]:
            print(f"  {m}")
        failed |= bool(r["mismatches"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
