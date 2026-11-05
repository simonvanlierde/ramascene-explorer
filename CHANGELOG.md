# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- What if… leads with the scenario's world total, over every country's consumption and every
  industry, before the selected country's split over the five world regions. A custom run's
  world total is against its own baseline ([page.md](docs/page.md#compare-a-scenario)).
- The header's "Published scenarios · not forecasts" pill opens a short note on where the
  numbers come from: the dataset and its DOI, the engine, the model, the date the results were
  generated, and why a scenario is not a forecast, with links to Method and the source code.
  For a custom run it names that run's own source ([page.md](docs/page.md#units-and-calculation-checks)).
- Each ready pull request gets its own preview Worker, which is deleted, and checked gone,
  when the pull request closes, merges or turns draft. A daily sweep catches any that were
  missed. Drafts and bot pull requests get no preview ([publishing.md](docs/publishing.md#cloudflare)).
- `data.yml` puts a `data-*` release's files in the R2 bucket, each object written once and
  never deleted ([publishing.md](docs/publishing.md#publish-the-data)).
- The explorer has a logo: the serif R of its sentence, underlined by a flow band. It is the
  home-screen icon and heads the README. The browser tab and the header use the band alone, a
  white ribbon on rust.

### Changed

- Deploys and previews no longer write to R2. They check that the data their commit names is
  published, and stop if it is not.

- Details is 768 px wide on a desktop, up from 640 px, and never wider than the space beside
  the sidebar. The Sankey uses the extra width for longer bands, shared evenly between its two
  stages, not bigger text.
- Details no longer has a footer. The dataset, engine and generated date are in the header
  pill's note; the flow check is listed with the other checks under Method.
- Below 1100 px the header pill drops the dataset name, so the "not forecasts" caveat stays
  readable.
- The link preview image and the README screenshots show the current page, with the globe.

### Fixed

- On a wide screen the header's buttons work while Details is open: the theme switch, the
  source link, the basis pill and the checks pill. On a phone Details is still modal.
- On a slow link, a small data read that gets no bytes while large ones arrive no longer fails
  the custom scenario after a minute: a read fails only when the data host has sent nothing to
  any read for a minute. A read the host leaves unanswered is then tried once more on a fresh
  request. The map's reads of the embodied flows get the same timer and retry; before, one
  such read left the map empty for good ([security.md](docs/security.md)).
- A custom scenario on a slow link no longer fails at one minute while its data is still
  arriving: a data read now fails only after a minute with no data at all
  ([browser-engine.md](docs/browser-engine.md)).
- The two-minute limit now times only the threaded calculation, not the download, and a
  run on one thread is no longer downloaded twice and then failed when it passes two
  minutes.
- When one array of a browser run fails to load, the run stops its other downloads before
  the page starts reading the next selection, so the two never download at the same time.
- Running the selection that was queued to download ahead of Run no longer downloads it
  again after the run.
- When the browser worker file does not load, for example in a tab opened before a deploy,
  the page asks for a reload and turns Run off, instead of offering Try again, which loaded
  the same missing file.

### Security

- The deploy token needs no R2 access any more; only `data.yml` writes to the bucket, with a
  token scoped to it. The production promote installs without install scripts.
- `undici` is held at 7.30.1 or later through wrangler, which clears eight advisories. They
  reached `wrangler dev` and CI only.

## [0.6.0] - 2026-11-04

### Added

- Two published scenarios: industry in China uses 20% less coal power, and final demand in
  Europe buys 20% less construction work ([scenarios.md](docs/scenarios.md#featured-scenarios)).
  The map flows for all 155 runs are on the new `data-2011-r2` release.
- A [documentation index](docs/README.md) by reader: the results, the method, contributing.
- A dark theme. It follows the system setting until you use the toggle in the header, and
  the browser keeps your choice ([page.md](docs/page.md#theme)).
- A flick on the globe, or on the zoomed flat map, lets it glide on a little after you let go.
  A pause before letting go, or reduced motion, stops it where you released it
  ([page.md](docs/page.md#navigate-and-share)).
- The globe is shaded faintly toward its edge, so it reads as a sphere.
- Above 5 MB, the custom-scenario card says how much the selection downloads
  ([page.md](docs/page.md#custom-scenarios)).

### Changed

- With the `DATA_ORIGIN` variable set, the page reads the flows and the browser store from R2
  on its own hostname, not through the Worker, so custom scenarios no longer count toward the
  Worker's daily requests ([data host](docs/publishing.md#data-host)).
- The deployment check replays the 155 published scenarios in one browser, not all three.
- The page modules moved to `src/lib/`, the Python pipeline to `pipeline/` and the measurement
  scripts to `scripts/`, so the repository root holds only configuration and project files.
- Dense custom scenarios can use up to four browser threads on a host that enables shared
  memory ([browser threads](docs/browser-engine.md#browser-threads)).
- The site is served from Cloudflare at the same address, with the headers browsers need
  for shared memory ([publishing.md](docs/publishing.md#cloudflare)).
- A custom scenario in the browser starts downloading its data while you set it up, so Run
  waits less, and a running one shows its time and a Cancel button
  ([browser-engine.md](docs/browser-engine.md)).
- The map opens on the globe; `map=flat` in the link opens the flat map
  ([interface.md](docs/interface.md)).
- On a wide screen the sidebar stays usable while Details is open, and Details is wider.
  Escape closes it from anywhere on the page.
- The direction buttons read **Consumption** and **Production**.
- What if… opens on three featured scenarios: coal power in China, steel in Asia-Pacific and
  construction demand in Europe. The three original interventions still open from their links.
- The development steps (View, Build, Data, Test, Benchmark) moved from the README to
  [develop.md](docs/develop.md). The README is now a short introduction.
- The page says "scenario" instead of "intervention", and Details → Method opens with a plain
  explanation of what the map and the scenarios show.
- While a custom result is shown, links to other sites open in a new tab and say so, since the
  link does not keep the result ([page.md](docs/page.md#custom-scenarios)).
- The custom-scenario card is always in What if…; `?compute=1` is no longer needed. The page
  loads the browser data when the card opens ([page.md](docs/page.md#custom-scenarios)).
- The custom-scenario lists are nested by section and region, sorted by name, and searchable
  ([page.md](docs/page.md#custom-scenarios)).
- A custom result's totals by region moved from the sidebar to Details → Method.
- Custom scenarios can be much broader: the browser data is a float32
  [Zarr store](docs/browser-engine.md#data-and-method) that reads only the rows a scenario needs,
  so manufacturing used by electricity in every country, or one region's whole final demand,
  now computes on the device. Results match every published scenario within relative 1e-6.
- Broad custom scenarios compute faster: the small system, the flow sums and decoding the data
  run in WebAssembly with SIMD, so manufacturing used by electricity in every country takes about
  2.1 s instead of 10 s on a desktop ([browser-engine.md](docs/browser-engine.md#measure-a-change)).
  Custom scenarios need Chrome or Firefox from 2021, or Safari 16.4.

### Fixed

- Turning the selected region behind the globe drew its bands across the far side. They now
  end at the edge ([page.md](docs/page.md#navigate-and-share)).
- Firefox sometimes stopped a custom scenario's data download by itself, failing the run. Such a
  read is now tried once more, and a failed read names the file and byte range in its message.
- A data read that takes over a minute fails the custom scenario, naming the read, instead of
  waiting for the two-minute limit ([browser-engine.md](docs/browser-engine.md)).
- Changing the selection while a custom scenario ran could start its download beside the run.
  It now waits for the run to finish.
- The data host served the production page a cached copy of the flows without CORS headers,
  so the map did not load. The deploy check now reads the data with production's origin too,
  and the setup adds the CORS headers at the edge ([data host](docs/publishing.md#data-host)).
- A drag on the globe while it turned to a picked country was undone by the turn. The drag
  now stops the turn.
- Running a custom scenario while the form was still downloading another selection's data held
  both at once, which could pass the memory budget on a phone. Run now stops the other download
  first ([browser-engine.md](docs/browser-engine.md)).
- The browser's [memory check](docs/browser-engine.md) counts the matrix copies used during
  a custom calculation. Mixed scenarios that exceed the working-memory budget are refused before downloading matrices.
- A selection too broad for the browser, such as every product used by electricity, now says
  how many product–country pairs it changes and what to narrow, before Run, instead of failing with
  "select at most 2000 changed rows". The check counts each pair once and uses the change you typed,
  so a 0% change no longer blocks Run.
- Choosing the material-efficiency card after picking a combination that was never computed
  now points its pickers at the run it shows, instead of at the missing one.

## [0.5.0] - 2026-11-01

### Added

- Custom scenarios can run on the device with `?compute=1`, using float64
  matrix updates in a worker. The map shows their flows and source;
  [browser-engine.md](docs/browser-engine.md) explains the data, limits and checks.
- A browser route in the [agreement table](brightway-check/README.md), and
  CI parity checks for all 153 published scenarios at relative 1e-9.
- An opt-in [real job API timing test](docs/interface.md#measure-a-live-scenario)
  records click-to-result time and worker memory.
- `pnpm measure-coverage` reports how much of each Svelte file the browser
  tests run, in Chromium ([docs/publishing.md](docs/publishing.md#svelte-coverage)).

### Changed

- The [reading guide](docs/page.md) and interface distinguish monetary demand from
  inputs per unit of output, explain employment units, and make calculation checks
  and the limits of sharing custom results explicit.

### Fixed

- Browser calculations fetch small, complete A and L row files instead of ranges
  near the ends of large matrices. The new [row layout](docs/browser-engine.md#data-and-method)
  bounds each fetch and uses a versioned manifest to avoid stale-cache conflicts.

- Amounts use at most three significant figures, and percentages avoid signed
  zeros and unnecessary decimal places. Changes below display resolution no longer
  name a false hotspot; [calculations and CSV values retain their precision](docs/interface.md#number-display).

- Scenarios that change production inputs load both required matrices together,
  so a slow read of one
  does not hold up requests for the other. See [browser calculations](docs/browser-engine.md).

- Scenario checks recognize the current job API result label and the configured
  browser-test address, fixing paint measurements and tests on separate local ports.
  See [running the checks](CONTRIBUTING.md#run-the-checks-before-you-push).

- Source linting skips temporary mutation-test copies, so it can run alongside
  [mutation testing](CONTRIBUTING.md#run-the-checks-before-you-push).

- Browser scenario data groups X and Y into larger Parquet row groups, reducing
  startup work and download size without changing the float64 values. See the
  [data layout and measurements](docs/browser-engine.md).
- Browser scenarios reject numerical cancellation near a singular system and
  announce loading, errors and completion to screen readers. Decoding and row
  caching use bounded memory; broad selections are checked before matrix reads.
  See the [browser limits and measurements](docs/browser-engine.md).

## [0.4.0] - 2026-10-27

### Added

- Live mode lights the map. With `?api=`, a finished job that carries its
  embodied flows replaces the shown run in What if…: the map, the continent
  strip, the sentence and Details show the job's flows against the baseline
  from the same job, labelled "computed live by the job API, not precomputed",
  with the job's provenance in Details → Method. This needs a job API that
  returns flows; an older one keeps the result in the panel. A job that
  finishes while Flows is shown waits in What if… instead of switching the
  page. Without `?api=` nothing new loads or fetches.
- A reset button next to + and − once the map is zoomed in.
- Try again buttons: on a run that could not be loaded, and on the live
  panel when the job API does not answer.
- Docs on the architecture, the URL parameters and job API, what the page
  accepts from `?api=` and `?data=`, and a roadmap.
- `GOVERNANCE.md` and a code of conduct.
- `CONTRIBUTING.md`: how to set up, test and send a change. Commits from
  forks need a DCO sign-off, which a check on each pull request enforces.
  `SECURITY.md` says how a fix is disclosed and credited.
- `brightway-check/`, a separate check that loads the same EXIOBASE arrays
  into Brightway and scores one product five ways (Brightway, numpy,
  pymrio, pycirk and this engine), with the agreement table in its README.
  CI checks that the table matches the committed results.
- Releases carry build provenance. Each `v*` release gets the built page as a
  tarball with its SHA-256 and a Sigstore bundle, and `embodied.parquet` on
  `data-2011` gets one too. How to check a download is in
  [docs/publishing.md](docs/publishing.md#check-a-release-file), and
  [docs/assurance-case.md](docs/assurance-case.md) says why the page and its
  files can be trusted.

### Changed

- CI fails when line coverage drops below 80%. `pnpm test` checks the same floor.
- The Pages workflow publishes only from `main`.
- The live panel (`?api=`) is now a Custom scenario card at the end of the
  What if… run list, or in the selection sheet on a phone, instead of a form
  below the page. Its fields are stacked and labelled, the options show names
  without engine ids, and the change is held to the range the job API
  accepts (−100 to +1000%). Its status line sits under Run while the form
  is open, and screen readers hear it also when the phone's sheet is
  closed.
- While a live job is on the map, the trust pill reads "Live job: not
  checked" instead of Verified, and Details no longer shows the green check,
  which covers the precomputed runs only.
- Each region has one name everywhere: the sentence now says "Rest of
  Asia–Pacific", as the map and the cards do. "The" is added for the United
  States, the United Kingdom, the Netherlands and the Czech Republic.
- The What if… legend reads "Change in each 2011 flow, %", every tick has
  its %, and the note is two lines.
- On phones the zoom buttons sit at the map's bottom left, the Sankey's
  labels stay at their full size, and the pills and the sentence's controls
  are easier to tap.
- The grid's pickers fold away with the run list, so the industry sections
  stay in view in What if….
- The desktop scrubber is wider, with Replay on its own row.
- Text sizes keep to the type scale: the country box, run titles, pickers
  and popover options are 13 px, the segmented controls, table and the
  units beside the figures 12 px, and the phone's top-bar name 13 px.
- The possessive ("Germany’s") sits on the country's underline, in the
  same weight, instead of trailing after it.
- Inputs and selects have a darker border, at 3:1 contrast against the
  page.

### Fixed

- Screen readers name each industry in the rail with the words it shows
  first ("Agriculture 11%"), so voice control can find it.
- Labels on the map no longer hide under the map's buttons, legend or note.
- With Details open, the keyboard can no longer reach the live panel
  behind it.
- Focus stays on Run while a live job runs, instead of falling to the
  page.
- In a narrow window the scroll wheel scrolls the page instead of being
  caught by the map.
- The Sankey's caption no longer says to tap a band, which did nothing on
  a touch screen.
- The Sankey of what a country releases mirrors the one of what it
  consumes, so the industry labels no longer run into the "Consumed in"
  column.
- On phones the author link is a 44 px target like the other controls; the
  header's first row is 44 px tall to hold it.
- Each of the sentence's controls has the words it shows in its name, so
  voice control finds "Germany’s" and "thousand jobs" by what is on screen.
- On phones a tap just under one of the sentence's controls no longer goes
  to the control on the line below.
- A live job whose flows hold a value that is not a number stays in the
  panel instead of showing NaN on the page.
- The globe turns, drags and morphs from the flat map more smoothly on slow
  machines. While the map moves it draws simpler country outlines, then the
  full ones once it stops.

## [0.3.1] - 2026-10-19

### Fixed

- A click on a country selects it again on the zoomed map and on the globe.
  The map took hold of the pointer as soon as it was pressed, so the browser
  sent the click to the map instead of the country. It now does that only
  once the pointer moves, for a drag.

## [0.3.0] - 2026-10-19

### Added

- The zoom is kept in the link: `zoom=k,lon,lat` on the flat map (the view's
  centre), `zoom=k` on the globe. A shared link opens on the same place at
  any screen size.

### Fixed

- Jobs and metal ores no longer say "released". The continent cards, the map
  legend, the Sankey and table headers and the Details subtitle use each
  indicator's own word: "Jobs in" for employment, "Extracted in" for metal
  ores.
- On the globe, picking a country in the country box now turns the globe to
  it. Before, only a click on the map did, so a country on the far side
  stayed hidden.

## [0.2.0] - 2026-10-19

### Added

- Zoom on the map, up to 8×: the scroll wheel, a trackpad or two-finger
  pinch, or the + and − buttons, which zoom toward the selected country. The
  zoomed flat map pans with a drag.
- The author's name and a link to the source code on GitHub, in the header.

## [0.1.0] - 2026-10-19

First release.

### Added

- A map-first page. A sentence says where a country's consumption causes
  emissions, jobs or metal-ore extraction, and its country and indicator are
  controls you can change. Tapered bands show the largest flows on a flat
  Equal Earth map or a globe.
- An industry rail that filters every number by the 15 industry sections, and
  a switch between a country's consumption and its production, the two
  directions of a flow.
- What if…: all 153 precomputed runs (three named interventions and a
  material-efficiency grid of 10 products × 5 regions × 3 cuts). The map keeps
  the 2011 flows and colours them by the run's change; a scrubber replays the
  change from the 2011 baseline, and five cards split it by continent.
- Details: a Sankey (released in → industry → consumed in), the same flows as
  a sortable table, and the method with every check.
- Download CSV in the Details table: the selection's flows, share, largest
  section and, in What if…, the change, at full precision and with the basis
  in the file name.
- Copy link in Details, to share the exact view you are looking at.
- A phone layout with the selection in a bottom sheet.
- The embodied flows for every run as one Parquet file (the `data-2011`
  release asset), read in the browser by HTTP range request: under 1 MB of
  51.5 MB on first load, about 0.33 MB per further run.
- A faster first map: `results.json` records the size and SHA-256 of
  `embodied.parquet` (`provenance.embodied`), so the page skips the request
  that would ask the server for the file size.
- The whole view in the query string, so every view can be shared. Links of
  the form `?scenario=&indicator=&region=` still open their run.

[Unreleased]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/simonvanlierde/ramascene-explorer/releases/tag/v0.1.0
