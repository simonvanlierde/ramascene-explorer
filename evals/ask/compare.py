#!/usr/bin/env python3
"""Compare Ask eval runs item by item: exact McNemar test and a paired-difference CI per kind.

Reads the <model>.jsonl files ask_eval.py writes, pairs items on (kind, question), and drops
server errors and items missing from either run. For each pair of runs and each kind it prints
n, both scores, the discordant counts (b: only the first run right, c: only the second), the
difference in accuracy with a Bonett-Price 95% CI, the exact McNemar p and, over all pairs of a
kind, the Holm-adjusted p. Below 15 paired items no p-value is given. With --flips, for repeat
runs of one model, it prints per kind how many items were not scored the same (right or wrong)
in every run. Stdlib only.
"""

import argparse
import io
import itertools
import json
import math
import sys
from pathlib import Path

from ask_eval import SMALL_N, Z95

EPILOG = """\
examples:
  compare.py out/qwen3.8-27b.jsonl out/gemma-4-26b-a4b.jsonl out/qwen3.5-9b.jsonl
  compare.py --flips r1/qwen3.8-27b.jsonl r2/qwen3.8-27b.jsonl r3/qwen3.8-27b.jsonl

exit codes: 0 report printed; 2 usage error; 3 a file could not be read or parsed, or the
runs share no items"""


def mcnemar(b, c):
    """Exact two-sided McNemar p: a binomial test of b against b + c at one half."""
    m = b + c
    if m == 0:
        return 1.0
    tail = sum(math.comb(m, k) for k in range(min(b, c) + 1)) / 2**m
    return min(1.0, 2 * tail)


def bonett_price(b, c, n, z=Z95):
    """Adjusted Wald CI for the paired difference (b - c) / n.

    Bonett and Price (2012), J. Educ. Behav. Stat. 37(4), 479-488: add one to each discordant
    cell and two to n, then a Wald interval, clipped to [-1, 1].
    """
    p12, p21 = (b + 1) / (n + 2), (c + 1) / (n + 2)
    d = p12 - p21
    half = z * math.sqrt((p12 + p21 - d * d) / (n + 2))
    return max(-1.0, d - half), min(1.0, d + half)


def holm(ps):
    """Holm step-down adjusted p-values, in the input's order."""
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def load_run(path):
    """(kind, question) -> scored ok, skipping server errors; ValueError on a bad or repeated item."""
    run = {}
    for i, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            rec = json.loads(line)
            if not isinstance(rec, dict):
                raise ValueError(f"line {i} is not a JSON object")
            key = rec["kind"], rec["question"]
            if key in run:
                raise ValueError(f"line {i} repeats item {key!r}")
            if not rec.get("transport"):
                run[key] = bool(rec["ok"])
    return run


def compare(runs):
    """One row per (kind, pair of runs), with Holm applied within each kind."""
    rows = []
    for (a, ra), (b_name, rb) in itertools.combinations(runs.items(), 2):
        shared = ra.keys() & rb.keys()
        for kind in sorted({k for k, _ in shared}):
            keys = [k for k in shared if k[0] == kind]
            b = sum(ra[k] and not rb[k] for k in keys)
            c = sum(rb[k] and not ra[k] for k in keys)
            n = len(keys)
            rows.append(
                {
                    "kind": kind,
                    "a": a,
                    "b_run": b_name,
                    "n": n,
                    "a_correct": sum(ra[k] for k in keys),
                    "b_correct": sum(rb[k] for k in keys),
                    "b": b,
                    "c": c,
                    "diff": (b - c) / n,
                    "ci95": bonett_price(b, c, n),
                    "p": mcnemar(b, c) if n >= SMALL_N else None,
                }
            )
    for kind in {r["kind"] for r in rows}:
        tested = [r for r in rows if r["kind"] == kind and r["p"] is not None]
        for r, adj in zip(tested, holm([r["p"] for r in tested]), strict=True):
            r["p_holm"] = adj
    return rows


def flips(runs):
    """Per kind: items scored in every run, and how many of them did not get the same result in all."""
    shared = set.intersection(*(set(r) for r in runs.values()))
    out = {}
    for kind in sorted({k for k, _ in shared}):
        keys = [k for k in shared if k[0] == kind]
        out[kind] = len(keys), sum(len({r[k] for r in runs.values()}) > 1 for k in keys)
    return out


def fmt(row):
    lo, hi = row["ci95"]
    p = f"p -  (n < {SMALL_N})" if row["p"] is None else f"p {row['p']:.3g}  Holm {row['p_holm']:.3g}"
    return (
        f"{row['kind']:<11}{row['a']} vs {row['b_run']}  n {row['n']}  {row['a_correct']} vs {row['b_correct']}"
        f"  b {row['b']} c {row['c']}  diff {row['diff']:+.2f} (95% CI {lo:+.3f} to {hi:+.3f})  {p}"
    )


def main(argv=None):
    if isinstance(sys.stdout, io.TextIOWrapper):  # not under pytest capture
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    parser = argparse.ArgumentParser(
        prog="compare.py",
        description=__doc__.split("\n\n")[0],
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    parser.add_argument(
        "--flips", action="store_true", help="repeat runs of one model: count the items whose result changed"
    )
    parser.add_argument("runs", nargs="+", type=Path, metavar="RUN.jsonl", help="two or more ask_eval.py logs")
    args = parser.parse_args(argv)
    if len(args.runs) < 2:  # noqa: PLR2004 - a comparison needs two runs
        parser.error("give at least two RUN.jsonl files")
    # repeat runs share a model, and so a file name: --flips labels them by path
    names = [p.as_posix() if args.flips else p.name.removesuffix(".jsonl") for p in args.runs]
    if len(set(names)) < len(names):
        dup = next(n for n in names if names.count(n) > 1)
        parser.error(f"two runs share the file name {dup!r}; the name labels the run in the report")
    runs = {}
    for name, path in zip(names, args.runs, strict=True):
        try:
            runs[name] = load_run(path)
        except (OSError, UnicodeDecodeError, ValueError, KeyError, TypeError) as e:
            print(f"error: cannot read {path.as_posix()!r}: {e!r}", file=sys.stderr)
            return 3
    every = set().union(*runs.values())
    for name, run in runs.items():
        if missing := len(every - run.keys()):
            print(f"note: {missing} items not scored in {name}; left out of its pairs", file=sys.stderr)
    lines = (
        [f"{k:<11}n {n}  flipped {c}  rate {c / n:.3f}" for k, (n, c) in flips(runs).items()]
        if args.flips
        else [fmt(r) for r in compare(runs)]
    )
    if not lines:
        print("error: the runs share no scored items", file=sys.stderr)
        return 3
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
