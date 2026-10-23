# Architecture

The explorer has two halves. A Python script computes results once. A static
page then reads those results in the browser. Nothing runs on a server, unless
you open the page with `?api=`.

```text
RaMa-Scene engine + EXIOBASE matrices
        |  precompute.py (run by hand, needs the engine)
        v
data/results.json        data/embodied.parquet  (release asset, 51.5 MB)
        |                        |
        +--- GitHub Pages -------+
                   |  fetch + HTTP range requests
                   v
              the page (Svelte, in the browser)
                   |  only with ?api=<origin>
                   v
              job API (ramascene-jobs), optional
```

- Precompute, its checks and the Parquet layout: [precompute.md](precompute.md).
  The scenarios: [scenarios.md](scenarios.md).
- The release asset, its checksum and Pages: [publishing.md](publishing.md).
- What the page shows, how it reads the Parquet file, and the live panel:
  [page.md](page.md).
- The URL parameters and the job API: [interface.md](interface.md). What the
  page accepts from them: [security.md](security.md).

`index.html` loads `src/main.js`, which mounts `src/App.svelte`. The Svelte
files in `src/` draw the view. The logic that needs no browser lives in plain
modules next to `index.html`, so `node --test` can test it:

| module | what it holds |
| --- | --- |
| `explorer.js` | where the data file is (`?data=`), the synthetic-data banner, run matching |
| `embodied.js` | reading the Parquet file by range request |
| `flows.js` | sums, scales, units, the table and CSV, the URL parameters |
| `map.js` | which map country belongs to which region |
| `live.js` | the optional job API: origin check, request body, result reshaping |
