# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Changed

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
- Inputs and selects have a darker border, at 3:1 contrast against the
  page.

### Fixed

- Labels on the map no longer hide under the map's buttons, legend or note.
- With Details open, the keyboard can no longer reach the live panel
  behind it.
- Focus stays on Run while a live job runs, instead of falling to the
  page.
- In a narrow window the scroll wheel scrolls the page instead of being
  caught by the map.
- The Sankey's caption no longer says to tap a band, which did nothing on
  a touch screen.
- On phones a tap just under one of the sentence's controls no longer goes
  to the control on the line below.
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

[Unreleased]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/simonvanlierde/ramascene-explorer/releases/tag/v0.1.0
