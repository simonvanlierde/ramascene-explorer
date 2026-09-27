"""precompute.py logic on a tiny injected engine: two regions, two products.

No RaMa-Scene checkout and no full-size matrix is needed. The fake engine is
a four-sector input-output model with the call shapes of the real adapter in
precompute.py (load / apply_model / by_region / reference_validation). The
real engine is exercised only by tests/test_engine_plumbing.py, behind
`pytest --engine=PATH`.
"""

import json
import math
import subprocess
import sys
import types
import weakref

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
    reference_fails=False,
    ignore_selection=False,
    raise_instead_of_cut=False,
    negative_B=False,
    engine_error=False,
    fail_scenario=None,
):
    rng = np.random.default_rng(0)
    A = rng.random((4, 4)) * 0.2
    Y = rng.random((4, 2))
    B = rng.random((3, 4))
    if negative_B:
        B[:, 0] *= -1
    L = np.linalg.inv(np.identity(4) - A)
    live = {"previous": None, "violations": 0, "apply_calls": 0, "current": None}

    def load(name):
        return {"A": A, "Y": Y, "B": B, "L": L}[name].copy()

    def apply_model(model_details, Y_in):
        # the previous scenario's L must already be released
        if live["previous"] is not None and live["previous"]() is not None:
            live["violations"] += 1
        live["apply_calls"] += 1
        if engine_error is True or engine_error == live["current"]:
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
        if fail_scenario is not None and fail_scenario == live["current"]:
            values["R1"] = math.inf
        if lose_a_region:
            values["R2"] = 0.0
        return values

    def reference_validation(Y_in, B_in, L_in):
        return {"passed": not reference_fails, "tolerance": "relative 1e-6", "files": {}}

    engine = types.SimpleNamespace(
        load=load,
        apply_model=apply_model,
        by_region=by_region,
        region_leaves={"R1": [0], "R2": [1]},
        reference_validation=reference_validation,
        live=live,
    )

    def scenario(name, model_details, indicators, detail=False):
        live["current"] = name
        return precompute.scenario_in_process(engine, name, model_details, indicators, load("Y"), load("B"), detail)

    engine.scenario = scenario
    return engine


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
    del engine.scenario  # the in-process fallback of compute() must release them too
    run(engine)
    assert engine.live["violations"] == 0


def test_run_records_carry_status_and_timing():
    computed = run(fake_engine())
    assert set(computed["runs"]) == {*(s["id"] for s in precompute.SCENARIOS), "zero_change_control"}
    for name, r in computed["runs"].items():
        assert r["engine_s"] >= 0 and r["wall_s"] >= 0, name
        assert r.get("status") == ("passed" if name != "zero_change_control" else None)
    summary = precompute.run_summary(computed["runs"], {"files": {"a": {"values": 2}, "b": {"values": 3}}})
    assert (summary["scenarios_run"], summary["passed"], summary["failed"]) == (3, 3, 0)
    assert summary["wall_s"]["n"] == 3 and summary["wall_s"]["max"] >= summary["wall_s"]["median"]
    assert summary["peak_rss_bytes"] is None  # no worker process in the fake engine
    assert (summary["octave_reference_files"], summary["octave_reference_values"]) == (2, 5)


def test_non_finite_output_marks_the_scenario_failed_and_publishes_the_rest():
    computed = run(fake_engine(nan_on_demand_change=True))
    assert list(computed["failed"]) == ["vehicle-demand-europe"]  # the only final-demand scenario
    assert "non-finite" in computed["failed"]["vehicle-demand-europe"]
    assert "vehicle-demand-europe" not in computed["results"]
    assert computed["runs"]["vehicle-demand-europe"]["status"] == "failed"
    assert set(computed["results"]) == {"baseline", "steel-in-vehicles-europe", "cement-in-construction"}


def test_a_failed_scenario_is_listed_with_its_reason_and_left_out_of_the_page_data():
    doc = precompute.assemble(
        run(fake_engine(fail_scenario="cement-in-construction")), INDICATOR_META, dict(PROVENANCE), peak_rss_bytes=1
    )
    assert [s["id"] for s in doc["scenarios"]] == ["baseline", "vehicle-demand-europe", "steel-in-vehicles-europe"]
    (failed,) = doc["failed"]
    assert failed["id"] == "cement-in-construction" and "non-finite" in failed["reason"]
    assert failed["model_details"] and failed["label"]
    assert "cement-in-construction" not in doc["results"]
    assert doc["runs"]["cement-in-construction"]["status"] == "failed"
    assert doc["provenance"]["run"] == {**doc["provenance"]["run"], "scenarios_run": 3, "passed": 2, "failed": 1}
    assert doc["checks"]["published_passed_every_check"] is True
    assert "cement-in-construction" in precompute.run_log(doc)


def test_every_scenario_failing_leaves_nothing_to_write():
    with pytest.raises(ValueError, match="every scenario failed"):
        run(fake_engine(fail_scenario="vehicle-demand-europe", nan_on_demand_change=True, ignore_selection=True))


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


