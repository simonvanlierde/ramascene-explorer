"""compare_data.py: two precompute runs agree value by value, to a relative tolerance."""

import json

import pytest

import compare_data


def doc(scale=1.0, **extra):
    return {
        "scenarios": [{"id": "baseline"}, {"id": "s1"}],
        "results": {
            "baseline": {"5": {"Europe": 2.0 * scale, "Africa": 0.0}},
            "s1": {"5": {"Europe": 1.5, "Africa": -3.0}},
        },
        "provenance": {"generated_at": "any"},
        **extra,
    }


def test_identical_runs_have_zero_difference():
    report = compare_data.compare(doc(), doc())
    assert report == {"values": 4, "max_relative_difference": 0.0, "where": None, "mismatches": []}


def test_the_largest_relative_difference_is_reported_with_its_path():
    report = compare_data.compare(doc(), doc(scale=1 + 3e-13))
    assert report["values"] == 4
    assert report["max_relative_difference"] == pytest.approx(3e-13, rel=1e-3)
    assert report["where"] == "results/baseline/5/Europe"
    assert report["mismatches"] == []


def test_provenance_is_not_compared_but_structure_and_labels_are():
    other = doc()
    other["provenance"]["generated_at"] = "later"
    assert compare_data.compare(doc(), other)["mismatches"] == []
    other["results"]["s1"]["5"]["Asia"] = 1.0
    other["scenarios"][1]["id"] = "s2"
    mismatches = compare_data.compare(doc(), other)["mismatches"]
    assert "scenarios/1/id: 's1' != 's2'" in mismatches
    assert any(m.startswith("results/s1/5: keys differ") for m in mismatches)


def test_flows_lists_are_compared_item_by_item():
    flows = [{"sector": "A", "delta": -1.0, "named": True}, {"sector": "Other", "delta": -0.5, "named": False}]
    other = json.loads(json.dumps(flows))
    other[1]["sector"] = "B"
    report = compare_data.compare({"results": {"s": flows}}, {"results": {"s": other}})
    assert report["values"] == 2
    assert report["mismatches"] == ["results/s/1/sector: 'Other' != 'B'"]
    report = compare_data.compare({"results": {"s": flows}}, {"results": {"s": flows[:1]}})
    assert report["mismatches"] == ["results/s: length 2 != 1"]


def test_cli_fails_beyond_the_tolerance(tmp_path, capsys):
    old, new = tmp_path / "old", tmp_path / "new"
    for d, scale in ((old, 1.0), (new, 1 + 1e-9)):
        d.mkdir()
        for name in compare_data.FILES:
            (d / name).write_text(json.dumps(doc(scale)))
    assert compare_data.main([str(old), str(new)]) == 1
    assert compare_data.main([str(old), str(new), "--rtol", "1e-8"]) == 0
    out = capsys.readouterr().out
    assert "results.json: 4 values" in out and "flows.json" in out
