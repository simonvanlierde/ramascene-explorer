# The page

The page reads `data/results.json` (scenarios, continental totals, checks and
provenance) and the embodied flows ([precompute.md](precompute.md#embodied-flows)).
It shows one question at a time:

- **Flows, 2011.** A sentence names the selected country's footprint (or what
  it releases), and its country and indicator are controls you can change.
  The map draws the largest flows as tapered bands, thin where a flow leaves
  and wide where it arrives. It fills each region by the size of its flow
  with the selected country. The map is flat (Equal Earth) or a globe.
  - Partners within 5° of great circle (about 550 km) get no band on either
    map; the fill shows them.
  - Further partners get a band where it fits outside the collar, the circle
    where the bands meet the selected country. Zooming in makes room for more:
    for Germany, Italy's band appears once you zoom in on the flat map.
  - The wheel, a trackpad pinch or a two-finger pinch zooms the map, up to
    8×, and the + and − buttons zoom toward the selected country. The zoom
    goes into the link (`zoom`). On the
    zoomed flat map a drag pans; on the globe it turns the globe. On a phone,
    one finger still scrolls the page past the unzoomed flat map.
  - On the globe, a band from a partner over the horizon starts at the edge.
- **Industry rail.** One tab per section, its height the section's share of
  the selection. A click isolates one section, and further clicks add or
  remove sections. Every number on the page follows the selection, in both
  modes.
- **What if…** The bands keep their 2011 width and take the run's % change as
  their colour. The colour scale is square-root and fitted to the flows on
  screen: 90% of the larger flows fall inside it, and the rest take the end
  colour. A scrubber runs from the 2011 baseline to the run and replays on
  every switch. Five cards show the change released in each continent.
- **Details.** A Sankey (released in → industry → consumed in), the same
  flows as a sortable table, and the method with every check.
  - Download CSV saves the table's rows at full precision, in the table's
    unit. The file name states the basis: year, region, indicator,
    direction, sections, run, and "synthetic" for test data.
  - Copy link copies the current view's URL.

On load the page fetches `data/results.json`, then reads the Parquet footer
by range request, using the size recorded in `provenance.embodied.bytes`.
Without that record (an older `results.json`), or when no footer is found at
that size, it sends a HEAD request first to ask the server for the size. Then
it reads the baseline row group and draws the map. The default What if… run
loads when the browser is idle. Each run is fetched once, on demand.

The selection lives in the query string (`mode`, `scenario`, `indicator`,
`region`, `dir`, `sections`, `map`, `zoom`, `panel`), so every view can be shared;
links from the first version (`?scenario=&indicator=&region=`) still open
their run.

The five "Rest of …" regions merge their Natural Earth countries (see
`REST_OF` in `map.js`); EXIOBASE's own concordance may differ at the edges.

The page shows GHG emissions and metal-ore extraction in megatonnes (the data
holds kg CO2 eq and kt), and employment in jobs (the data holds thousands of
persons).

## Map geometry

`geo/countries-110m.topo.json` is Natural Earth 1:110m Admin 0 – Countries,
**v5.1.2** (public domain), from
`nvkelso/natural-earth-vector` tag `v5.1.2`, `geojson/ne_110m_admin_0_countries.geojson`
(sha256 `6866c877…c977f`). I kept only the properties `iso` (`ISO_A2_EH`;
Somaliland as `SO`, N. Cyprus `null`) and `name`, dropped Antarctica and the
French Southern Lands, and converted it with `geo2topo -q 1e4`
(topojson-server 3.0.1).
Malta is below the 1:110m threshold and appears only in the table.

## Live scenarios (optional)

With `?api=<origin>` What if… adds a "Custom scenario" card under the run list
(in the selection sheet on a phone). Its form sends one intervention (product,
origin region, consuming sector, consuming region, change in %) to the
RaMa-Scene job API (`ramascene-jobs`) and polls for the result. The change is
held to the range the job API states in `GET /catalog` (`tech_change_percent`,
−100 to +1000). When nothing answers, the card says so and offers Try again. The
result is compared with the baseline computed in the same job and labelled
"computed live by the job API, not precomputed", with its own provenance: engine
commit, dataset, the job's duration and peak memory.

When the job API returns the job's embodied flows (`ramascene-jobs` does from
its flows release on), the page also shows them as the run in What if…: the
map, the continent strip, the sentence and Details draw the job's flows against
the job's own baseline, the same way they draw a precomputed run. The status
line then reads "computed live by the job API, not precomputed", the trust pill
reads "Live job: not checked" instead of Verified, and Details → Method lists
the job's provenance above the precomputed checks, which do not cover it. The flows must have the precomputed file's layout (the same 49
countries, 15 sections and three indicators); a job without them, or with
another layout, stays in the panel only.

A live run never enters the page's link: the link keeps the last precomputed
run, so a shared view never points at a job its reader cannot reach. Picking a
precomputed run in the sidebar replaces the live one.

Without `?api=` the panel stays hidden and its code is not loaded. The page
then fetches only its own files: `data/results.json`, `data/embodied.parquet`,
the map geometry and the fonts.

The parameter accepts a bare origin: `http://` only on loopback (a local run
or an SSH tunnel), and `https://` otherwise. The page ignores anything else
and reports it in the status line.

```sh
# job API on 127.0.0.1:8020 (see ramascene-jobs), this page on 5173
pnpm dev
# then open http://localhost:5173/?api=http://127.0.0.1:8020
```

The stylesheet (`src/app.css`) names the interface colours as variables; the
data colours live in `flows.js`, next to the scales that use them.
