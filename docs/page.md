# Read the map

What we consume is linked to emissions, employment and metal-ore extraction across global supply chains.
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
A region's colour also counts flows that are too small or too close to draw as a band.

Choose **World**, the first entry in the country list, to see every region at once.
No country is selected, so the map has no bands, and the total is the same in both directions.
With **Consumption**, each region's colour is what it releases for consumption anywhere.
With **Production**, each region's colour is what it consumes, wherever that was released.
The numbers under the headline give that total and its split over the five world regions.
In **Details**, the diagram runs from the five regions where it is released, through the industries, to the five where it is consumed.
In the link, World is `?region=world`.

Select an industry section on the rail to look at it alone. Select more sections to combine them.
Every total follows that selection. The rail's heights show each section's share of the 2011 flows.

Choose **Details** for the same flows as a Sankey diagram or a sortable table. Both follow the selection.
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

Below them, **Material efficiency, one product** offers 150 scenarios, the steel one above among them.
Choose the **Input product** (one of ten) and the world region whose industries use it
(**In every industry of**, one of five). Then choose how much to cut it (**By** 10%, 20% or 50%).
[What each scenario changes](scenarios.md) gives the exact definition of every one.

The bands keep their 2011 width. Their colour shows the change from the 2011 baseline, in percent.
Under the headline, **World total** comes first: the change in the whole world's emissions (or jobs,
or ores), over every country's consumption and every industry.
It ignores the sections and the country you picked.
Beside it, the selected country's own change is split over the five world regions where it occurs.
The slider moves between the baseline and the scenario, and replays when you pick another scenario.

