"""The browser matrix format preserves float64 values and row boundaries."""

import hashlib

import numpy as np
import pyarrow.parquet as pq
import pytest

from export_browser import export, verify_arrays, write_matrix


def test_matrix_round_trip(tmp_path):
    matrix = np.random.default_rng(42).normal(size=(3, 5))
    path = tmp_path / "matrix.parquet"
    info = write_matrix(path, matrix)
    assert info["shape"] == [3, 5]
    assert info["bytes"] == path.stat().st_size
    assert info["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    file = pq.ParquetFile(path)
    assert file.num_row_groups == 3
    for i in range(3):
        np.testing.assert_array_equal(file.read_row_group(i).column("value").to_numpy(), matrix[i])


@pytest.mark.parametrize("shape", [(3, 49), (257, 49)])
def test_dense_matrix_groups_preserve_every_float64_bit(tmp_path, shape):
    matrix = np.random.default_rng(42).normal(size=shape)
    matrix[0, :3] = [-0.0, 1e-200, 1e200]
    original = matrix.copy()
    path = tmp_path / "dense.parquet"
    info = write_matrix(path, matrix, rows_per_group=128)
    file = pq.ParquetFile(path)
    assert file.num_row_groups == (shape[0] + 127) // 128
    assert info["shape"] == list(shape)
    restored = file.read().column("value").to_numpy().reshape(shape)
    np.testing.assert_array_equal(restored.view(np.uint64), original.view(np.uint64))
    np.testing.assert_array_equal(matrix.view(np.uint64), original.view(np.uint64))


def test_matrix_refuses_nonfinite_values(tmp_path):
    with pytest.raises(ValueError, match="non-finite"):
        write_matrix(tmp_path / "invalid.parquet", np.array([[np.inf]]))


def test_export_refuses_arrays_from_another_vintage(tmp_path):
    year = tmp_path / "2011"
    year.mkdir()
    values = b"EXIOBASE fixture"
    (year / "A_v4.npy").write_bytes(values)
    verify_arrays(tmp_path, {"A": hashlib.sha256(values).hexdigest()})
    with pytest.raises(ValueError, match="A does not match the published EXIOBASE arrays"):
        verify_arrays(tmp_path, {"A": "0" * 64})


def test_row_files_preserve_bits_and_hash_every_row(tmp_path):
    from export_browser import write_row_matrix

    matrix = np.random.default_rng(42).normal(size=(3, 5))
    matrix[0, :3] = [-0.0, 1e-200, 1e200]
    info = write_row_matrix(tmp_path, "A", matrix)
    directory = tmp_path / f"A-{info['sha256']}"
    files = [directory / f"{i}.parquet" for i in range(3)]
    assert sorted(p.name for p in directory.iterdir()) == ["0.parquet", "1.parquet", "2.parquet"]
    assert info["shape"] == [3, 5]
    assert info["storage"] == "rows"
    assert info["bytes"] == sum(p.stat().st_size for p in files)
    assert (
        info["sha256"] == hashlib.sha256(b"".join(hashlib.sha256(p.read_bytes()).digest() for p in files)).hexdigest()
    )
    for i, path in enumerate(files):
        file = pq.ParquetFile(path)
        assert file.num_row_groups == 1
        got = file.read().column("value").to_numpy()
        np.testing.assert_array_equal(got.view(np.uint64), matrix[i].view(np.uint64))


@pytest.mark.parametrize("manifest", ["manifest.json", "manifest-v2.json"])
def test_export_refuses_an_existing_manifest_before_reading_sources(tmp_path, manifest):
    (tmp_path / manifest).write_text("{}")
    with pytest.raises(ValueError, match="already has a manifest"):
        export(tmp_path / "absent-data", tmp_path / "absent-db", tmp_path)