def test_scenarios_identical_to_their_reference_fail():
    with pytest.raises(ValueError, match="(?s)every scenario failed.*identical to its reference") as info:
        run(fake_engine(ignore_selection=True))
    assert "zero_change_control" in str(info.value) and "baseline" in str(info.value)  # the reference each was held to


def test_a_change_within_float_noise_counts_as_unchanged():
    scenario = {"id": "noise", "model_details": [{"consumedBy": [FINAL_CONSUMPTION]}]}
    baseline = {"1": {"R1": 1.0, "R2": 2.0}, "2": {"R1": 3.0, "R2": 4.0}}
    Y, B = np.ones((2, 1)), np.ones((2, 2))

    def direction(result):
        results = {"baseline": baseline, "noise": result}
        return precompute.scenario_direction([scenario], results, baseline, Y, B, INDICATORS)

    noise = {"1": {"R1": 1.0 - 1e-13, "R2": 2.0}, "2": {"R1": 3.0, "R2": 4.0 - 1e-13}}
    assert noise != baseline and direction(noise)["unchanged"] == ["noise"]
    cut = {"1": {"R1": 0.9, "R2": 2.0}, "2": {"R1": 3.0, "R2": 4.0}}
    assert direction(cut)["passed"]


def test_cuts_that_raise_an_indicator_total_fail():
    with pytest.raises(ValueError, match="(?s)every scenario failed.*total rises"):
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


def test_an_engine_error_names_the_scenario_and_fails_only_that_one():
    computed = run(fake_engine(engine_error="vehicle-demand-europe"))
    assert computed["failed"] == {
        "vehicle-demand-europe": "scenario vehicle-demand-europe: no leaves for the selection"
    }
    assert len(computed["results"]) == 3  # baseline and the other two


def test_an_engine_error_on_the_control_aborts_the_run():
    with pytest.raises(ValueError, match="zero_change_control.*no leaves"):
        run(fake_engine(engine_error="zero_change_control"))


def test_zero_change_through_the_modelling_path_must_reproduce_the_baseline():
    assert run(fake_engine())["checks"]["zero_change_control"]["passed"]
    with pytest.raises(ValueError, match="zero_change_control"):
        run(fake_engine(leaky_zero_change=True))


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
    "engine": {"repository": "r", "branch": "b", "commit": "c" * 40, "label": "b @ ccccccc", "dirty": False},
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
    assert doc["grid"] == precompute.GRID
    assert doc["failed"] == []
    p = doc["provenance"]
    assert p["peak_rss_bytes"] == 123 and p["parent_peak_rss_bytes"] == 123
    assert p["run"]["passed"] == 3
    assert p["reference_validation"]["passed"] is True
    assert p["engine"]["commit"] == "c" * 40
    assert doc["checks"]["zero_change_control"]["passed"]
    json.dumps(doc, allow_nan=False)  # strict JSON: no NaN or Infinity anywhere


def test_provenance_records_commit_versions_and_dataset_hashes(tmp_path):
    engine = tmp_path / "engine"
    engine.mkdir()
    git = lambda *a: subprocess.run(["git", "-C", str(engine), *a], check=True, capture_output=True)
    git("init", "-q", "-b", "main")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x")
    year = tmp_path / "data" / "2011"
    year.mkdir(parents=True)
    for name in "ALYB":
        (year / f"{name}_v4.npy").write_bytes(name.encode())

    p = precompute.collect_provenance(engine, tmp_path / "data", ["--run", "--engine", "e"])

    assert len(p["engine"]["commit"]) == 40 and p["engine"]["branch"] == "main"
    assert p["engine"]["label"] == f"main @ {p['engine']['commit'][:7]}"
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


def test_command_hides_an_absolute_engine_path_but_keeps_a_relative_one():
    for argv in (["--engine", "/tmp/someone/engine", "--run"], ["--engine=/home/someone/engine", "--run"]):
        command = precompute.public_command(argv)
        assert "someone" not in command
        assert '"$ENGINE_DIR"' in command and command.endswith("--run")
    assert precompute.public_command(["--engine", "../ramascene"]).endswith("--engine ../ramascene")


def test_scenarios_without_a_technology_change_are_refused_by_name():
    final_demand_only = [s for s in precompute.SCENARIOS if s["model_details"][0]["consumedBy"] == [FINAL_CONSUMPTION]]
    with pytest.raises(ValueError, match="zero_change_control"):
        precompute.compute(fake_engine(), final_demand_only, INDICATORS)


def test_cli_refuses_to_run_the_engine_without_the_explicit_flag(capsys):
    with pytest.raises(SystemExit) as exit_info:
        precompute.main(["--engine", "e", "--data", "d", "--out", "o.json"])
    assert exit_info.value.code != 0
    assert "--run" in capsys.readouterr().err


