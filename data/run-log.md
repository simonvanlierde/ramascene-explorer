# Precompute run log

- Engine: split/3-performance @ d9113ca (clean tree), https://github.com/CMLPlatform/ramascene/pull/74
- Generated: 2026-10-13T23:06:47+00:00
- Dataset: EXIOBASE v3.3.sm 2011, doi:10.5281/zenodo.3533196
- Command: `uv run python precompute.py --run --engine "$ENGINE_DIR" --engine-pr https://github.com/CMLPlatform/ramascene/pull/74 --data "$DATASETS_DIR" --out data/results.json --out-regions data/regions.json --out-flows data/flows.json --out-embodied data/embodied.parquet`
- Octave reference files: 4 (122 values), passed at relative 1e-6
- Scenarios run: 153, passed every check: 153, failed: 0
- L per scenario: memmap (1), LowRankLeontief (152)
- Wall per scenario job (process start to exit): median 0.51 s, max 1.65 s, total 82.27 s over 153 jobs
- Engine time per scenario (apply_model + 3 routes + check): median 0.30 s, max 1.37 s
- Peak RSS per scenario worker: median 1.52 GiB, max 1.53 GiB
- Parent process peak RSS (Octave references, baseline): 0.82 GiB
- 0% control: max relative difference to baseline 0.00e+00 (relative 1e-9)

