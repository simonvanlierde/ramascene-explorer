"""evals/ask statistics: Wilson intervals, the exact McNemar test, Bonett-Price and run pairing."""

import json
import re
from pathlib import Path

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


def test_compare_flips(tmp_path, capsys):
    (tmp_path / "r2").mkdir()
    a = write(tmp_path / "m.jsonl", [{"kind": "view", "question": f"v{j}", "ok": j != 0} for j in range(4)])
    b = write(tmp_path / "r2" / "m.jsonl", [{"kind": "view", "question": f"v{j}", "ok": j != 1} for j in range(4)])
    # v0 and v1 changed between the runs; repeat runs may share a file name
    assert compare.main(["--flips", str(a), str(b)]) == 0
    assert capsys.readouterr().out == "view       n 4  flipped 2  rate 0.500\n"


# a catalogue small enough to read: section i covers leaf i, product 2 and region 3 are aliases
NAMES = {
    "products": {"Steel": 1, "Steel (alias)": 2, "Glass": 3},
    "regions": {"Total": 1, "Europe": 2, "Europe (alias)": 3},
    "consumers": {f"S: {i}": i for i in range(1, 16)} | {"Y: Final Consumption": 16},
}
LEAVES = {
    "products": {1: [7], 2: [7], 3: [8]},
    "regions": {1: [1, 2], 2: [2], 3: [2]},
    "consumers": {i: [i] for i in range(1, 17)},
}
SCEN = {
    "steel": {
        "label": "Steel input to all industries in Europe -10%",
        "model_details": [
            {
                "product": [1],
                "originReg": [1],
                "consumedBy": list(range(1, 16)),
                "consumedReg": [2],
                "techChange": [-10],
            }
        ],
    }
}


def answer(**lever):
    base = {"product": "Steel", "origin_region": "Total", "consumed_by": ["All industries"]}
    lv = base | {"consumed_region": "Europe", "change_percent": -10} | lever
    return json.dumps({"action": "whatif", "levers": [lv]})


def score(raw, accept=()):
    rec = {}
    return ask_eval.score("paraphrase", "steel", raw, NAMES, SCEN, LEAVES, rec, accept), rec


def test_score_by_leaves_and_accept_list():
    assert score(answer(product="Steel (alias)", consumed_region="Europe (alias)"))[0]
    ok, rec = score(answer(consumed_by=["S: 5"]))
    assert not ok
    assert rec["fields"]["consumed_by"] == [False]
    assert rec["fields"]["product"] == [True]
    mfg = [
        {
            "product": "Steel",
            "origin_region": "Total",
            "consumed_by": ["S: 5"],
            "consumed_region": "Europe",
            "change_percent": -10,
        }
    ]
    alt = [sorted(ask_eval.canon(lv, NAMES, LEAVES) for lv in mfg)]  # as load_items resolves it
    ok, rec = score(answer(consumed_by=["S: 5"]), alt)
    assert ok
    assert "fields" not in rec  # an accepted answer is not a field miss
    assert not score(answer(product="Glass"), alt)[0]
    ok, rec = score("not json", alt)
    assert not ok
    assert "error" in rec


def items_file(tmp_path, **extra):
    data = {"paraphrase": [{"question": "Europe cuts steel by a tenth", "scenario": "steel"}], "view": [], "none": []}
    path = tmp_path / "items.json"
    path.write_text(json.dumps(data | extra))
    return path


def test_load_items_rejects_bad_gold(tmp_path):
    items = ask_eval.load_items(items_file(tmp_path), NAMES, SCEN, LEAVES)
    assert [(k, a) for k, _, _, a in items] == [("label", []), ("paraphrase", [])]
    bad_lever = json.loads(answer(product="Steel typo"))["levers"][0]
    for extra, error, message in [
        ({"paraphrase": [{"question": "q", "scenario": "nope"}]}, ValueError, "not a scored scenario"),
        ({"paraphrase": [{"question": "q", "scenario": "steel", "accept": [[bad_lever]]}]}, KeyError, "Steel typo"),
        ({"view": [{"question": "q", "indicator": None, "region": "Mars"}]}, ValueError, "schema allows"),
        ({"view": [{"question": "q", "indicator": None, "region": "Europe"}]}, ValueError, "schema allows"),
        ({"view": [{"question": "q", "indicator": "co2", "region": None}]}, ValueError, "schema allows"),
        (
            {"view": [{"question": "q", "indicator": None, "region": None, "accept": [["ghg", "Mars"]]}]},
            ValueError,
            "schema allows",
        ),
        ({"none": [{"question": "q"}, {"question": "q"}]}, ValueError, "repeated item"),
    ]:
        with pytest.raises(error, match=message):
            ask_eval.load_items(items_file(tmp_path, **extra), NAMES, SCEN, LEAVES)


