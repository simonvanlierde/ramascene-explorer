"""evals/ask statistics: Wilson intervals, the exact McNemar test, Bonett-Price and run pairing."""

import json

import pytest

import ask_eval
import compare
from ask_eval import report, wilson

# NOTE: 4 decimals is the precision of the published reference values
TOL = 5e-4


def test_shared_constants():
    assert (compare.Z95, compare.SMALL_N) == (ask_eval.Z95, ask_eval.SMALL_N)


@pytest.mark.parametrize(
    ("correct", "n", "lo", "hi"),
    [
        (6, 8, 0.4093, 0.9285),  # paraphrase scores of 2026-11-19
        (3, 8, 0.1368, 0.6943),
        (0, 10, 0.0, 0.2775),  # Newcombe (1998), Stat. Med. 17, 857-872, Table I
        (0, 0, 0.0, 1.0),
    ],
)
def test_wilson(correct, n, lo, hi):
    assert wilson(correct, n) == pytest.approx((lo, hi), abs=TOL)


@pytest.mark.parametrize(
    ("b", "c", "p"),
    [
        (3, 0, 0.25),  # 2 * (1/2)^3
        (1, 9, 0.021484375),  # 2 * (1 + 10) / 2^10
        (0, 10, 0.001953125),  # 2 / 2^10, unclipped
        (4, 4, 1.0),
        (0, 0, 1.0),
    ],
)
def test_mcnemar_exact(b, c, p):
    assert compare.mcnemar(b, c) == pytest.approx(p, abs=1e-12)  # exact binomial sums


def test_bonett_price_hand_worked():
    # b 3, c 0, n 8: p12 = 4/10, p21 = 1/10, d = 0.3, var = (0.5 - 0.09) / 10 = 0.041,
    # half = 1.96 * sqrt(0.041) = 0.3969
    assert compare.bonett_price(3, 0, 8) == pytest.approx((-0.0969, 0.6969), abs=TOL)
    assert compare.bonett_price(0, 3, 8) == pytest.approx((-0.6969, 0.0969), abs=TOL)


def test_bonett_price_is_clipped():
    lo, hi = compare.bonett_price(20, 0, 20)
    assert hi == 1.0
    assert lo > 0
    lo, hi = compare.bonett_price(0, 20, 20)
    assert lo == -1.0
    assert hi < 0


def test_holm():
    assert compare.holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06], abs=1e-12)


def write(path, recs):
    path.write_text("".join(json.dumps(r) + "\n" for r in recs))
    return path


def test_compare_pairs_items_and_skips_server_errors(tmp_path, capsys):
    view = [{"kind": "view", "question": f"v{i}", "ok": True} for i in range(16)]
    a = write(
        tmp_path / "a.jsonl",
        [
            {"kind": "none", "question": "q1", "ok": True},
            {"kind": "none", "question": "q2", "ok": True},
            {"kind": "none", "question": "q3", "ok": False},
            {"kind": "none", "question": "only-a", "ok": True},
            *view,
        ],
    )
    b = write(
        tmp_path / "b.jsonl",
        [
            {"kind": "none", "question": "q3", "ok": True},  # order differs from a
            {"kind": "none", "question": "q1", "ok": False},
            {"kind": "none", "question": "q2", "ok": False, "transport": True},
            *view[:15],
            {"kind": "view", "question": "v15", "ok": False},
        ],
    )
    assert compare.main([str(a), str(b)]) == 0
    out, err = capsys.readouterr()
    none, view_row = out.splitlines()
    # q2 (server error in b) and only-a drop out: q1 a only, q3 b only
    assert "none" in none
    assert "n 2 " in none
    assert "b 1 c 1" in none
    assert "n < 15" in none
    assert "n 16 " in view_row
    assert "b 1 c 0" in view_row
    assert "p 1  Holm 1" in view_row
    assert "2 items not scored in b" in err


def test_compare_holm_over_three_runs(tmp_path):
    def run(ok):
        return {("view", f"v{i}"): i < ok for i in range(20)}

    rows = compare.compare({"x": run(20), "y": run(10), "z": run(19)})
    by = {(r["a"], r["b_run"]): r for r in rows}
    assert by["x", "y"]["p"] == pytest.approx(compare.mcnemar(10, 0), abs=1e-12)
    assert by["x", "y"]["p_holm"] == pytest.approx(3 * compare.mcnemar(10, 0), abs=1e-12)
    assert by["x", "z"]["p_holm"] == 1.0


def test_compare_holm_within_kind():
    def run(ok):
        return {**{("view", f"v{i}"): i < ok for i in range(20)}, **{("none", f"n{i}"): i < ok for i in range(3)}}

    rows = compare.compare({"x": run(20), "y": run(10)})
    by = {r["kind"]: r for r in rows}
    # one tested pair in view, so Holm leaves its p alone; none is below 15 items and gets no p
    assert by["view"]["p_holm"] == by["view"]["p"]
    assert by["none"]["p"] is None
    assert "p_holm" not in by["none"]


def test_fmt_keeps_the_sign_of_a_small_bound():
    ok = {("label", f"l{i}"): True for i in range(153)}
    worse = {**ok, **{("label", f"l{i}"): False for i in range(5)}}
    (row,) = compare.compare({"x": ok, "y": worse})
    assert "95% CI -0.001 to +0.065" in compare.fmt(row)


def test_compare_usage_errors(tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        compare.main([str(tmp_path / "a.jsonl")])
    assert e.value.code == 2
    assert "at least two" in capsys.readouterr().err
    assert compare.main([str(tmp_path / "a.jsonl"), str(tmp_path / "b.jsonl")]) == 3
    assert capsys.readouterr().err.startswith("error: cannot read")
    with pytest.raises(SystemExit) as e:
        compare.main([str(tmp_path / "a.jsonl"), str(tmp_path / "sub" / "a.jsonl")])
    assert e.value.code == 2
    assert "file name 'a'" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("lines", "message"),
    [
        (["[1]"], "line 1 is not a JSON object"),
        (
            [json.dumps({"kind": "none", "question": "q", "ok": True})] * 2,
            "line 2 repeats item ('none', 'q')",
        ),
    ],
)
def test_compare_rejects_bad_lines(tmp_path, capsys, lines, message):
    a = tmp_path / "a.jsonl"
    a.write_text("\n".join(lines) + "\n")
    b = write(tmp_path / "b.jsonl", [{"kind": "none", "question": "q", "ok": True}])
    assert compare.main([str(a), str(b)]) == 3
    assert message in capsys.readouterr().err


def test_compare_runs_with_no_shared_items(tmp_path, capsys):
    a = write(tmp_path / "a.jsonl", [{"kind": "none", "question": "q1", "ok": True}])
    b = write(tmp_path / "b.jsonl", [{"kind": "none", "question": "q2", "ok": True}])
    assert compare.main([str(a), str(b)]) == 3
    out, err = capsys.readouterr()
    assert out == ""
    assert "share no scored items" in err


def test_report_flags_small_n():
    summary = {
        "model": "m",
        "server_errors": 2,
        "stopped_early": False,
        "image": None,
        "label": {"correct": 151, "n": 153, "ci95": [0.954, 0.996], "median_s": 1.6},
        "paraphrase": {"correct": 6, "n": 8, "ci95": [0.409, 0.929], "median_s": 1.6},
    }
    head, label, para = report(summary).splitlines()
    assert "server_errors 2" in head
    assert "151/153  95% CI 0.954-0.996" in label
    assert "n < 15" not in label
    assert "0.409-0.929  n < 15" in para
