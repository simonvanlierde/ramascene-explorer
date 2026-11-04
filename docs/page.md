# Read the map

What we consume connects us to environmental impacts across global supply chains.
The map shows those connections for the world economy in 2011, from EXIOBASE v3.3.sm.
Choose a country or region, follow its consumption footprint, then see what one change does.

## Follow a footprint

The map starts from final demand: what households, governments and investors buy.
It follows that spending back through every supply chain to the industries that
produce what is bought, at home and abroad.

- **Consumption** shows where emissions, employment or extraction occur to supply the selected region's final demand.
- **Production** shows whose final demand the production in the selected region serves.

These are supply-chain links, not shipping routes or direct trade between two countries.

The headline gives the selected total and the share that occurs abroad.
Bands show the largest flows, and each band widens toward its destination.
A region's fill also counts flows that are too small or too close to draw as a band.

Select an industry section on the rail to look at it alone. Select more sections to combine them.
Every total follows that selection. The rail's heights show each section's share of the 2011 flows.

Choose **Details** for the same flows as a Sankey diagram or a sortable table. On a wide screen the sidebar stays usable beside it, and the diagram follows the selection.
The diagram runs from producer to industry to consumer.
**Download CSV** saves the table at full precision, in its displayed unit.
The filename records the year, region, indicator, direction, sections and scenario,
and marks synthetic test data.

## Compare a scenario

Open **What if…** to see how one change in one place ripples through supply chains worldwide.
Three scenarios come first:

1. **Industry in China uses 20% less coal power** made in China, per unit of output.
   World greenhouse-gas emissions fall by 1.9%, almost all of it in China.
2. **Every industry in Asia-Pacific uses 20% less iron and steel** per unit of output.
   World metal-ore extraction falls by 7.1%.
3. **Final demand in Europe buys 20% less construction work.**
   World greenhouse-gas emissions fall by 0.44%, employment by 0.36% and metal-ore extraction by 0.32%.

Below them, **Material efficiency, one product** holds the 150 grid cells, the steel one above included: one of ten products,
used by every industry of one of five world regions, cut by 10%, 20% or 50%.
[What each scenario changes](scenarios.md) gives the exact definition of every one.

The bands keep their 2011 width. Their colour shows the change from the 2011 baseline, in percent.
The five world-region summaries show where that change occurs.
The scrubber moves between the baseline and the scenario, and replays when you pick another scenario.

The colour scale fits the flows on screen and uses a square-root scale.
Its limit is the 90th percentile of the absolute percentage changes among the flows
worth at least 0.1% of the selected total, rounded up to a readable step. Larger
changes share the end colour. When every one of those changes rounds to zero, the range is ±1%.
Two selections can have different colour scales, so compare their printed percentages.

These are changes to the 2011 economy, not forecasts.
Prices and all other input requirements stay fixed, and nothing replaces what a scenario cuts:
the model has no substitution or rebound.
A fall in an indicator is a model result. Whether it is good depends on the indicator and the context:
fewer jobs, for example, is not a benefit.

## Units and calculation checks

- **GHG:** greenhouse-gas emissions, in megatonnes of CO₂-equivalent (Mt CO₂-eq).
- **Metal ores:** extraction, in megatonnes (Mt).
- **Employment:** the people employed to meet the demand, shown as “jobs”. It is not full-time equivalents or new jobs.

The source data records these in kg CO₂-eq, kilotonnes and thousands of people.
**Details → Method** explains the model and the numerical checks.
**Checks passed** means those calculation checks passed. It does not mean that a scenario is realistic.

## Navigate and share

Select a region on the map, or type its name or code in the country selector.
The map opens on the globe; switch between **Globe** and **Flat**. Zoom up to 8× with the zoom buttons, the scroll wheel or a pinch.
Drag a zoomed flat map to pan it. Drag the globe to turn it.
A flick glides on a little after you let go; a pause before letting go, or reduced motion, stops it there.
On phones (760 px wide or less), scrolling moves the page:
hold Ctrl or ⌘ to zoom with the wheel. One finger scrolls past the unzoomed flat map.
**Reset zoom** shows the whole map again.

Partners within 5° (about 550 km) of the selected region get no band, but their fill still shows the flow.
Other bands appear when they fit outside the collar around the selected region,
and zooming in can show more of them. On the globe, a flow from beyond the horizon starts at the edge,
and when the selected region turns out of view, its bands end at the edge.
Labels keep clear of the map controls and the legend.

**Copy link** shares the filters, the map position and the selected published scenario.
The URL does not store a custom result: its link opens the last published scenario with the current filters.
The [URL parameter reference](interface.md#url-parameters) lists every parameter.
Links from the first version still open their published scenario.

## Custom scenarios

Below the published scenarios, the **Custom scenario** card lets you set up your own change.
On phones it is in the selection sheet.
Open it to [calculate a scenario on your device](browser-engine.md). With `?api=<origin>`,
the page sends the scenario to a job API instead.
The page loads the browser data only when you open the card.

Choose a product, where it is produced, the industry or final demand that uses it, and where.
The lists are nested: each industry section holds its divisions, and each division its products;
the world holds its continents, and each continent its countries. A list of more than ten items
has a search button next to its label. A search keeps the matches and the groups they belong to.

For an industry, the percentage changes how much of the product it uses per unit of output.
For **Final demand**, it changes the spending on the product.
The model then calculates the total use. It is not fixed to that percentage.

Your device calculates within [download, memory and arithmetic budgets](browser-engine.md). A pair
is one product from one producing country. Manufacturing from every country used by electricity
(85 × 49 = 4,165 pairs) fits, and takes several seconds; every product from every country does not,
and the card says so before you run it. Choose a narrower product, fewer producing countries, or
fewer industries or regions that use it, or use the job API.

Above 5 MB, the card says how much the selection downloads.
While it runs, the card shows the seconds elapsed and a **Cancel** button.
A finished custom scenario replaces the map's scenario, with its own baseline and provenance.
**Details → Method** lists its totals by producing region.
Choose a published scenario to return to the stored results.
While a custom result is shown, links to other sites open in a new tab and say so, since leaving
the page would lose the result.

## Live scenarios (optional)

The job API form sends one change and polls for its result.
The allowed change comes from `GET /catalog`, or is −100% to +1000% if the API gives no range.
If the API cannot be reached, the panel offers **Try again**, and the published scenarios stay available.
The result is labelled “computed by the job API”. Its provenance records the API origin,
engine commit, dataset, duration and peak memory. Check the origin before you rely on its results.
The published scenarios' checks do not cover that custom run.

A job with embodied flows can update the map only if its layout matches:
49 countries and regions, 15 industry sections and three indicators in the expected order.
A result with no flows or another layout stays in the panel.
A job that finishes while **Flows, 2011** is shown waits in **What if…**.
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
The five “Rest of …” regions combine their Natural Earth countries, as `REST_OF` in `src/lib/map.js` lists them.
Those boundaries can differ from EXIOBASE's country groups at the edges.
See the [geometry source and processing](architecture.md#map-geometry).

## Theme

The page follows your system's light or dark setting. The sun or moon button in the header
switches between them, and this browser keeps your choice.
