# Precompute run log

- Engine: perf/lu-reuse-solve-order @ f876faa (clean tree), solver LeontiefLU
- Generated: 2026-09-27T16:48:15+00:00
- Dataset: EXIOBASE v3.3.sm 2011, doi:10.5281/zenodo.3533196
- Command: `uv run python precompute.py --run --engine ../ramascene-c-lu-grid --data "$DATASETS_DIR" --out data/results.json --out-regions data/regions.json --out-flows data/flows.json`
- Octave reference files: 4 (122 values), passed at relative 1e-6
- Scenarios run: 78, passed every check: 78, failed: 0
- Wall per scenario job (process start to exit): median 2.05 s, max 4.59 s, total 185.78 s over 78 jobs
- Engine time per scenario (apply_model + 3 routes + check): median 1.76 s, max 4.29 s
- Peak RSS per scenario worker: median 0.90 GiB, max 0.90 GiB
- Parent process peak RSS (Octave references, baseline): 0.83 GiB
- 0% control: max relative difference to baseline 1.39e-14 (relative 1e-6)

| scenario | status | wall s | engine s | peak RSS GiB | note |
| --- | --- | --- | --- | --- | --- |
| vehicle-demand-europe | passed | 1.34 | 1.17 | 0.83 |  |
| steel-in-vehicles-europe | passed | 3.07 | 2.76 | 0.90 |  |
| cement-in-construction | passed | 3.55 | 3.10 | 0.90 |  |
| steel-europe-10 | passed | 1.90 | 1.64 | 0.90 |  |
| steel-europe-20 | passed | 2.10 | 1.79 | 0.90 |  |
| steel-europe-50 | passed | 2.86 | 2.58 | 0.90 |  |
| steel-middle-east-10 | passed | 2.01 | 1.77 | 0.90 |  |
| steel-middle-east-20 | passed | 2.17 | 1.81 | 0.90 |  |
| steel-middle-east-50 | passed | 3.81 | 3.35 | 0.90 |  |
| steel-america-10 | passed | 2.42 | 2.02 | 0.90 |  |
| steel-america-20 | passed | 4.59 | 4.29 | 0.90 |  |
| steel-america-50 | passed | 1.92 | 1.73 | 0.90 |  |
| steel-asia-pacific-10 | passed | 1.99 | 1.77 | 0.90 |  |
| steel-asia-pacific-20 | passed | 2.53 | 2.26 | 0.90 |  |
| steel-asia-pacific-50 | passed | 2.02 | 1.75 | 0.90 |  |
| steel-africa-10 | passed | 2.27 | 2.09 | 0.90 |  |
| steel-africa-20 | passed | 2.04 | 1.70 | 0.90 |  |
| steel-africa-50 | passed | 3.17 | 2.85 | 0.90 |  |
| aluminium-europe-10 | passed | 1.93 | 1.73 | 0.90 |  |
| aluminium-europe-20 | passed | 1.81 | 1.61 | 0.90 |  |
| aluminium-europe-50 | passed | 2.04 | 1.75 | 0.90 |  |
| aluminium-middle-east-10 | passed | 2.00 | 1.66 | 0.90 |  |
| aluminium-middle-east-20 | passed | 1.88 | 1.66 | 0.90 |  |
| aluminium-middle-east-50 | passed | 3.50 | 3.20 | 0.90 |  |
| aluminium-america-10 | passed | 3.74 | 3.56 | 0.90 |  |
| aluminium-america-20 | passed | 1.93 | 1.62 | 0.90 |  |
| aluminium-america-50 | passed | 1.94 | 1.62 | 0.90 |  |
| aluminium-asia-pacific-10 | passed | 2.00 | 1.72 | 0.90 |  |
| aluminium-asia-pacific-20 | passed | 3.47 | 3.15 | 0.90 |  |
| aluminium-asia-pacific-50 | passed | 3.59 | 3.33 | 0.90 |  |
| aluminium-africa-10 | passed | 1.91 | 1.73 | 0.90 |  |
| aluminium-africa-20 | passed | 2.15 | 1.69 | 0.90 |  |
| aluminium-africa-50 | passed | 4.06 | 3.71 | 0.90 |  |
| cement-europe-10 | passed | 2.67 | 2.34 | 0.90 |  |
| cement-europe-20 | passed | 2.94 | 2.44 | 0.90 |  |
| cement-europe-50 | passed | 2.98 | 2.75 | 0.90 |  |
| cement-middle-east-10 | passed | 2.05 | 1.64 | 0.90 |  |
| cement-middle-east-20 | passed | 2.06 | 1.73 | 0.90 |  |
| cement-middle-east-50 | passed | 2.02 | 1.70 | 0.90 |  |
| cement-america-10 | passed | 1.96 | 1.61 | 0.90 |  |
| cement-america-20 | passed | 2.03 | 1.65 | 0.90 |  |
| cement-america-50 | passed | 2.13 | 1.83 | 0.90 |  |
| cement-asia-pacific-10 | passed | 2.86 | 2.63 | 0.90 |  |
| cement-asia-pacific-20 | passed | 2.01 | 1.67 | 0.90 |  |
| cement-asia-pacific-50 | passed | 2.03 | 1.72 | 0.90 |  |
| cement-africa-10 | passed | 2.02 | 1.82 | 0.90 |  |
| cement-africa-20 | passed | 2.92 | 2.48 | 0.90 |  |
| cement-africa-50 | passed | 2.36 | 2.06 | 0.90 |  |
| plastics-europe-10 | passed | 1.79 | 1.61 | 0.90 |  |
| plastics-europe-20 | passed | 2.29 | 1.91 | 0.90 |  |
| plastics-europe-50 | passed | 1.98 | 1.68 | 0.90 |  |
| plastics-middle-east-10 | passed | 1.93 | 1.61 | 0.90 |  |
| plastics-middle-east-20 | passed | 2.12 | 1.81 | 0.90 |  |
| plastics-middle-east-50 | passed | 2.27 | 1.85 | 0.90 |  |
| plastics-america-10 | passed | 1.94 | 1.69 | 0.90 |  |
| plastics-america-20 | passed | 1.97 | 1.69 | 0.90 |  |
| plastics-america-50 | passed | 2.02 | 1.81 | 0.90 |  |
| plastics-asia-pacific-10 | passed | 2.08 | 1.73 | 0.90 |  |
| plastics-asia-pacific-20 | passed | 1.93 | 1.62 | 0.90 |  |
| plastics-asia-pacific-50 | passed | 1.97 | 1.69 | 0.90 |  |
| plastics-africa-10 | passed | 1.99 | 1.67 | 0.90 |  |
| plastics-africa-20 | passed | 1.92 | 1.74 | 0.90 |  |
| plastics-africa-50 | passed | 2.13 | 1.69 | 0.90 |  |
| electrical-europe-10 | passed | 2.92 | 2.62 | 0.90 |  |
| electrical-europe-20 | passed | 3.06 | 2.61 | 0.90 |  |
| electrical-europe-50 | passed | 3.31 | 3.04 | 0.90 |  |
| electrical-middle-east-10 | passed | 2.32 | 1.87 | 0.90 |  |
| electrical-middle-east-20 | passed | 1.91 | 1.62 | 0.90 |  |
| electrical-middle-east-50 | passed | 2.04 | 1.79 | 0.90 |  |
| electrical-america-10 | passed | 1.87 | 1.70 | 0.90 |  |
| electrical-america-20 | passed | 2.01 | 1.71 | 0.90 |  |
| electrical-america-50 | passed | 3.12 | 2.77 | 0.90 |  |
| electrical-asia-pacific-10 | passed | 2.23 | 1.73 | 0.90 |  |
| electrical-asia-pacific-20 | passed | 2.47 | 2.29 | 0.90 |  |
| electrical-asia-pacific-50 | passed | 2.03 | 1.73 | 0.90 |  |
| electrical-africa-10 | passed | 2.62 | 2.19 | 0.90 |  |
| electrical-africa-20 | passed | 1.97 | 1.74 | 0.90 |  |
| electrical-africa-50 | passed | 2.78 | 2.39 | 0.90 |  |
| zero_change_control | control | 3.10 | 2.87 | 0.90 |  |
