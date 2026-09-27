# Precompute run log

- Engine: perf/solve-not-invert @ a258e63 (clean tree)
- Generated: 2026-09-27T00:08:26+00:00
- Dataset: EXIOBASE v3.3.sm 2011, doi:10.5281/zenodo.3533196
- Command: `uv run python precompute.py --run --engine ../ramascene-pr2 --data "$DATASETS_DIR" --out /tmp/b2-full/results.json`
- Octave reference files: 4 (122 values), passed at relative 1e-6
- Scenarios run: 78, passed every check: 78, failed: 0
- Wall per scenario job (process start to exit): median 23.45 s, max 39.76 s, total 1925.79 s over 78 jobs
- Engine time per scenario (apply_model + 3 routes + check): median 22.92 s, max 39.46 s
- Peak RSS per scenario worker: median 1.53 GiB, max 1.53 GiB
- Parent process peak RSS (Octave references, baseline): 0.83 GiB
- 0% control: max relative difference to baseline 1.60e-14 (relative 1e-6)

| scenario | status | wall s | engine s | peak RSS GiB | note |
| --- | --- | --- | --- | --- | --- |
| vehicle-demand-europe | passed | 0.50 | 0.28 | 0.83 |  |
| steel-in-vehicles-europe | passed | 31.75 | 31.52 | 1.53 |  |
| cement-in-construction | passed | 34.60 | 34.38 | 1.53 |  |
| steel-europe-10 | passed | 22.43 | 22.18 | 1.53 |  |
| steel-europe-20 | passed | 23.63 | 23.33 | 1.53 |  |
| steel-europe-50 | passed | 32.45 | 32.17 | 1.53 |  |
| steel-middle-east-10 | passed | 39.76 | 39.46 | 1.53 |  |
| steel-middle-east-20 | passed | 38.16 | 37.94 | 1.53 |  |
| steel-middle-east-50 | passed | 38.75 | 38.52 | 1.53 |  |
| steel-america-10 | passed | 37.88 | 37.62 | 1.53 |  |
| steel-america-20 | passed | 27.90 | 27.50 | 1.53 |  |
| steel-america-50 | passed | 24.91 | 24.66 | 1.53 |  |
| steel-asia-pacific-10 | passed | 32.34 | 32.13 | 1.53 |  |
| steel-asia-pacific-20 | passed | 26.08 | 25.90 | 1.53 |  |
| steel-asia-pacific-50 | passed | 25.84 | 25.63 | 1.53 |  |
| steel-africa-10 | passed | 32.99 | 32.74 | 1.53 |  |
| steel-africa-20 | passed | 27.10 | 26.90 | 1.53 |  |
| steel-africa-50 | passed | 38.17 | 37.95 | 1.53 |  |
| aluminium-europe-10 | passed | 39.57 | 39.33 | 1.53 |  |
| aluminium-europe-20 | passed | 39.40 | 39.18 | 1.53 |  |
| aluminium-europe-50 | passed | 38.31 | 38.07 | 1.53 |  |
| aluminium-middle-east-10 | passed | 39.00 | 38.77 | 1.53 |  |
| aluminium-middle-east-20 | passed | 22.02 | 21.85 | 1.53 |  |
| aluminium-middle-east-50 | passed | 26.49 | 26.32 | 1.53 |  |
| aluminium-america-10 | passed | 30.03 | 29.76 | 1.53 |  |
| aluminium-america-20 | passed | 23.80 | 22.63 | 1.53 |  |
| aluminium-america-50 | passed | 21.72 | 21.45 | 1.53 |  |
| aluminium-asia-pacific-10 | passed | 27.04 | 26.20 | 1.53 |  |
| aluminium-asia-pacific-20 | passed | 23.53 | 23.16 | 1.53 |  |
| aluminium-asia-pacific-50 | passed | 16.30 | 16.10 | 1.53 |  |
| aluminium-africa-10 | passed | 15.69 | 15.52 | 1.53 |  |
| aluminium-africa-20 | passed | 14.99 | 14.83 | 1.53 |  |
| aluminium-africa-50 | passed | 14.76 | 14.61 | 1.53 |  |
| cement-europe-10 | passed | 14.74 | 14.59 | 1.53 |  |
| cement-europe-20 | passed | 22.83 | 22.67 | 1.53 |  |
| cement-europe-50 | passed | 30.75 | 30.55 | 1.53 |  |
| cement-middle-east-10 | passed | 24.42 | 24.22 | 1.53 |  |
| cement-middle-east-20 | passed | 36.12 | 35.93 | 1.53 |  |
| cement-middle-east-50 | passed | 32.97 | 32.77 | 1.53 |  |
| cement-america-10 | passed | 38.49 | 38.28 | 1.53 |  |
| cement-america-20 | passed | 39.07 | 38.82 | 1.53 |  |
| cement-america-50 | passed | 38.78 | 38.57 | 1.53 |  |
| cement-asia-pacific-10 | passed | 29.07 | 28.76 | 1.53 |  |
| cement-asia-pacific-20 | passed | 30.61 | 30.39 | 1.53 |  |
| cement-asia-pacific-50 | passed | 22.60 | 22.36 | 1.53 |  |
| cement-africa-10 | passed | 17.70 | 17.45 | 1.53 |  |
| cement-africa-20 | passed | 19.17 | 19.01 | 1.53 |  |
| cement-africa-50 | passed | 23.36 | 23.16 | 1.53 |  |
| plastics-europe-10 | passed | 15.42 | 15.21 | 1.53 |  |
| plastics-europe-20 | passed | 19.44 | 19.26 | 1.53 |  |
| plastics-europe-50 | passed | 17.49 | 17.29 | 1.53 |  |
| plastics-middle-east-10 | passed | 17.04 | 16.88 | 1.53 |  |
| plastics-middle-east-20 | passed | 22.72 | 22.55 | 1.53 |  |
| plastics-middle-east-50 | passed | 18.33 | 18.14 | 1.53 |  |
| plastics-america-10 | passed | 18.82 | 18.65 | 1.53 |  |
| plastics-america-20 | passed | 29.35 | 29.15 | 1.53 |  |
| plastics-america-50 | passed | 30.75 | 30.46 | 1.53 |  |
| plastics-asia-pacific-10 | passed | 15.00 | 14.84 | 1.53 |  |
| plastics-asia-pacific-20 | passed | 16.99 | 16.84 | 1.53 |  |
| plastics-asia-pacific-50 | passed | 14.85 | 14.67 | 1.53 |  |
| plastics-africa-10 | passed | 17.26 | 17.04 | 1.53 |  |
| plastics-africa-20 | passed | 16.62 | 16.45 | 1.53 |  |
| plastics-africa-50 | passed | 15.36 | 15.21 | 1.53 |  |
| electrical-europe-10 | passed | 17.08 | 16.92 | 1.53 |  |
| electrical-europe-20 | passed | 15.03 | 14.88 | 1.53 |  |
| electrical-europe-50 | passed | 16.82 | 16.62 | 1.53 |  |
| electrical-middle-east-10 | passed | 15.01 | 14.85 | 1.53 |  |
| electrical-middle-east-20 | passed | 16.59 | 16.42 | 1.53 |  |
| electrical-middle-east-50 | passed | 14.79 | 14.63 | 1.53 |  |
| electrical-america-10 | passed | 27.90 | 27.74 | 1.53 |  |
| electrical-america-20 | passed | 33.24 | 33.00 | 1.53 |  |
| electrical-america-50 | passed | 38.48 | 38.26 | 1.53 |  |
| electrical-asia-pacific-10 | passed | 14.96 | 14.80 | 1.53 |  |
| electrical-asia-pacific-20 | passed | 16.61 | 16.43 | 1.53 |  |
| electrical-asia-pacific-50 | passed | 14.68 | 14.52 | 1.53 |  |
| electrical-africa-10 | passed | 17.26 | 17.10 | 1.53 |  |
| electrical-africa-20 | passed | 16.90 | 16.72 | 1.53 |  |
| electrical-africa-50 | passed | 16.47 | 16.18 | 1.53 |  |
| zero_change_control | control | 14.99 | 14.83 | 1.53 |  |
