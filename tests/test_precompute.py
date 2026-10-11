"""precompute.py logic on a tiny injected engine: two regions, two products.

No RaMa-Scene checkout and no full-size matrix is needed. The fake engine is
a four-sector input-output model with the call shapes of the real adapter in
precompute.py (load / apply_model / by_region / reference_validation). The
real engine is exercised only by tests/test_engine_plumbing.py, behind
`pytest --engine PATH`.
"""

import json
import math
import subprocess
import sys
import types
import weakref
from typing import Any

import numpy as np
import pytest

import precompute

REGIONS = ["R1", "R2"]
INDICATORS = [1, 2]
FINAL_CONSUMPTION = 276


def fake_engine(
    nan_on_demand_change=False,
    lose_a_region=False,
    shift_between_regions=False,
    leaky_zero_change=False,
    zero_change_drift=0.0,
    reference_fails=False,
    ignore_selection=False,
    raise_instead_of_cut=False,
    negative_B=False,
    engine_error=False,
):
    rng = np.random.default_rng(0)
    A = rng.random((4, 4)) * 0.2
    Y = rng.random((4, 2))
    B = rng.random((3, 4))
    if negative_B:
        B[:, 0] *= -1
    L = np.linalg.inv(np.identity(4) - A)
    live: dict[str, Any] = {"previous": None, "violations": 0, "apply_calls": 0}

    def load(name):
        return {"A": A, "Y": Y, "B": B, "L": L}[name].copy()

    def apply_model(model_details, Y_in):
        # the previous scenario's L must already be released
        if live["previous"] is not None and live["previous"]() is not None:
            live["violations"] += 1
        live["apply_calls"] += 1
        if engine_error:
            raise ValueError("no leaves for the selection")
        Y_s, A_s = Y_in.copy(), A.copy()
        for step in model_details:
            factor = 1 + step["techChange"][0] / 100
            if ignore_selection:
                factor = 1.0  # an empty cell selection: nothing is scaled
            if raise_instead_of_cut:
                factor = 1 - step["techChange"][0] / 100
            if step["consumedBy"] == [FINAL_CONSUMPTION]:
                Y_s[0] *= factor
            else:
                A_s[1, 0] *= factor
        if leaky_zero_change:
            A_s[0, 0] += 0.01
        A_s[0, 0] *= 1 + zero_change_drift
        L_s = np.linalg.inv(np.identity(4) - A_s)
        live["previous"] = weakref.ref(L_s)
        return Y_s, L_s

    def by_region(indicator, Y_in, B_in, L_in):
        # rows are country-major: two countries (R1, R2) of two products each
        m = B_in[indicator - 1] * (L_in @ Y_in.sum(axis=1))
        values = {"R1": float(m[:2].sum()), "R2": float(m[2:].sum())}
        if shift_between_regions:  # the sum over regions is unchanged
            values["R1"] += 0.1 * values["R2"]
            values["R2"] *= 0.9
        if nan_on_demand_change and not np.array_equal(Y_in, Y):
            values["R2"] = math.nan
        if lose_a_region:
            values["R2"] = 0.0
        return values

    def reference_validation(Y_in, B_in, L_in):
        return {"passed": not reference_fails, "tolerance": "relative 1e-6", "files": {}}

    return types.SimpleNamespace(
        load=load,
        apply_model=apply_model,
        by_region=by_region,
        region_leaves={"R1": [0], "R2": [1]},
        reference_validation=reference_validation,
        live=live,
    )


def run(engine):
    return precompute.compute(engine, precompute.SCENARIOS, INDICATORS)


def test_grid_is_baseline_plus_every_scenario_by_indicator_by_region():
    computed = run(fake_engine())
    assert list(computed["results"]) == ["baseline", *(s["id"] for s in precompute.SCENARIOS)]
    for by_indicator in computed["results"].values():
        assert list(by_indicator) == ["1", "2"]
        for by_region in by_indicator.values():
            assert list(by_region) == REGIONS


def test_scenarios_run_one_at_a_time_and_release_the_previous_matrices():
    engine = fake_engine()
    run(engine)
    assert engine.live["violations"] == 0


def test_non_finite_output_refuses_to_produce_a_result():
    with pytest.raises(ValueError, match="non-finite"):
        run(fake_engine(nan_on_demand_change=True))


def test_regional_values_must_match_the_direct_calculation():
    with pytest.raises(ValueError, match="independent_by_region"):
        run(fake_engine(lose_a_region=True))


def test_values_moved_between_regions_fail_although_the_sum_is_unchanged():
    with pytest.raises(ValueError, match="independent_by_region"):
        run(fake_engine(shift_between_regions=True))


