"""The browser matrix format preserves float64 values and row boundaries."""

import hashlib

import numpy as np
import pyarrow.parquet as pq
import pytest

from export_browser import verify_arrays, write_matrix


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
