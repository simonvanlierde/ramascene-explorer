"""The browser store keeps float32 values, row order and the reader's shard layout."""

import hashlib

import numpy as np
import pytest
import zarr

from export_browser import export, flow_totals, store_hash, verify_arrays, write_array


def test_array_round_trips_through_zarr_and_keeps_row_order(tmp_path):
    matrix = np.random.default_rng(42).normal(size=(400, 5))
    matrix[1] = 0
    matrix[0, :3] = [-0.0, 1e-30, 1e30]
    info = write_array(tmp_path, "A", matrix)
    assert info["shape"] == [400, 5]
    assert info["shard_rows"] == 200
    assert info["chunk_rows"] == 1
    shards = [tmp_path / "A" / "c" / str(i) / "0" for i in range(2)]
    assert info["shard_bytes"] == [p.stat().st_size for p in shards]
    got = np.asarray(zarr.open_array(tmp_path / "A", mode="r")[:])
    np.testing.assert_array_equal(got.view(np.uint32), matrix.astype(np.float32).view(np.uint32))
    # the index at the end of each shard: offsets rise with the row, the zero row is empty
    index = np.frombuffer(shards[0].read_bytes()[-16 * 200 :], "<u8").reshape(200, 2)
    assert (index[1] == 2**64 - 1).all()
    offsets = np.delete(index[:, 0], 1)
    assert (np.diff(offsets.astype(np.int64)) > 0).all()


def test_country_chunks_and_whole_shards(tmp_path):
    matrix = np.arange(400 * 3, dtype=float).reshape(400, 3)
    info = write_array(tmp_path, "X", matrix, chunk_rows=200, shard_rows=400)
    assert len(info["shard_bytes"]) == 1
    np.testing.assert_array_equal(zarr.open_array(tmp_path / "X", mode="r")[:], matrix)
    with pytest.raises(ValueError, match="whole shards"):
        write_array(tmp_path, "Y", matrix[:300])


def test_array_refuses_nonfinite_and_float32_overflow(tmp_path):
    with pytest.raises(ValueError, match="non-finite"):
        write_array(tmp_path, "A", np.full((200, 1), np.inf))
    with pytest.raises(ValueError, match="overflows float32"):
        write_array(tmp_path, "B", np.full((200, 1), 1e300))


def test_flow_totals_reproduce_the_grouped_flows():
    rng = np.random.default_rng(7)
    products, countries = 4, 2
    sections = [[0, 2], [1, 3]]
    B = rng.random((2, products * countries))
    L = rng.random((products * countries, products * countries))
    Y = rng.random((products * countries, countries))
    H = flow_totals(B, L, sections)
    assert H.shape == (8, 2 * countries * len(sections))
    X = L @ Y
    want = np.empty((2, countries, len(sections), countries))
    for i in range(2):
        E = (B[i][:, None] * X).reshape(countries, products, countries)
        for s, leaves in enumerate(sections):
            want[i, :, s, :] = E[:, leaves, :].sum(axis=1)
    np.testing.assert_allclose((H.T @ Y).reshape(want.shape), want, rtol=1e-13)


def test_store_hash_covers_paths_and_contents(tmp_path):
    (tmp_path / "a").write_bytes(b"1")
    first = store_hash(tmp_path)
    (tmp_path / "a").write_bytes(b"2")
    second = store_hash(tmp_path)
    (tmp_path / "a").rename(tmp_path / "b")
    assert len({first, second, store_hash(tmp_path)}) == 3


def test_export_refuses_arrays_from_another_vintage(tmp_path):
    year = tmp_path / "2011"
    year.mkdir()
    values = b"EXIOBASE fixture"
    (year / "A_v4.npy").write_bytes(values)
    verify_arrays(tmp_path, {"A": hashlib.sha256(values).hexdigest()})
    with pytest.raises(ValueError, match="A does not match the published EXIOBASE arrays"):
        verify_arrays(tmp_path, {"A": "0" * 64})


@pytest.mark.parametrize("manifest", ["manifest.json", "manifest-v2.json", "manifest-v3.json"])
def test_export_refuses_an_existing_manifest_before_reading_sources(tmp_path, manifest):
    (tmp_path / manifest).write_text("{}")
    with pytest.raises(ValueError, match="already has a manifest"):
        export(tmp_path / "absent-data", tmp_path / "absent-db", tmp_path)
