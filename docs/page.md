# Read the map

Choose a country or region, trace its consumption footprint, then try a published scenario.
The map links final demand to production across global supply chains using EXIOBASE v3.3.sm for 2011.
Final demand includes household spending, government spending and investment.

## Follow a footprint

**Its consumption** shows where emissions, employment or extraction occur to supply the selected region's final demand.
**Its production** shows which regions' final demand is served by production located there.
These are supply-chain links, not shipping routes or direct bilateral trade.

The headline reports the selected total. Bands show the largest flows;
a band widens toward its destination. Region fills include flows too small or too close to draw as bands.
Select an industry section to isolate it. Select more sections to combine them.
Every total follows that selection. The rail's heights show each section's share of the baseline flows.

Choose **Details** for the same flows as a Sankey diagram or sortable table.
The diagram follows producer → industry → consumer.
**Download CSV** saves the table at full precision, in its displayed unit.
Its filename records the year, region, indicator, direction, sections and scenario;
synthetic data is also marked in the filename.

## Compare a scenario

Open **What if…** and select a published intervention.
The [scenario guide](scenarios.md) explains the exact quantity and geographic scope of each change.
The bands retain their baseline width. Their colour shows percentage change from the 2011 baseline.
The five world-region summaries show where that change occurs.
The scrubber moves between baseline and scenario and replays when the scenario changes.

The colour scale adjusts to the flows on screen and uses a square-root transformation.
Its limit uses the lower 90th percentile of absolute percentage changes among flows
worth at least 0.1% of the selected total, rounded up to a readable step. More extreme
changes share the end colour. If all eligible changes are zero at display resolution,
the range defaults to ±1%.
Compare the printed percentages when comparing different selections, since their colour scales can differ.

These are changes to the 2011 economy, not forecasts.
Prices and unselected input requirements stay fixed. The model includes no substitution or rebound response.
A reduction in an indicator is a calculation result; its desirability depends on the indicator and context.

## Units and calculation checks

- **GHG:** greenhouse-gas emissions, in megatonnes of CO₂-equivalent (Mt CO₂-eq).
- **Metal ores:** extraction in megatonnes (Mt).
- **Employment:** people employed attributed to demand, labelled “jobs”. It does not measure full-time equivalents or net job creation.

The source data records these in kg CO₂-eq, kt and thousands of persons, respectively.
**Details → Method** explains the model and numerical checks.
**Checks passed** means those calculation checks passed, not that a scenario has been empirically validated.

## Navigate and share

Select a region on the map or type its name or code in the country selector.
Switch between **Flat** and **Globe**. Use the zoom buttons, scroll or pinch to zoom up to 8×.
Drag a zoomed flat map to pan; drag the globe to turn it.
On phones (760 px wide or less), ordinary scrolling moves the page;
hold Ctrl or ⌘ to zoom with the wheel. One finger scrolls past the unzoomed flat map.
**Reset zoom** returns to the whole map.

Nearby partners within 5° (about 550 km) have no band; their fill still shows the flow.
Other bands appear when they fit outside the collar around the selected region.
Zooming can reveal more bands. A globe flow from beyond the horizon starts at the edge.
Labels avoid the map controls and legend.

**Copy link** shares filters, map position and the selected published scenario.
A custom result is not stored in the URL: its link opens the last published scenario with the current filters.
See the [URL parameter reference](interface.md#url-parameters).
Links from the first version still open their published scenario.

## Custom scenarios

What if… ends with a **Custom scenario** card; on phones it is in the selection sheet.
Open it to [calculate a scenario on your device](browser-engine.md). With `?api=<origin>`,
the page sends the scenario to a job API instead.
The page loads the browser data only when you open the card.

The lists are nested: each industry section holds its divisions, and each division its products;
the world holds its continents, and each continent its countries. A list of more than ten items
has a search button next to its label. A search keeps the matches and the groups they belong to.

The browser calculation handles about 200 changed supply rows, where a row is one product from one
producing country. Manufacturing from every country is 85 × 49 = 4,165 rows, too many: the card says so
before you run it. Choose a narrower product or fewer producing countries, or use the job API.

For an industry, the percentage changes selected input requirements per unit of output.
For **Final demand**, it changes spending on the selected product and origin.
The resulting total use is calculated by the model; it is not fixed to that percentage.
A completed custom scenario replaces the map's scenario while keeping its own baseline and provenance.
Details → Method lists its totals by producing region.
Choose a published scenario to return to the stored results.

## Live scenarios (optional)

The job API form sends one intervention and polls for its result.
The allowed change comes from `GET /catalog` (−100% to +1000% if no range is supplied).
If the API cannot be reached, the panel offers **Try again**; published scenarios remain available.
The result is labelled “computed by the job API”. Its provenance records the API origin,
engine commit, dataset, duration and peak memory. Check the origin before relying on its results.
The published scenarios' checks do not cover that custom run.

A job with embodied flows can update the map only if its layout matches:
49 countries and regions, 15 industry sections and three indicators in the expected order.
A result with no flows or a different layout stays in the panel.
A job completed in **Flows, 2011** waits in **What if…**.
The [API reference](interface.md#job-api) and [security guide](security.md#what-api-accepts) describe the contract.

```sh
# Run the job API on 127.0.0.1:8020, then serve the explorer locally.
pnpm dev
# Open http://localhost:5173/?api=http://127.0.0.1:8020
```

## First-load size

See [loading measurements](architecture.md#first-load-size) for transfer sizes and the command to measure a load.

## Map geometry

The map uses Natural Earth outlines. Malta is too small for this geometry and appears only in the table.
The five “Rest of …” regions combine their Natural Earth countries using `REST_OF` in `map.js`.
Those geographic boundaries can differ from EXIOBASE's concordance at the edges.
See the [geometry source and processing](architecture.md#map-geometry).
