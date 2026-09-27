# Precompute run log

- Engine: perf/solve-not-invert @ a258e63 (clean tree)
- Generated: 2026-09-27T10:04:04+00:00
- Dataset: EXIOBASE v3.3.sm 2011, doi:10.5281/zenodo.3533196
- Command: `uv run python precompute.py --run --engine ../ramascene-pr2 --data "$DATASETS_DIR" --out data/results.json --out-regions data/regions.json --out-flows data/flows.json`
- Octave reference files: 4 (122 values), passed at relative 1e-6
- Scenarios run: 78, passed every check: 78, failed: 0
- Wall per scenario job (process start to exit): median 10.77 s, max 21.72 s, total 866.45 s over 78 jobs
- Engine time per scenario (apply_model + 3 routes + check): median 10.48 s, max 21.38 s
- Peak RSS per scenario worker: median 1.54 GiB, max 1.55 GiB
- Parent process peak RSS (Octave references, baseline): 0.83 GiB
- 0% control: max relative difference to baseline 1.39e-14 (relative 1e-6)

| scenario | status | wall s | engine s | peak RSS GiB | note |
| --- | --- | --- | --- | --- | --- |
| vehicle-demand-europe | passed | 1.40 | 1.22 | 0.83 |  |
| steel-in-vehicles-europe | passed | 21.72 | 21.38 | 1.54 |  |
| cement-in-construction | passed | 21.60 | 21.35 | 1.55 |  |
| steel-europe-10 | passed | 10.99 | 10.78 | 1.55 |  |
| steel-europe-20 | passed | 10.65 | 10.34 | 1.54 |  |
| steel-europe-50 | passed | 12.44 | 12.24 | 1.54 |  |
| steel-middle-east-10 | passed | 12.56 | 12.38 | 1.54 |  |
| steel-middle-east-20 | passed | 9.30 | 9.01 | 1.54 |  |
| steel-middle-east-50 | passed | 9.13 | 8.90 | 1.54 |  |
| steel-america-10 | passed | 12.19 | 11.94 | 1.55 |  |
| steel-america-20 | passed | 9.98 | 9.67 | 1.54 |  |
| steel-america-50 | passed | 11.29 | 10.88 | 1.54 |  |
| steel-asia-pacific-10 | passed | 11.06 | 10.88 | 1.54 |  |
| steel-asia-pacific-20 | passed | 9.44 | 9.19 | 1.54 |  |
| steel-asia-pacific-50 | passed | 11.49 | 11.28 | 1.55 |  |
| steel-africa-10 | passed | 12.12 | 11.90 | 1.54 |  |
| steel-africa-20 | passed | 11.27 | 11.03 | 1.54 |  |
| steel-africa-50 | passed | 9.57 | 9.32 | 1.54 |  |
| aluminium-europe-10 | passed | 9.47 | 9.17 | 1.54 |  |
| aluminium-europe-20 | passed | 8.97 | 8.66 | 1.54 |  |
| aluminium-europe-50 | passed | 11.74 | 11.48 | 1.54 |  |
| aluminium-middle-east-10 | passed | 9.39 | 8.97 | 1.54 |  |
| aluminium-middle-east-20 | passed | 10.01 | 9.76 | 1.54 |  |
| aluminium-middle-east-50 | passed | 10.75 | 10.50 | 1.54 |  |
| aluminium-america-10 | passed | 9.22 | 8.89 | 1.54 |  |
| aluminium-america-20 | passed | 9.07 | 8.80 | 1.54 |  |
| aluminium-america-50 | passed | 9.79 | 9.47 | 1.54 |  |
| aluminium-asia-pacific-10 | passed | 12.31 | 12.12 | 1.54 |  |
| aluminium-asia-pacific-20 | passed | 9.97 | 9.70 | 1.54 |  |
| aluminium-asia-pacific-50 | passed | 9.02 | 8.74 | 1.55 |  |
| aluminium-africa-10 | passed | 9.39 | 8.93 | 1.54 |  |
| aluminium-africa-20 | passed | 10.78 | 10.47 | 1.54 |  |
| aluminium-africa-50 | passed | 10.33 | 10.12 | 1.54 |  |
| cement-europe-10 | passed | 12.30 | 12.03 | 1.55 |  |
| cement-europe-20 | passed | 14.54 | 14.33 | 1.54 |  |
| cement-europe-50 | passed | 15.68 | 15.47 | 1.55 |  |
| cement-middle-east-10 | passed | 12.91 | 12.69 | 1.54 |  |
| cement-middle-east-20 | passed | 10.82 | 10.56 | 1.54 |  |
| cement-middle-east-50 | passed | 8.98 | 8.62 | 1.54 |  |
| cement-america-10 | passed | 9.93 | 9.47 | 1.54 |  |
| cement-america-20 | passed | 10.29 | 10.01 | 1.54 |  |
| cement-america-50 | passed | 10.69 | 10.36 | 1.54 |  |
| cement-asia-pacific-10 | passed | 10.72 | 10.51 | 1.55 |  |
| cement-asia-pacific-20 | passed | 12.43 | 12.19 | 1.55 |  |
| cement-asia-pacific-50 | passed | 8.93 | 8.76 | 1.54 |  |
| cement-africa-10 | passed | 9.20 | 8.99 | 1.54 |  |
| cement-africa-20 | passed | 10.43 | 10.14 | 1.54 |  |
| cement-africa-50 | passed | 11.20 | 10.88 | 1.54 |  |
| plastics-europe-10 | passed | 12.56 | 12.19 | 1.54 |  |
| plastics-europe-20 | passed | 13.34 | 13.09 | 1.54 |  |
| plastics-europe-50 | passed | 13.24 | 12.81 | 1.54 |  |
| plastics-middle-east-10 | passed | 10.34 | 9.95 | 1.54 |  |
| plastics-middle-east-20 | passed | 13.22 | 12.96 | 1.54 |  |
| plastics-middle-east-50 | passed | 11.20 | 10.88 | 1.54 |  |
| plastics-america-10 | passed | 11.89 | 11.70 | 1.55 |  |
| plastics-america-20 | passed | 11.23 | 11.04 | 1.54 |  |
| plastics-america-50 | passed | 10.79 | 10.47 | 1.54 |  |
| plastics-asia-pacific-10 | passed | 13.02 | 12.73 | 1.54 |  |
| plastics-asia-pacific-20 | passed | 12.41 | 12.18 | 1.54 |  |
| plastics-asia-pacific-50 | passed | 10.18 | 9.98 | 1.55 |  |
| plastics-africa-10 | passed | 10.03 | 9.76 | 1.54 |  |
| plastics-africa-20 | passed | 9.12 | 8.91 | 1.54 |  |
| plastics-africa-50 | passed | 13.84 | 13.55 | 1.54 |  |
| electrical-europe-10 | passed | 11.74 | 11.44 | 1.54 |  |
| electrical-europe-20 | passed | 11.83 | 11.39 | 1.54 |  |
| electrical-europe-50 | passed | 13.78 | 13.26 | 1.55 |  |
| electrical-middle-east-10 | passed | 10.55 | 10.17 | 1.54 |  |
| electrical-middle-east-20 | passed | 10.01 | 9.78 | 1.54 |  |
| electrical-middle-east-50 | passed | 10.01 | 9.79 | 1.54 |  |
| electrical-america-10 | passed | 11.37 | 11.18 | 1.54 |  |
| electrical-america-20 | passed | 12.13 | 11.81 | 1.55 |  |
| electrical-america-50 | passed | 12.16 | 11.76 | 1.54 |  |
| electrical-asia-pacific-10 | passed | 9.88 | 9.61 | 1.54 |  |
| electrical-asia-pacific-20 | passed | 9.52 | 9.19 | 1.54 |  |
| electrical-asia-pacific-50 | passed | 9.15 | 8.95 | 1.54 |  |
| electrical-africa-10 | passed | 9.66 | 9.36 | 1.54 |  |
| electrical-africa-20 | passed | 9.49 | 9.23 | 1.54 |  |
| electrical-africa-50 | passed | 11.26 | 11.05 | 1.54 |  |
| zero_change_control | control | 12.91 | 12.50 | 1.54 |  |