def test_independent_check_is_per_region_with_an_absolute_floor():
    Y, B, L = np.ones((4, 2)), np.zeros((1, 4)), np.identity(4)
    leaves = {"R1": [0], "R2": [1]}
    check = precompute.independent_by_region(1, Y, B, L, {"R1": 1e-20, "R2": 0.0}, leaves)
    assert check["passed"]  # zero against 1e-20 is agreement, not an infinite relative error
    assert set(check["regions"]) == {"R1", "R2"}
    assert not precompute.independent_by_region(1, Y, B, L, {"R1": 0.0}, leaves)["passed"]  # a region missing


def test_relative_difference_has_an_absolute_floor():
    assert precompute.relative_difference(1e-20, 0.0) < 1e-6
    assert precompute.relative_difference(2.0, 1.0) == 1.0


def test_a_failed_octave_reference_check_aborts_before_any_inversion():
    engine = fake_engine(reference_fails=True)
    with pytest.raises(ValueError, match="Octave reference"):
        run(engine)
    assert engine.live["apply_calls"] == 0


def test_a_scenario_identical_to_its_reference_fails():
    with pytest.raises(ValueError, match="scenario_direction"):
        run(fake_engine(ignore_selection=True))


def test_a_cut_that_raises_an_indicator_total_fails():
    with pytest.raises(ValueError, match="scenario_direction"):
        run(fake_engine(raise_instead_of_cut=True))


def test_rise_check_is_skipped_with_a_warning_when_B_has_negative_entries():
    with pytest.warns(UserWarning, match="rise check skipped"):
        checks = run(fake_engine(raise_instead_of_cut=True, negative_B=True))["checks"]
    assert checks["scenario_direction"]["rise_check_skipped_indicators"] == INDICATORS


def test_cuts_lower_every_indicator_total():
    direction = run(fake_engine())["checks"]["scenario_direction"]
    assert direction["passed"] and not direction["unchanged"] and not direction["rises"]
    assert direction["references"]["vehicle-demand-europe"] == "baseline"
    assert direction["references"]["steel-in-vehicles-europe"] == "zero_change_control"


def test_an_engine_error_names_the_scenario():
    with pytest.raises(ValueError, match=r"vehicle-demand-europe.*no leaves"):
        run(fake_engine(engine_error=True))


def test_zero_change_through_the_modelling_path_must_reproduce_the_baseline():
    assert run(fake_engine())["checks"]["zero_change_control"]["passed"]
    with pytest.raises(ValueError, match="zero_change_control"):
        run(fake_engine(leaky_zero_change=True))


def test_zero_change_control_catches_drift_far_below_the_octave_tolerance():
    # a perturbation of A of 1e-7 moves the results by ~1e-8 relative: well
    # inside 1e-6, far outside the ~1e-15 a correct engine reaches
    with pytest.raises(ValueError, match="zero_change_control"):
        run(fake_engine(zero_change_drift=1e-7))


def test_zero_change_control_uses_the_modified_A_path():
    (step,) = run(fake_engine())["checks"]["zero_change_control"]["model_details"]
    assert step["techChange"] == [0]
    assert step["consumedBy"] != [FINAL_CONSUMPTION]  # final demand never inverts


def test_interventions_change_the_result():
    results = run(fake_engine())["results"]
    for scenario in precompute.SCENARIOS:
        assert results[scenario["id"]] != results["baseline"], scenario["id"]


# --- scenario definitions ---------------------------------------------------

STEP_KEYS = {"product", "originReg", "consumedBy", "consumedReg", "techChange"}


@pytest.mark.parametrize("scenario", precompute.SCENARIOS, ids=lambda s: s["id"])
def test_each_scenario_is_a_verbatim_engine_intervention(scenario):
    assert scenario["id"] != "baseline" and scenario["label"] and scenario["description"]
    assert scenario["model_details"]
    for step in scenario["model_details"]:
        assert set(step) == STEP_KEYS
        assert all(isinstance(v, list) and v for v in step.values())
        assert step["techChange"][0] != 0


def test_both_engine_intervention_kinds_are_covered():
    consumed_by = {s["model_details"][0]["consumedBy"][0] for s in precompute.SCENARIOS}
    assert FINAL_CONSUMPTION in consumed_by  # final demand, Y
    assert consumed_by - {FINAL_CONSUMPTION}  # technical coefficients, A


# --- output document --------------------------------------------------------

PROVENANCE = {
    "engine": {"repository": "r", "branch": "b", "commit": "c" * 40, "dirty": False},
    "dataset": {**precompute.DATASET, "year": 2011, "sha256": {}},
    "command": "uv run python precompute.py --run",
    "generated_at": "2026-09-26T00:00:00+00:00",
    "python": "3",
    "numpy": "2",
    "django": "5",
}
INDICATOR_META = [{"id": 1, "name": "One", "unit": "kg"}, {"id": 2, "name": "Two", "unit": "p"}]