| scenario | status | wall s | engine s | peak RSS GiB | L | note |
| --- | --- | --- | --- | --- | --- | --- |
| vehicle-demand-europe | passed | 1.40 | 1.19 | 0.83 | memmap |  |
| steel-in-vehicles-europe | passed | 1.49 | 1.28 | 1.52 | LowRankLeontief |  |
| cement-in-construction | passed | 1.65 | 1.37 | 1.52 | LowRankLeontief |  |
| steel-europe-10 | passed | 0.50 | 0.30 | 1.53 | LowRankLeontief |  |
| steel-europe-20 | passed | 0.50 | 0.30 | 1.53 | LowRankLeontief |  |
| steel-europe-50 | passed | 0.50 | 0.30 | 1.53 | LowRankLeontief |  |
| steel-middle-east-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| steel-middle-east-20 | passed | 0.48 | 0.28 | 1.52 | LowRankLeontief |  |
| steel-middle-east-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| steel-america-10 | passed | 0.48 | 0.29 | 1.52 | LowRankLeontief |  |
| steel-america-20 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| steel-america-50 | passed | 0.53 | 0.31 | 1.52 | LowRankLeontief |  |
| steel-asia-pacific-10 | passed | 0.54 | 0.30 | 1.52 | LowRankLeontief |  |
| steel-asia-pacific-20 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| steel-asia-pacific-50 | passed | 0.49 | 0.30 | 1.52 | LowRankLeontief |  |
| steel-africa-10 | passed | 0.48 | 0.28 | 1.52 | LowRankLeontief |  |
| steel-africa-20 | passed | 0.49 | 0.28 | 1.52 | LowRankLeontief |  |
| steel-africa-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| aluminium-europe-10 | passed | 0.55 | 0.34 | 1.53 | LowRankLeontief |  |
| aluminium-europe-20 | passed | 0.50 | 0.30 | 1.53 | LowRankLeontief |  |
| aluminium-europe-50 | passed | 0.52 | 0.31 | 1.53 | LowRankLeontief |  |
| aluminium-middle-east-10 | passed | 0.53 | 0.32 | 1.52 | LowRankLeontief |  |
| aluminium-middle-east-20 | passed | 0.46 | 0.28 | 1.52 | LowRankLeontief |  |
| aluminium-middle-east-50 | passed | 0.48 | 0.28 | 1.52 | LowRankLeontief |  |
| aluminium-america-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| aluminium-america-20 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| aluminium-america-50 | passed | 0.49 | 0.28 | 1.52 | LowRankLeontief |  |
| aluminium-asia-pacific-10 | passed | 0.49 | 0.28 | 1.52 | LowRankLeontief |  |
| aluminium-asia-pacific-20 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| aluminium-asia-pacific-50 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| aluminium-africa-10 | passed | 0.56 | 0.32 | 1.52 | LowRankLeontief |  |
| aluminium-africa-20 | passed | 0.56 | 0.29 | 1.52 | LowRankLeontief |  |
| aluminium-africa-50 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| cement-europe-10 | passed | 0.55 | 0.34 | 1.53 | LowRankLeontief |  |
| cement-europe-20 | passed | 0.56 | 0.34 | 1.53 | LowRankLeontief |  |
| cement-europe-50 | passed | 0.56 | 0.30 | 1.53 | LowRankLeontief |  |
| cement-middle-east-10 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| cement-middle-east-20 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| cement-middle-east-50 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| cement-america-10 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| cement-america-20 | passed | 0.52 | 0.31 | 1.52 | LowRankLeontief |  |
| cement-america-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| cement-asia-pacific-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| cement-asia-pacific-20 | passed | 0.51 | 0.31 | 1.52 | LowRankLeontief |  |
| cement-asia-pacific-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| cement-africa-10 | passed | 0.48 | 0.29 | 1.52 | LowRankLeontief |  |
| cement-africa-20 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| cement-africa-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-europe-10 | passed | 0.55 | 0.33 | 1.53 | LowRankLeontief |  |
| plastics-europe-20 | passed | 0.56 | 0.34 | 1.53 | LowRankLeontief |  |
| plastics-europe-50 | passed | 0.51 | 0.31 | 1.53 | LowRankLeontief |  |
| plastics-middle-east-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-middle-east-20 | passed | 0.52 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-middle-east-50 | passed | 0.48 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-america-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-america-20 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| plastics-america-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-asia-pacific-10 | passed | 0.53 | 0.32 | 1.52 | LowRankLeontief |  |
| plastics-asia-pacific-20 | passed | 0.57 | 0.36 | 1.52 | LowRankLeontief |  |
| plastics-asia-pacific-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-africa-10 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| plastics-africa-20 | passed | 0.49 | 0.28 | 1.52 | LowRankLeontief |  |
| plastics-africa-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| electrical-europe-10 | passed | 0.52 | 0.31 | 1.53 | LowRankLeontief |  |
| electrical-europe-20 | passed | 0.52 | 0.31 | 1.53 | LowRankLeontief |  |
| electrical-europe-50 | passed | 0.52 | 0.31 | 1.53 | LowRankLeontief |  |
| electrical-middle-east-10 | passed | 0.60 | 0.35 | 1.52 | LowRankLeontief |  |
| electrical-middle-east-20 | passed | 0.60 | 0.32 | 1.52 | LowRankLeontief |  |
| electrical-middle-east-50 | passed | 0.51 | 0.31 | 1.52 | LowRankLeontief |  |
| electrical-america-10 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| electrical-america-20 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| electrical-america-50 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| electrical-asia-pacific-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| electrical-asia-pacific-20 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| electrical-asia-pacific-50 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| electrical-africa-10 | passed | 0.55 | 0.32 | 1.52 | LowRankLeontief |  |
| electrical-africa-20 | passed | 0.58 | 0.32 | 1.52 | LowRankLeontief |  |
| electrical-africa-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-europe-10 | passed | 0.53 | 0.31 | 1.53 | LowRankLeontief |  |
| copper-europe-20 | passed | 0.53 | 0.31 | 1.53 | LowRankLeontief |  |
| copper-europe-50 | passed | 0.54 | 0.35 | 1.53 | LowRankLeontief |  |
| copper-middle-east-10 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-middle-east-20 | passed | 0.50 | 0.28 | 1.52 | LowRankLeontief |  |
| copper-middle-east-50 | passed | 0.52 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-america-10 | passed | 0.56 | 0.34 | 1.52 | LowRankLeontief |  |
| copper-america-20 | passed | 0.61 | 0.35 | 1.52 | LowRankLeontief |  |
| copper-america-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-asia-pacific-10 | passed | 0.48 | 0.30 | 1.52 | LowRankLeontief |  |
| copper-asia-pacific-20 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-asia-pacific-50 | passed | 0.51 | 0.31 | 1.52 | LowRankLeontief |  |
| copper-africa-10 | passed | 0.49 | 0.30 | 1.52 | LowRankLeontief |  |
| copper-africa-20 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| copper-africa-50 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| glass-europe-10 | passed | 0.54 | 0.33 | 1.53 | LowRankLeontief |  |
| glass-europe-20 | passed | 0.55 | 0.33 | 1.53 | LowRankLeontief |  |
| glass-europe-50 | passed | 0.58 | 0.31 | 1.53 | LowRankLeontief |  |
| glass-middle-east-10 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| glass-middle-east-20 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| glass-middle-east-50 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| glass-america-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| glass-america-20 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| glass-america-50 | passed | 0.53 | 0.30 | 1.52 | LowRankLeontief |  |
| glass-asia-pacific-10 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| glass-asia-pacific-20 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| glass-asia-pacific-50 | passed | 0.54 | 0.31 | 1.52 | LowRankLeontief |  |
| glass-africa-10 | passed | 0.55 | 0.31 | 1.52 | LowRankLeontief |  |
| glass-africa-20 | passed | 0.56 | 0.29 | 1.52 | LowRankLeontief |  |
| glass-africa-50 | passed | 0.50 | 0.28 | 1.52 | LowRankLeontief |  |
| fertiliser-europe-10 | passed | 0.53 | 0.32 | 1.53 | LowRankLeontief |  |
| fertiliser-europe-20 | passed | 0.51 | 0.31 | 1.53 | LowRankLeontief |  |
| fertiliser-europe-50 | passed | 0.53 | 0.31 | 1.53 | LowRankLeontief |  |
| fertiliser-middle-east-10 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| fertiliser-middle-east-20 | passed | 0.52 | 0.31 | 1.52 | LowRankLeontief |  |
| fertiliser-middle-east-50 | passed | 0.55 | 0.32 | 1.52 | LowRankLeontief |  |
| fertiliser-america-10 | passed | 0.56 | 0.32 | 1.52 | LowRankLeontief |  |
| fertiliser-america-20 | passed | 0.55 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-america-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-asia-pacific-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-asia-pacific-20 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-asia-pacific-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-africa-10 | passed | 0.51 | 0.30 | 1.52 | LowRankLeontief |  |
| fertiliser-africa-20 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| fertiliser-africa-50 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| chemicals-europe-10 | passed | 0.56 | 0.33 | 1.53 | LowRankLeontief |  |
| chemicals-europe-20 | passed | 0.63 | 0.40 | 1.53 | LowRankLeontief |  |
| chemicals-europe-50 | passed | 0.51 | 0.31 | 1.53 | LowRankLeontief |  |
| chemicals-middle-east-10 | passed | 0.52 | 0.31 | 1.52 | LowRankLeontief |  |
| chemicals-middle-east-20 | passed | 0.53 | 0.31 | 1.52 | LowRankLeontief |  |
| chemicals-middle-east-50 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| chemicals-america-10 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| chemicals-america-20 | passed | 0.51 | 0.31 | 1.52 | LowRankLeontief |  |
| chemicals-america-50 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| chemicals-asia-pacific-10 | passed | 0.55 | 0.32 | 1.52 | LowRankLeontief |  |
| chemicals-asia-pacific-20 | passed | 0.56 | 0.35 | 1.52 | LowRankLeontief |  |
| chemicals-asia-pacific-50 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| chemicals-africa-10 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| chemicals-africa-20 | passed | 0.51 | 0.29 | 1.52 | LowRankLeontief |  |
| chemicals-africa-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| rubber-europe-10 | passed | 0.52 | 0.31 | 1.53 | LowRankLeontief |  |
| rubber-europe-20 | passed | 0.51 | 0.30 | 1.53 | LowRankLeontief |  |
| rubber-europe-50 | passed | 0.52 | 0.30 | 1.53 | LowRankLeontief |  |
| rubber-middle-east-10 | passed | 0.56 | 0.34 | 1.52 | LowRankLeontief |  |
| rubber-middle-east-20 | passed | 0.58 | 0.37 | 1.52 | LowRankLeontief |  |
| rubber-middle-east-50 | passed | 0.70 | 0.43 | 1.52 | LowRankLeontief |  |
| rubber-america-10 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| rubber-america-20 | passed | 0.49 | 0.30 | 1.52 | LowRankLeontief |  |
| rubber-america-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| rubber-asia-pacific-10 | passed | 0.52 | 0.30 | 1.52 | LowRankLeontief |  |
| rubber-asia-pacific-20 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| rubber-asia-pacific-50 | passed | 0.50 | 0.29 | 1.52 | LowRankLeontief |  |
| rubber-africa-10 | passed | 0.50 | 0.30 | 1.52 | LowRankLeontief |  |
| rubber-africa-20 | passed | 0.53 | 0.31 | 1.52 | LowRankLeontief |  |
| rubber-africa-50 | passed | 0.49 | 0.29 | 1.52 | LowRankLeontief |  |
| zero_change_control | control | 1.45 | 1.24 | 1.52 | LowRankLeontief |  |
