# Architecture

The explorer has two halves. A Python script computes results once. A static
page then reads those results in the browser. Nothing runs on a server, unless
you open the page with `?api=`.

```text
RaMa-Scene engine + EXIOBASE matrices
        |  precompute.py (run by hand, needs the engine)
        v
data/results.json        data/embodied.parquet  (release asset)
        |                        |
        +--- GitHub Pages -------+
                   |  fetch + HTTP range requests
                   v
              the page (Svelte, in the browser)
                   |  only with ?api=<origin>
                   v
              job API (ramascene-jobs), optional
```

Each part has its own page; the README's Docs list links them all.

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