def git_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    git = ["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "engine"], check=True)
    return path


def test_cli_refuses_an_engine_that_is_not_a_git_checkout_before_running_it(tmp_path, capsys):
    engine, out = tmp_path / "engine", tmp_path / "o.json"
    engine.mkdir()
    with pytest.raises(SystemExit) as exit_info:
        precompute.main(["--run", "--engine", str(engine), "--data", str(tmp_path), "--out", str(out)])
    assert exit_info.value.code != 0
    assert "engine commit" in capsys.readouterr().err
    assert not out.exists()


def test_an_engine_inside_another_repository_has_no_commit_of_its_own(tmp_path):
    engine = tmp_path / "outer" / "engine"
    git_repo(tmp_path / "outer")
    engine.mkdir()
    assert precompute.engine_revision(engine)["commit"] is None
    assert len(precompute.engine_revision(tmp_path / "outer")["commit"]) == 40


def test_output_without_an_engine_commit_is_not_assembled():
    provenance = {**PROVENANCE, "engine": {**PROVENANCE["engine"], "commit": None, "label": None}}
    with pytest.raises(ValueError, match="engine commit"):
        precompute.assemble(run(fake_engine()), INDICATOR_META, provenance, peak_rss_bytes=1)


def test_page_fixture_is_synthetic_and_shaped_like_real_output():
    from pathlib import Path

    fixture = json.loads((Path(__file__).parent / "fixture.json").read_text())
    doc = assembled()
    assert fixture["data_kind"] == "synthetic"
    assert set(fixture) == set(doc)
    assert set(fixture["provenance"]) == set(doc["provenance"])
    assert set(fixture["provenance"]["dataset"]) == set(PROVENANCE["dataset"])
    assert set(fixture["checks"]) == set(doc["checks"])
    ids = [s["id"] for s in fixture["scenarios"]]
    assert ids[:4] == ["baseline", *(s["id"] for s in precompute.SCENARIOS)]
    grid_ids = {s["id"] for s in precompute.grid_scenarios()}
    assert ids[4:] and set(ids[4:]) <= grid_ids  # a few grid cells, so the page pickers are exercised
    assert set(fixture["results"]) == set(ids)
    assert fixture["failed"] and {f["id"] for f in fixture["failed"]} <= grid_ids - set(ids)
    assert fixture["grid"] == precompute.GRID


def test_engine_remote_is_recorded_only_when_it_is_not_a_local_path():
    for local in ("/home/someone/bundles/ramascene.bundle", "file:///home/someone/r.git", "../ramascene", "~/r"):
        assert precompute.public_remote(local) is None
    for public in ("https://github.com/UM-Sustainability/ramascene.git", "git@github.com:x/ramascene.git"):
        assert precompute.public_remote(public) == public
    assert precompute.public_remote(None) is None


def test_a_scenario_missing_a_region_is_recorded_as_failed_and_the_output_still_serialises():
    engine = fake_engine()
    by_region = engine.by_region

    def drop_r2_in_one_scenario(indicator, Y_in, B_in, L_in):
        values = by_region(indicator, Y_in, B_in, L_in)
        if engine.live["current"] == "cement-in-construction":
            del values["R2"]
        return values

    engine.by_region = drop_r2_in_one_scenario
    computed = run(engine)
    assert "independent_by_region" in computed["failed"]["cement-in-construction"]
    doc = precompute.assemble(computed, INDICATOR_META, dict(PROVENANCE), peak_rss_bytes=1)
    json.dumps(doc, allow_nan=False)  # the writer's call: a NaN here would lose the whole run


def test_a_worker_that_prints_nothing_fails_its_scenario_not_the_run(monkeypatch):
    done = subprocess.CompletedProcess([], 0, stdout="", stderr="")
    monkeypatch.setattr(precompute.subprocess, "run", lambda *a, **k: done)
    scenario = precompute.worker_scenario("engine", "data")
    with pytest.raises(ValueError, match="scenario s1"):
        scenario("s1", [], [1])


def test_cli_refuses_to_write_when_the_engine_checkout_moves_during_the_run(tmp_path, monkeypatch, capsys):
    engine_dir, out = git_repo(tmp_path / "engine"), tmp_path / "data" / "results.json"
    engine = fake_engine()
    apply_model = engine.apply_model

    def apply_model_then_commit(model_details, Y_in):
        # another checkout of the engine lands mid-run: later workers would run other code
        git = ["git", "-C", str(engine_dir), "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "moved"], check=True)
        return apply_model(model_details, Y_in)

    engine.apply_model = apply_model_then_commit
    monkeypatch.setattr(precompute, "setup_django", lambda *a: None)
    monkeypatch.setattr(precompute, "real_engine", lambda *a: engine)
    monkeypatch.setattr(precompute, "INDICATORS", INDICATORS)
    monkeypatch.setattr(precompute, "indicator_meta", lambda i: INDICATOR_META)
    monkeypatch.setattr(
        precompute,
        "collect_provenance",
        lambda e, d, argv: {**PROVENANCE, "engine": precompute.engine_revision(e)},
    )
    with pytest.raises(SystemExit) as exit_info:
        precompute.main(
            [
                "--run",
                "--engine",
                str(engine_dir),
                "--data",
                str(tmp_path),
                "--out",
                str(out),
                "--scenarios",
                "original",
            ]
        )
    assert exit_info.value.code != 0
    assert "engine checkout changed" in capsys.readouterr().err
    assert not out.exists()
