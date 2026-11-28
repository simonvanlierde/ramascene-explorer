# Browser engine measurements

The recorded timings behind the design choices in [browser-engine.md](browser-engine.md).
They are diagnostics from one desktop: use them to locate costs, not to promise phone or
network performance. Each JSON file in `measurements/` holds every sample.

## Node benchmark

[Measure a change](browser-engine.md#measure-a-change) describes the script and its method.
The [recorded diagnostics](measurements/browser-engine-wasm.json) used Node
26.9.0 on an i9-14900KF, pinned to CPUs 30–31 on a shared machine, on
2026-11-01. Medians of the first calculation, against the
[JavaScript kernel's](measurements/browser-engine-zarr.json) from the same day:

| Case | Rows × columns | Read | JavaScript | WebAssembly |
| --- | ---: | ---: | ---: | ---: |
| one product in one country | 1 × 1 | 0.09 MB | 12 ms | 10 ms |
| default steel scenario | 49 × 32 | 4.33 MB | 116 ms | 61 ms |
| default, 150 ms per read | 49 × 32 | 4.33 MB | 847 ms | 356 ms |
| steel used by every European industry | 49 × 6,400 | 5.02 MB | 207 ms | 102 ms |
| electricity used by manufacturing, everywhere | 1,078 × 4,165 | 43.2 MB | 2.31 s | 880 ms |
| manufacturing used by electricity, everywhere | 4,165 × 1,078 | 135 MB | 9.97 s | 2.14 s |
| China's whole final demand | 9,800 final-demand rows | 65.0 MB | 1.99 s | 753 ms |

The WebAssembly column also gains from 64 parallel ranges per array and the
faster chunk check, which the JavaScript record predates. Peak memory of the
largest case rose from 484 MB to 523 MB, because the kernel holds its own copies
of ΔA and L[K, R].

The [earlier row layout's diagnostics](measurements/browser-engine-rows.json)
used a paired method, so compare them with care.

## Kernel and decoder

All on manufacturing used by electricity:

- faer has no wasm SIMD path, so building it with SIMD measured no faster. The kernel's own
  SIMD products took the case from 2.59 s to 2.14 s.
- flate2's zlib-rs backend decodes about 306 MB/s of output, against about 150 MB/s for
  gunzip in JavaScript. That took the case from 3.52 s to 2.60 s.

## Python reader

One-off measurements, with no script in the repository to repeat them. On 26 November 2026 the
correction and fold in `pipeline/numpy_engine.py` matched the WebAssembly engine to 1.6e-15
elementwise on all 156 runs, and a hand-written chunk reader decoded in 0.9 times the WebAssembly
decode time on the three large workloads. On 27 November, reading through zarr-python instead
made the first calculation 1.9 to 2.6 times as slow as that hand-written reader on the same host
(median of 7 fresh processes, same output). The extra time is zarr's per-chunk overhead, not the
maths, so a Rust wheel would mostly buy back the reader.

## Reading H batches during the fold

The worker reads H in batches of 256 rows and folds each before it reads the next;
only the first batch loads beside the other matrices. Reading batch i+1 while
batch i folds was measured with `--network` on a 24-core Linux desktop, pinned to
two CPUs, on 2026-11-15: five fresh processes per case, first calculation, median
and range ([serial](measurements/browser-engine-network.json),
[overlapped](measurements/browser-engine-network-overlap.json)):

| Case | Changed pairs | Serial | Overlapped |
| --- | ---: | ---: | ---: |
| steel used by every European industry (one batch) | 49 | 483 ms (470–486) | 491 ms (474–495) |
| electricity used by manufacturing, everywhere | 1,078 | 4.13 s (4.12–4.15) | 4.11 s (4.10–4.15) |
| manufacturing used by electricity, everywhere | 4,165 | 13.08 s (13.07–13.09) | 12.98 s (12.94–13.01) |
| China's whole final demand | 9,800 | 8.00 s (8.00–8.02) | 7.76 s (7.71–7.84) |

The best case gained 3%, below the 10% that would justify the code, so the batches
stay serial. Decoding and folding share the worker's thread, so a read started
before a fold reaches the network only after the fold, unless the worker first
yields; without that yield the overlap gained nothing. Even then the gain is at
most the fold's share, and the simulated link carries 65–135 MB in these cases,
5–11 s at 100 Mbit/s.

## Float32 maths, sparse rows and a GPU kernel

On 2026-11-01 ([#92](https://github.com/simonvanlierde/ramascene-explorer/issues/92))
manufacturing used by electricity was measured for a WebGPU kernel and a smaller download:

- Float32 through the kernel and the fold stays within 3e-7 of each flow and 1.1e-6 of
  the largest change, at −20% and +100%. The singular test would need its own threshold.
- Float32 storage, which the store now uses, moved the 153 scenarios published then by
  at most 1.2e-8 relative.
- Dropping entries below 1e-9 of each column's largest keeps footprints within 3.6e-7.
  At 1e-7 they move by up to 0.1%, at 1e-5 by 6%, which is too far.
- Bytes per changed row: an A row is 31 KB, or 9.5 KB as sparse float32. An L column is
  60 KB, 26 KB as sparse float32, or 6.3 KB with only the 2,205 flow totals.

Not now: the download dominates. The scenario downloads for about 11 s at 100 Mbit/s,
against about 1 s of maths with threads and SIMD, so a GPU kernel could save at most
that second. The maths stays float64. The sparse sizes above are where a smaller store
would start.

## Browser threads

[Browser threads](browser-engine.md#browser-threads) describes the pool. The paired browser
diagnostics are in [browser-engine-threads.json](measurements/browser-engine-threads.json).
They include cold and repeated scenarios and peak RSS of a fresh Chromium process tree.
Process-tree RSS counts shared mappings more than once; it is not the calculation's
working-memory estimate. Build the site with `pnpm build`, then reproduce with the Playwright
image from package.json:

```sh
docker run --rm --ipc=host -v "$PWD:/src" -w /src mcr.microsoft.com/playwright:v1.64.1-noble \
  bash scripts/measure-browser-threads.sh 5
```

Run it on an otherwise idle machine, with its CPUs pinned (`--cpuset-cpus`), so other heavy
jobs do not skew the timings.
The harness discards a warm-up pair, alternates mode order and checks complete flow arrays
against the single-thread result at relative 1e-8.

On the pinned i9-14900KF P-core slot (CPUs 0–7), five paired Chromium runs
of manufacturing used by electricity had these medians:

| Measurement | One thread | Four threads |
| --- | ---: | ---: |
| First calculation, including reads and pool startup | 2.24 s | 1.65 s |
| Repeated calculation | 1.77 s | 1.19 s |
| Peak browser process-tree RSS | 1.11 GB | 1.11 GB |

The first calculation was 27% faster and the repeat was 33% faster.
The shared host and local asset server produced slow samples in both modes;
all five measured pairs remain in the JSON. These are local browser diagnostics,
not phone or Internet-download timings. Small and sparse cases use the same
single-thread implementation in both modes.

### Where the pool starts to pay

The [threshold diagnostics](measurements/browser-engine-thread-threshold.json) time six
dense scenarios from 2×10<sup>7</sup> to 4.8×10<sup>9</sup> multiply-adds, on one thread
and on a forced pool. Each ran five pairs on CPUs 0–7 of the same i9-14900KF, and five
more limited to CPUs 0–3 ([four-CPU run](measurements/browser-engine-thread-threshold-4cpu.json)),
where Chromium reports four cores and the pool gets three threads. Median first calculations,
including reads and pool startup:

| Multiply-adds | 8 CPUs, one thread | 8 CPUs, four threads | 4 CPUs, one thread | 4 CPUs, three threads |
| ---: | ---: | ---: | ---: | ---: |
| 2.0×10<sup>7</sup> | 0.499 s | 0.495 s | 0.647 s | 0.715 s |
| 5.0×10<sup>7</sup> | 0.448 s | 0.443 s | 0.621 s | 0.638 s |
| 1.0×10<sup>8</sup> | 0.385 s | 0.400 s | 0.590 s | 0.524 s |
| 3.4×10<sup>8</sup> | 0.540 s | 0.494 s | 0.687 s | 0.710 s |
| 1.4×10<sup>9</sup> | 1.39 s | 1.20 s | 1.60 s | 1.50 s |
| 4.8×10<sup>9</sup> | 2.18 s | 1.62 s | 2.37 s | 2.09 s |

On four CPUs the pool made the first calculation slower in most pairs up to
3.4×10<sup>8</sup>, and faster in nine of ten pairs from 1.4×10<sup>9</sup>. On eight CPUs
it saved about 50 ms at 3.4×10<sup>8</sup>. So the pool starts at 10<sup>9</sup>.
No scenario between 3.4×10<sup>8</sup> and 1.4×10<sup>9</sup> was measured, so the
crossover lies somewhere in that range. Repeated calculations gained 10–30 ms below
10<sup>9</sup> on both CPU counts; all samples are in the JSON. Reproduce with
`bash scripts/measure-browser-threads.sh 5 threshold` (add `4cpu` as a third argument under
`taskset -c 0-3`) in the same container, as above.

### Eight and sixteen threads

The [scaling diagnostics](measurements/browser-engine-thread-scaling.json) compare
1, 4, 8 and 16 threads on the same dense case. Five sets used fresh Chromium process
trees on CPUs 0–23 of the same i9-14900KF. The combined CPU allocation leaves room
for sixteen calculation threads, but these runs share CPUs with host processes. All complete flow arrays match the
single-thread reference at relative 1e-8.

| Threads | First calculation | Repeated calculation | Peak browser process-tree RSS |
| ---: | ---: | ---: | ---: |
| 1 | 2.29 s | 1.79 s | 1.10 GB |
| 4 | 1.76 s | 1.28 s | 1.10 GB |
| 8 | 1.72 s | 1.25 s | 1.11 GB |
| 16 | 2.42 s | 1.20 s | 1.14 GB |

These are medians. Repeated calculations range from 1.19–3.19 s at four threads,
1.16–2.17 s at eight, and 1.11–1.92 s at sixteen. First calculations have larger
outliers, retained in the JSON. Eight threads improve the median repeat by 2%
over four, and sixteen by 6%; those gains are small relative to the observed variation.

Keep the four-thread cap. The pinned wasm-bindgen runtime reserves a
[2 MiB stack per additional thread](https://github.com/wasm-bindgen/wasm-bindgen/blob/0.2.130/crates/cli-support/src/transforms/threads/mod.rs#L12).
Eight calculation threads would consume the entire 16 MiB pool allowance in stacks
alone, and sixteen would need 32 MiB before runtime space. Increasing the allowance
would remove the largest dense case from the existing working-memory budget.

Reproduce the scaling comparison with:

```sh
docker run --rm --ipc=host --cpuset-cpus=0-23 -v "$PWD:/src" -w /src \
  mcr.microsoft.com/playwright:v1.64.1-noble bash scripts/measure-browser-threads.sh 5 1,4,8,16
```

The harness changes the cap only in the benchmark's intercepted worker response,
asserts the actual pool size, and leaves the shipped cap unchanged. Use the same
CPU allocation for every count; do not compare these timings with the separate
four-thread P-core-slot measurements above.