def test_rescore_replaces_a_stale_ok_and_gates_on_labels(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ask_eval, "load", lambda *_: (NAMES, SCEN, LEAVES))
    out = tmp_path / "out"
    out.mkdir()
    write(
        out / "m.jsonl",
        [
            # scored wrong by an older scorer that compared names, not leaves
            {
                "kind": "paraphrase",
                "question": "Europe cuts steel by a tenth",
                "ok": False,
                "raw": answer(product="Steel (alias)"),
                "secs": 1.0,
            },
            {"kind": "label", "question": SCEN["steel"]["label"], "ok": True, "raw": answer(product="Glass")},
        ],
    )
    args = ["manifest", "results", str(out), "--items", str(items_file(tmp_path)), "--rescore"]
    assert ask_eval.main(args) == 1  # 0 of 1 label questions is below the gate
    recs = [json.loads(line) for line in (out / "m.jsonl").read_text().splitlines()]
    assert [r["ok"] for r in recs] == [True, False]
    summary = json.loads((out / "m.summary.json").read_text())
    assert [summary["paraphrase"][k] for k in ("correct", "n", "median_s")] == [1, 1, 1.0]
    assert summary["label"]["fields_wrong"] == {
        "product": 1,
        "origin": 0,
        "consumed_by": 0,
        "consumed_region": 0,
        "change": 0,
    }
    # a log from another --items (the held-out run) is refused and left as it was
    with (out / "m.jsonl").open("a") as log:
        log.write(json.dumps({"kind": "none", "question": "held out", "ok": True, "raw": "{}"}) + "\n")
    before = (out / "m.jsonl").read_bytes()
    assert ask_eval.main(args) == 3
    assert (out / "m.jsonl").read_bytes() == before
    assert "1 items not in the gold set" in capsys.readouterr().err


def test_rescore_of_an_empty_folder_fails(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ask_eval, "load", lambda *_: (NAMES, SCEN, LEAVES))
    args = ["manifest", "results", str(tmp_path / "out"), "--items", str(items_file(tmp_path)), "--rescore"]
    assert ask_eval.main(args) == 3
    assert "no <model>.jsonl" in capsys.readouterr().err


def test_a_log_without_labels_fails_the_gate(tmp_path, monkeypatch):
    monkeypatch.setattr(ask_eval, "load", lambda *_: (NAMES, SCEN, LEAVES))
    out = tmp_path / "out"
    out.mkdir()
    write(out / "m.jsonl", [{"kind": "paraphrase", "question": "Europe cuts steel by a tenth", "raw": answer()}])
    assert ask_eval.main(["manifest", "results", str(out), "--items", str(items_file(tmp_path)), "--rescore"]) == 1


@pytest.mark.parametrize("env", [{"NODE_SERVE_NAME": "m"}, {"NODE_SERVE_URL": "http://127.0.0.1:1/v1"}])
def test_eval_needs_a_server_url_and_name(tmp_path, monkeypatch, env):
    for k in ("NODE_SERVE_URL", "NODE_SERVE_NAME"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    with pytest.raises(SystemExit) as e:
        ask_eval.main(["m", "r", str(tmp_path)])
    assert e.value.code == 2


REPO_ITEMS = ask_eval.ITEMS
MANIFEST = Path("data/browser-engine/manifest-v3.json")


@pytest.mark.skipif(not MANIFEST.exists(), reason="needs the browser store")
def test_repo_items_load_against_the_catalogue():
    names, scen, leaves = ask_eval.load(MANIFEST, "data/results.json")
    items = ask_eval.load_items(REPO_ITEMS, names, scen, leaves)
    paraphrased = [g for k, _, g, _ in items if k == "paraphrase"]
    assert len(paraphrased) == len(set(paraphrased))  # one scenario each, so a split by scenario holds


def test_paraphrases_do_not_copy_a_label():
    # token Jaccard above 0.5 against any label (few-shot examples included) tests copying, not reading
    labels = [s["label"] for s in json.loads(Path("data/results.json").read_text())["scenarios"]]

    def toks(s):
        return set(re.findall(r"[a-z0-9]+", s.lower()))

    for it in json.loads(REPO_ITEMS.read_text())["paraphrase"]:
        q = toks(it["question"])
        assert max(len(q & toks(t)) / len(q | toks(t)) for t in labels) <= 0.5, it["question"]


def test_view_accept_list():
    def view(indicator, region):
        raw = json.dumps({"action": "view", "indicator": indicator, "region": region})
        return ask_eval.score("view", (None, "Europe"), raw, NAMES, SCEN, LEAVES, {}, [("ghg", "Europe")])

    assert view(None, "Europe")
    assert view("ghg", "Europe")
    assert not view("jobs", "Europe")