The colour scale fits the flows on screen, so two selections can have different scales.
Compare their printed percentages, not their colours.
[Number display](interface.md#number-display) says how the scale is set.

These are changes to the 2011 economy, not forecasts.
Prices and all other input requirements stay fixed, and nothing replaces what a scenario cuts.
The model has no substitution and no rebound: nothing else is bought instead, and money saved is not spent elsewhere.
A fall in an indicator is a model result. Whether it is good depends on the indicator and the context:
fewer jobs, for example, is not a benefit.

## Units and calculation checks

- **GHG:** greenhouse-gas emissions, in megatonnes of CO₂-equivalent (Mt CO₂-eq).
- **Metal ores:** extraction, in megatonnes (Mt).
- **Employment:** the people employed to meet the demand, shown as “jobs”. It is not full-time equivalents or new jobs.

The source data records these in kg CO₂-eq, kilotonnes and thousands of people.
The **Published scenarios · not forecasts** pill in the header opens a short note with:

- the dataset and its DOI;
- the engine version and the model;
- when the results were generated;
- links to the method and the source code.

For a custom scenario, the note names where that run was computed instead. Escape closes it.
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

Partners within 5° (about 550 km) of the selected region get no band, but their colour still shows the flow.
Other bands appear when they fit outside the ring around the selected region,
and zooming in can show more of them. On the globe, a flow from beyond the horizon starts at the edge,
and when the selected region turns out of view, its bands end at the edge.
Labels keep clear of the map controls and the legend.

**Copy link** shares the filters, the map position and the selected published scenario.
The URL does not store a custom result: its link opens the last published scenario with the current filters.
The [URL parameter reference](interface.md#url-parameters) lists every parameter.
Older links that name a published scenario still open it.

## Custom scenarios

Below the published scenarios, the **Custom scenario** card lets you set up your own change.
On phones it is in the selection sheet.
Open it with **Set up** to [calculate a scenario in your browser](browser-engine.md). With `?api=<origin>`,
the page sends the scenario to a job API instead.
The page loads the browser data only when you open the card.

Choose a product, where it is produced, the industry or final demand that uses it, and where.
The lists are nested: each industry section holds its divisions, and each division its products;
the world holds its continents, and each continent its countries. A list of more than ten items
has a search button next to its label. A search keeps the matches and the groups they belong to.

For an industry, the percentage changes how much of the product it uses per unit of output.
For **Final demand**, it changes the spending on the product.
The model then calculates the total use. It is not fixed to that percentage.

### Example: less steel in European cars

This rebuilds the published scenario `steel-in-vehicles-europe`: European vehicle makers use
20% less steel per unit of output. The form opens with these values in **Change 1**:

| Field | Choose |
| --- | --- |
| **Product** | Iron, steel and ferro-alloy products (under Manufacturing, then Manufacture of basic metals) |
| **Produced in** | World |
| **Used by (industry or final demand)** | Motor vehicles and trailers (under Manufacturing, then Manufacture of motor vehicles, trailers and semi-trailers) |
| **Used in (region)** | Europe |
| **Input or demand change, %** | -20 |

1. Open **What if…**, then select **Set up** on the **Custom scenario** card.
2. Wait until the line below **Run scenario** reads "Ready to compute in this browser.".
   Then check the five values above.
3. Select **Run scenario**, then choose **Metal ores**. The map and the headline now show
   the custom result, and the **World total** falls by about 0.04%.
   **Copy link** would not keep it: its link opens the last published scenario.
4. Open the page again in another tab, with `?scenario=steel-in-vehicles-europe` added to
   its address. What if… does not list this scenario, but the link opens it.
   Select a country (not World) and the same indicator in both tabs.
   Then compare the two **World total** figures under the headline.

The browser compares its run with its own copy of the published 2011 baseline.
Tests hold its world-region totals within relative 1e-6 of RaMa-Scene for every published scenario,
and the worst case within 1e-8. So the printed changes agree to about their last digit
([the checks](browser-engine.md#check-the-calculations)).
That is agreement between two calculations, not evidence that the scenario is realistic.

Why about 0.04% and not 20%? Only European vehicle makers use less steel per unit of output,
and they use a small share of the world's steel. Every other industry keeps its steel input.
The model then works out the output of every industry again, so the total is a model result.

The featured `coal-power-china` scenario changes all 15 industry sections in China. The form
takes one industry, section or final demand per change and at most 10 changes, so it cannot rebuild that one exactly.
For a part of it, choose **Electricity by coal**, produced in **China**, used by **Manufacturing**,
used in **China**, -20.

### Several changes

**Add a change** adds another set of lists, copied from the last one, percentage included.
**Remove change** drops one, and focus moves to the change before it.
A scenario holds up to 10 changes.

Changes to the same input or spending multiply, as RaMa-Scene applies them one after another:
two cuts of 20% leave 64%, not 60%.

The headline names one or two changes in full. For more, it says how many, and **Details** lists each.

The browser's limits apply to all changes together, so a selection that is too broad may need a
change removed as well as narrowed. An error names the change it is about.

### Limits and results

Your device calculates within [download, memory and arithmetic budgets](browser-engine.md).
A pair is one product from one producing country.
Manufacturing from every country used by electricity (85 × 49 = 4,165 pairs) fits, and takes several seconds.
Every product from every country does not fit, and the card says so before you run it.
Then choose a narrower product, fewer producing countries, or fewer industries or regions that use it.
You can also remove a change, or use the job API.

Above 5 MB, the card says how much the selection downloads.
While it runs, the card shows the seconds elapsed and a **Cancel** button.
A finished custom scenario replaces the map's scenario and carries its own provenance.
A browser run is compared with the published baseline, a job-API run with the baseline from
the same job ([the 2011 baseline](scenarios.md#the-2011-baseline)).
**Back to published scenarios** in the sidebar shows the last published scenario again.
**Details → Method** lists its totals by producing region.
Choose a published scenario to return to the stored results.
While a custom result is shown, links to other sites open in a new tab and say so.
Leaving the page would lose the result.

## Live scenarios (optional)

The card names the job API from the link. The page contacts it only when you open the form with
**Set up**, to read its lists. **Run scenario** then sends your changes and waits for the result.
The [API reference](interface.md#job-api) lists the calls, and the
[security guide](security.md#what-api-accepts) says which `?api=` values the page accepts.

If the API cannot be reached, the panel offers **Try again**, and the published scenarios stay available.
A request with no answer fails after 30 s (Safari 17.4 and later; older Safari waits until **Cancel**). The page stops waiting after three failed status checks in a row.
**Cancel** stops the page waiting; the job may still finish on the API.

The result is labelled “computed by the job API”. Its provenance records the API origin,
engine commit, dataset, duration and peak memory. Check the origin before you rely on its results.
The published scenarios' checks do not cover that custom run.

The map shows a job's flows only if they have the page's layout: 49 countries and regions,
15 industry sections and three indicators. A result with no flows, or another layout, stays in the panel.
A job that finishes while **Flows, 2011** is shown waits in **What if…**.

```sh
# Run the job API on 127.0.0.1:8020, then serve the explorer locally.
pnpm dev
# Open http://localhost:5173/?api=http://127.0.0.1:8020
```

## First-load size

See [loading measurements](architecture.md#first-load-size) for transfer sizes and the command to measure a load.

## Map geometry

The map uses Natural Earth outlines. Malta is too small to have one at this scale, so it has no colour
and cannot be selected on the map: choose it in the country selector.
When it is selected, its ring sits at Valletta, and its bands meet there.
The five “Rest of …” regions combine their Natural Earth countries, as `REST_OF` in `src/lib/map.js` lists them.
Those boundaries can differ from EXIOBASE's country groups at the edges.
See the [geometry source and processing](architecture.md#map-geometry).

## Theme

The page follows your system's light or dark setting. The sun or moon button in the header
switches between them, and this browser keeps your choice.