def assembled():
    return precompute.assemble(run(fake_engine()), INDICATOR_META, dict(PROVENANCE), peak_rss_bytes=123)


def test_only_a_run_that_passed_every_check_is_assembled_and_it_is_exiobase():
    assert assembled()["data_kind"] == "exiobase-v3"


def test_document_carries_status_scenarios_verbatim_and_provenance():
    doc = assembled()
    assert doc["status"] == "precomputed — not a live calculation"
    assert doc["base_year"] == 2011
    assert doc["regions"] == REGIONS
    assert doc["indicators"] == INDICATOR_META
    assert doc["scenarios"][0]["id"] == "baseline"
    assert doc["scenarios"][1:] == precompute.SCENARIOS
    p = doc["provenance"]
    assert p["peak_rss_bytes"] == 123
    assert p["reference_validation"]["passed"] is True
    assert p["engine"]["commit"] == "c" * 40
    assert doc["checks"]["zero_change_control"]["passed"]
    json.dumps(doc, allow_nan=False)  # strict JSON: no NaN or Infinity anywhere


def test_provenance_records_commit_versions_and_dataset_hashes(tmp_path):
    engine = tmp_path / "engine"
    engine.mkdir()

    def git(*a):
        subprocess.run(["git", "-C", str(engine), *a], check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x")
    year = tmp_path / "data" / "2011"
    year.mkdir(parents=True)
    for name in "ALYB":
        (year / f"{name}_v4.npy").write_bytes(name.encode())

    p = precompute.collect_provenance(engine, tmp_path / "data", ["--run", "--engine", "e"])

    assert len(p["engine"]["commit"]) == 40 and p["engine"]["branch"] == "main"
    assert p["engine"]["repository"] is None  # no remote: recorded as absent, not a crash
    # Zenodo record 3533196, as its API returns it
    d = p["dataset"]
    assert d["doi"] == "10.5281/zenodo.3533196"
    assert (d["name"], d["version"], d["published"]) == ("EXIOBASE v3.3.sm", "V1", "2019-11-08")
    assert d["creators"] == ["Franco Donati", "Arjan de Koning"]
    assert "secondary technologies" in d["description"]
    assert (d["file_suffix"], d["year"]) == ("v4", 2011)
    assert set(p["dataset"]["sha256"]) == {"A", "L", "Y", "B"}
    assert p["python"] == ".".join(map(str, sys.version_info[:3]))
    assert p["numpy"] == np.__version__ and p["django"]
    assert p["command"] == "uv run python precompute.py --run --engine e"
    assert p["generated_at"].endswith("+00:00")


def test_command_records_the_dataset_directory_not_a_local_path():
    for argv in (["--data", "/Users/someone/data", "--run"], ["--data=/Users/someone/data", "--run"]):
        command = precompute.public_command(argv)
        assert "/Users/someone" not in command
        assert '"$DATASETS_DIR"' in command and command.endswith("--run")


def test_cli_refuses_to_run_the_engine_without_the_explicit_flag(capsys):
    with pytest.raises(SystemExit) as exit_info:
        precompute.main(["--engine", "e", "--data", "d", "--out", "o.json"])
    assert exit_info.value.code != 0
    assert "--run" in capsys.readouterr().err


def test_page_fixture_is_synthetic_and_shaped_like_real_output():
    from pathlib import Path

    fixture = json.loads((Path(__file__).parent / "fixture.json").read_text())
    doc = assembled()
    assert fixture["data_kind"] == "synthetic"
    assert set(fixture) == set(doc)
    assert set(fixture["provenance"]) == set(doc["provenance"])
    assert set(fixture["provenance"]["dataset"]) == set(PROVENANCE["dataset"])
    assert set(fixture["checks"]) == set(doc["checks"])
    assert [s["id"] for s in fixture["scenarios"]] == ["baseline", *(s["id"] for s in precompute.SCENARIOS)]
    assert set(fixture["results"]) == {s["id"] for s in fixture["scenarios"]}


def test_engine_remote_is_recorded_only_when_it_is_not_a_local_path():
    for local in ("/home/someone/bundles/ramascene.bundle", "file:///home/someone/r.git", "../ramascene", "~/r"):
        assert precompute.public_remote(local) is None
    for public in ("https://github.com/UM-Sustainability/ramascene.git", "git@github.com:x/ramascene.git"):
        assert precompute.public_remote(public) == public
    assert precompute.public_remote(None) is None
