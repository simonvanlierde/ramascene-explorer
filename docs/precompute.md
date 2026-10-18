# Regenerate the data

You need a RaMa-Scene checkout and the matrices of **EXIOBASE v3.3.sm** (Franco
Donati and Arjan de Koning, Zenodo version V1, 2019-11-08,
[doi:10.5281/zenodo.3533196](https://doi.org/10.5281/zenodo.3533196)): the
monetary product-by-product EXIOBASE v3.3 with materials produced by
secondary technologies (recycling industries) represented explicitly. The
engine reads them as `$DATASETS_DIR/2011/{A,L,Y,B}_v4.npy`. The Zenodo record
ships only `_v4` files, and `v4` is the file suffix, not the dataset version.
The matrices are float64.

```sh
# the command data/results.json records, verbatim
uv run python precompute.py --run --engine "$ENGINE_DIR" --engine-pr https://github.com/CMLPlatform/ramascene/pull/74 --data "$DATASETS_DIR" --out data/results.json --out-regions data/regions.json --out-flows data/flows.json --out-embodied data/embodied.parquet
# subsets: --scenarios original|grid, --limit N
```

## The shipped run

I produced the shipped files with branch `split/3-performance` of the fork
<https://github.com/simonvanlierde/ramascene>, commit
`d9113ca9ad38bc29d2a96392dabf74d70abf830e` (clean tree), the head of pull
request [#74](https://github.com/CMLPlatform/ramascene/pull/74), which is
stacked on #73 (the Django 5.2 upgrade). `data/run-log.md` logs that run, and
`data/precompute-time.txt` holds its `/usr/bin/time -v` output: 153 scenarios
with the embodied flows, 1 min 32 s wall, 1,602,340 KiB (1.64 GB, 1.53 GiB)
maximum RSS, under `nice -n 10` with BLAS capped at 8 threads on a 32-core
machine. The same run without `--out-embodied` took 1 min 16 s and left every
value in the three JSON files exactly as it was (`compare_data.py`, largest
relative difference 0).

Each file's `provenance` block records the engine commit, the dataset
checksums, the command and the run time. The blocks are identical, and the
Parquet footer carries the same one. It
also records the engine repository, branch and commit (`provenance.engine`,
with `label` such as `split/3-performance @ d9113ca`, and `pull_request` when
`--engine-pr` is given).

`--engine` must be the top of a git checkout with a commit. The script refuses
anything else, so no output can claim `exiobase-v3` without naming its engine.
If the checkout's commit or dirty state changes during the run, the script
writes nothing.

## Solver

`precompute.py` calls `Modelling` as `tasks.execute_calc` does and passes no
solver, so the engine picks one:

- When at most 2,000 rows of `A` change and the result passes the engine's
  residual check (`‖x − A x − y‖ ≤ 1e-9 ‖y‖` for `y = 1`), `Modelling` returns
  a `LowRankLeontief`: a Woodbury update of the stored `L`, with no
  factorization.
- Otherwise it returns a `LeontiefSolve`, which factorizes `(I − A)` once and
  solves from those factors.

Each run records the class of the `L` the engine returned (`runs.<id>.solver`),
and `provenance.run.solvers` counts them. In the shipped run, all 152
technical-coefficient scenarios and the control took the Woodbury update, and
the final-demand scenario used the stored `L`. No run factorized `(I − A)`.

## Memory

`--run` is required because each technical-coefficient scenario works on a
dense 9800 × 9800 matrix. In the shipped run that took about 1.65 GB
(1.54 GiB) at peak per worker. The engine memory-maps `L` and maps `A`
copy-on-write, so much of that peak is file pages that the workers share
through the page cache, which each worker's RSS still counts. Each scenario
runs in a fresh worker process (`precompute.py --worker`, one at a time). Its
wall time and peak RSS (`ru_maxrss`) are that process's own.

## Checks

Before any solve, the script checks that the engine reproduces the four Octave
reference files shipped with RaMa-Scene (routes two and four; value added and
GHG). It stops if it does not. It then runs the baseline, each scenario, and a
0% control through the modified-A path. With the PR #74 engine the control is a
Woodbury update with a zero change. That returns the stored `L` exactly, so the
control does not exercise the factorization path.

A failure at run level writes nothing. That covers a failed Octave check, a
baseline that does not match the independent calculation, a leaky control (one
that does not reproduce the baseline), or no scenario left. Every scenario is
held to:

- every value is finite;
- each region's value matches `B_i ∘ (L · ΣY)` recomputed outside the engine
  and summed over that region's countries (relative 1e-9);
- the control reproduces the baseline (relative 1e-9);
- every intervention moves at least one indicator total by more than
  relative 1e-9, and no cut raises an indicator total. The rise check applies
  only to indicators whose `B` row and `ΣY` have no negative entries. For other
  indicators the script skips it with a warning and records that.

A scenario that fails is recorded under `failed` with its reason. It is not in
`results` or on the page, but it is never dropped silently. Output that passes
is marked `data_kind: exiobase-v3`. Beside the JSON, the script writes
`data/run-log.md`: engine, date, Octave reference count, per-scenario wall
time, peak RSS and check outcome.

## Compare two runs

`uv run python compare_data.py OLD_DATA_DIR NEW_DATA_DIR` compares two runs
value by value (every number in the three files, except provenance, run
timings and check residuals; relative 1e-12 by default).

Against an earlier run with engine `perf/lu-reuse-solve-order @ f876faa`
(2026-09-27, unpublished), the largest relative difference is 3.4e-14 in
`results.json` and 4.1e-13 in `regions.json`. In `flows.json` it is 3.1e-10, on
the change in a flow, which is a difference of two nearly equal values. 120 of
its 638 values differ by more than 1e-12, and none by more than 1e-9.

## Embodied flows

At 51.5 MB it stays out of git. It is the `embodied.parquet` asset of the
[`data-2011`](https://github.com/simonvanlierde/ramascene-explorer/releases/tag/data-2011)
release, and the Pages build downloads it from there and checks its SHA-256.
To get it locally:

```sh
gh release download data-2011 --pattern embodied.parquet --dir data
```

`data/embodied.parquet` (`--out-embodied`) holds, for the baseline and every
published scenario, the flows embodied in final demand: what each producer
country releases, per section, for the final demand of each consumer country.
A flow is `B_i ∘ (L · Y)` summed over the products of one section, with one
column of `Y` per consumer country. Sections are the 15 level-2 product
aggregates of the engine database. Each scenario's flows come
from its own `Y` and `L`, in the same worker as its other results.

The file is long format, one row group per run: `run`, `indicator` (global
id), `producer`, `section`, `consumer` (0-based, in engine order) and `value`.
The baseline row group holds absolute values. Every other row group holds the
change, scenario minus baseline. A cell that is exactly 0 is left out, so a
missing row means no flow or no change. The values are float32 with
byte-stream-split encoding and snappy compression, so a browser can read the
footer and one run over HTTP range requests (about 0.33 MB per run, of 51.5
MB). The footer's `ramascene` key holds JSON: country and section names, the
continental aggregates, units, the run ids in row-group order, the checks and
the same provenance as the other files.

Nothing is written unless:

- for every run, the flows summed by producer and continental aggregate match
  that run's values in `results.json`, and the world totals match (relative
  1e-9);
- for the baseline and the three original interventions, the flows summed by
  producer country match the engine's 49-region values (relative 1e-9);
- the float32 values sum to within relative 1e-6 of the float64 ones, per
  producer and in total, relative to the run's total or total change. The
  page shows three significant digits.

Cells that rise in a scenario are counted and recorded, not refused. In the
shipped run none rose, the largest difference in the first two checks was
9.2e-16, and the float32 error was 2.6e-8.

## Detail sidecars

`data/regions.json` (`--out-regions`, the 49-region values of the baseline and
the three original interventions) and `data/flows.json` (`--out-flows`, each
original intervention's change by sector and region, 15 × 49 cells) are still
written and checked by the precompute: the regions match B·L·ΣY (relative
1e-9), the sectors sum to each region and the flows to the total (relative
1e-12). The page no longer reads them: the embodied flows hold the same
breakdowns for every run and are checked against them.
