# Brightway check

Loads EXIOBASE v3.3.sm (2011, monetary product-by-product, as the numpy
arrays that RaMa-Scene reads) into a Brightway project as one input-output
database. Then it runs one LCA and checks the score against numpy, pymrio and
RaMa-Scene's own engine. The engine route uses the explorer's adapter in
`../precompute.py`, so this is a check on the same engine the explorer's
results come from.

The LCA: 1 M EUR of final demand for "Cement, lime and plaster" (p26.d) made
in the Netherlands, scored on "GHG emissions: Total" (kg CO2 eq).

## Results

All routes give the same footprint, 1,642,630.56 kg CO2 eq per M EUR.

| Route | Score (kg CO2 eq) | Relative difference |
| --- | --- | --- |
| Brightway (bw2calc, SuperLU) | 1642630.5555948804 | reference |
| numpy, dense solve of I - A | 1642630.5555952443 | 2.2e-13 |
| numpy, I - A with the same entries dropped as in Brightway | 1642630.5555948887 | 5.1e-15 |
| column of the shipped L matrix | 1642630.55559524 | 2.2e-13 |
| RaMa-Scene engine, `route_one` | 1642630.5555952408 | 2.2e-13 |
| pymrio 0.7.0, `calc_all` with its own inverse | 1642630.5555952433 | 2.2e-13 |

The small gap between Brightway and the full solve comes from the entries
below 1e-15 that the build drops. With the same entries dropped, numpy and
Brightway agree to 5.1e-15. Before the footprint run, the engine also passed
its four Octave reference files: 122 values, 0 mismatches. The engine route
reads the same shipped L as the row above it, so it checks the engine's
indexing and labels, not the inverse itself. pymrio does compute its own
inverse: its L column matches the shipped one to 4e-17. pymrio has no reader
for v3.3.sm, so `pymrio_check.py` builds its `IOSystem` from the arrays.

About 74 % of the footprint (1,217,285 kg) is emitted by Dutch cement production
itself, including the cement it uses as its own input. The 1 M EUR delivered
alone emits 1,122,235 kg (68 %).

Build and run figures (from `results/`):

- Database: 9,800 activities (49 regions x 200 products) and 60 extension flows.
- A has 38,963,403 non-zero entries (density 0.41). The build drops 2,876,890
  of them below 1e-15, a share of 1.05e-13 of the absolute sum, and writes
  36,088,625 technosphere and 357,707 biosphere entries.
- The build takes 6 s and 2.9 GiB RAM. The project directory is 876 MiB.
- The Brightway LCI takes 129 s with SuperLU (pypardiso not installed) and
  5.2 GiB RAM. The dense numpy solve takes 15 s. The engine route takes 0.02 s,
  because it reads the precomputed L. pymrio's `calc_all` takes 28 s and 4.5 GiB.

Full output: `results/build.json`, `results/lca.json`, `results/engine.json` and
`results/pymrio.json`.

## Run

You need:

- Python 3.12 and [uv](https://docs.astral.sh/uv/).
- The EXIOBASE v3.3.sm arrays in `$DATASETS_DIR/2011/{A,B,L,Y}_v4.npy`.
- A RaMa-Scene checkout in `$RAMASCENE_DIR`, as a git work tree so the engine
  commit can be recorded. `build_db.py` reads the product, region and indicator
  labels from a copy of its `db.sqlite3`.

`build_db.py` deletes the `exiobase-brightway-bridge` Brightway project if it exists, then
writes about 880 MB into `bwdir/`.

Run from this folder, which is its own uv project (the Brightway pins stay out of
the explorer's environment):

```sh
cd brightway-check
uv sync
cp "$RAMASCENE_DIR/db.sqlite3" /tmp/ramascene-db.sqlite3
BRIGHTWAY2_DIR=$PWD/bwdir uv run python build_db.py --data "$DATASETS_DIR" --db /tmp/ramascene-db.sqlite3
BRIGHTWAY2_DIR=$PWD/bwdir uv run python lca.py --data "$DATASETS_DIR" --out results/lca.json
uv run --project .. python engine.py --engine "$RAMASCENE_DIR" --data "$DATASETS_DIR" --out results/engine.json
uv run python pymrio_check.py --data "$DATASETS_DIR" --out results/pymrio.json
```

`engine.py` runs in the explorer's environment, as `precompute.py` does.
`results/engine.json` comes from
[simonvanlierde/ramascene@d9113ca](https://github.com/simonvanlierde/ramascene/commit/d9113ca9ad38bc29d2a96392dabf74d70abf830e),
the engine behind the explorer's results. A rerun of all three steps from the
locked environment (2026-10-21) gave the same scores to the last digit; only
the timings differ by machine. The committed `lca.json` is from the first run,
`build.json` and `engine.json` from the rerun, `pymrio.json` from its first run.
Moving from bw2data 4.7 to 4.8 (for a patched deepdiff) left every count and
score unchanged. A rerun overwrites them. `lca.py` stops if two routes that
should agree differ by more than 1e-10, and `pymrio_check.py` if pymrio and the
shipped L do.

## Data

The input data is EXIOBASE v3.3.sm by Franco Donati and Arjan de Koning
(Zenodo, version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It is
EXIOBASE v3.3 with materials made by recycling industries shown as separate
products. The `_v4` in the file names is RaMa-Scene's file suffix, not a
dataset version.

This folder does not contain the EXIOBASE arrays or the Brightway project.
The files in `results/` are small numbers derived from EXIOBASE
v3.3.sm and fall under the same CC BY 4.0 attribution.

## Licence

The code in this folder is under the repository's MIT licence. The EXIOBASE data and the
results derived from it are under CC BY 4.0, as described above.
