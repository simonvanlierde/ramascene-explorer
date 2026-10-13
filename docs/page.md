# The page

Example views: `?scenario=steel-in-vehicles-europe&indicator=5` or
`?scenario=steel-europe-20&indicator=7`. The page shows GHG emissions and
metal-ore extraction in megatonnes (the data holds kg CO2 eq and kt), and
employment in persons (the data holds thousands of persons).

## World map

A choropleth map colours each country by the change in its EXIOBASE region, as
a percentage of that region's own baseline. The colours diverge from a grey
"within ±E/20" class to blue and red, where E is a round number at or above the
largest change.

`data/regions.json` carries the 49-region breakdown (`--out-regions`) of the
baseline and the three original interventions. Grid cells have no 49-region
breakdown, because that would multiply these sidecar files by 50. A grid cell
falls back to the five continental aggregates of `results.json`, and the page
says so.

The five "Rest of …" regions are hatched, because every country in one shares
its value. Which countries each one covers follows the Natural Earth continents
(see `REST_OF` in `map.js`). EXIOBASE's own concordance may differ at the
edges. `?region=<code>` highlights a region.

`geo/countries-110m.topo.json` is Natural Earth 1:110m Admin 0 – Countries,
**v5.1.2** (public domain), from
`nvkelso/natural-earth-vector` tag `v5.1.2`, `geojson/ne_110m_admin_0_countries.geojson`
(sha256 `6866c877…c977f`). I kept only the properties `iso` (`ISO_A2_EH`;
Somaliland as `SO`, N. Cyprus `null`) and `name`, dropped Antarctica and the
French Southern Lands, and converted it with `geo2topo -q 1e4`
(topojson-server 3.0.1).
Malta is below the 1:110m threshold and appears only in the table.

## Supply-chain Sankey

`data/flows.json` (`--out-flows`) splits each original intervention's change
two ways: by the sector whose production carries the impact, and by the region
where the impact occurs. To get it, the script runs route three (Hotspot ×
Geographic, the same route as the map) once per level-2 product aggregate, over
the 49 regions, and takes intervention minus baseline. There are 15 of these
sectors, and they partition the 200 products. That gives 15 × 49 = 735 cells.

The 12 cells with the largest |change| are named. Every other cell is added to
the flow between its sector (if named) or "Other sectors" and its region (if
named) or "Other regions". Nothing is dropped, so the flows sum to the total
change. `precompute.py` writes nothing unless three checks pass: the flows sum
to the total (relative 1e-12), the sectors sum to each region's value, and each
region matches B·L·ΣY (relative 1e-9).

This is a production-side decomposition of where the change lands. It is not a
structural path analysis through the tiers of the supply chain. Under
`prefers-reduced-motion` the "Animate from the baseline" replay is instant.

## Live scenarios (optional)

With `?api=<origin>` the page adds a "Run a custom scenario" panel that sends one
intervention (product, origin region, consuming sector, consuming region, change
in %) to the RaMa-Scene job API (`ramascene-jobs`) and polls for the result. The
result is compared with the baseline computed in the same job and labelled
"computed live by the job API, not precomputed", with its own provenance: engine
commit, dataset, the job's duration and peak memory.

Without `?api=` the panel stays hidden, its code is not loaded, and the page
fetches only its own files (`data/*.json`, the map geometry and the fonts). The
parameter accepts a bare origin: `http://` only on loopback (a local run or an
SSH tunnel), and `https://` otherwise. The page ignores anything else and
reports it in the status line.

```sh
# job API on 127.0.0.1:8020 (see ramascene-jobs), this page on 8000
python3 -m http.server 8000
# then open http://127.0.0.1:8000/?api=http://127.0.0.1:8020
```

The fonts are self-hosted, the latin subset as Google Fonts serves it, so the
page loads nothing from a third party.
