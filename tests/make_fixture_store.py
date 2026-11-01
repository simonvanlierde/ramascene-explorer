"""Write tests/fixture-store: a 4 x 3 float32 array in the browser export's Zarr layout.

Two shards of two rows, one gzip chunk per row; row 2 is all zeros, so its chunk
is stored as empty. The reader tests read it as the browser would.
Run: uv run python -m tests.make_fixture_store
"""

import json
import shutil
from pathlib import Path

import numpy as np

from export_browser import write_array

HERE = Path(__file__).parent / "fixture-store"
MATRIX = np.array([[1.25, -0.125, 0], [1e-12, 1e9, 0.1], [0, 0, 0], [-0.0, 3, 2**-20]])


def main():
    shutil.rmtree(HERE, ignore_errors=True)
    HERE.mkdir()
    info = write_array(HERE, "M", MATRIX, chunk_rows=1, shard_rows=2)
    (HERE / "info.json").write_text(json.dumps(info) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
