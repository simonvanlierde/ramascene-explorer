"""The case every route scores, and where the routes read RaMa-Scene's arrays.

1 M EUR of final demand for "Cement, lime and plaster" (p26.d) made in the
Netherlands, scored on "GHG emissions: Total" (kg CO2 eq), EXIOBASE v3.3.sm 2011.
"""

from pathlib import Path

import numpy as np

YEAR = 2011
NL_LOCAL, CEMENT_LOCAL = 20, 100  # 0-based leaf indices
K = NL_LOCAL * 200 + CEMENT_LOCAL  # matrix row, region-major: 4100
GHG_ROW = 4  # indicator global_id 5 in the RaMa-Scene db; the engine reads B[global_id - 1]


def array(data, name, **kwargs):
    """`name` (A, B, L or Y) from DATASETS_DIR; `_v4` is RaMa-Scene's file suffix, not a dataset version."""
    return np.load(Path(data) / str(YEAR) / f"{name}_v4.npy", **kwargs)
