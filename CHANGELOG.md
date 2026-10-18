# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-18

First release.

### Added

- A map-first page: a live sentence answers where a country's consumption
  causes emissions, jobs or metal-ore extraction, with the country and the
  indicator as controls inside it. Tapered bands show the largest flows on a
  flat Equal Earth map or a globe.
- An industry rail that filters every number by the 15 industry sections, and
  "Consumed in / Released in" for both directions of a flow.
- What if…: all 153 precomputed runs (three named interventions and a
  material-efficiency grid of 10 products × 5 regions × 3 cuts). The map keeps
  the 2011 flows and colours them by the run's change; a scrubber replays the
  change from the 2011 baseline, and five cards split it by continent.
- Details: a Sankey (released in → industry → consumed in), the same flows as
  a sortable table, and the method with every check.
- A phone layout with the selection in a bottom sheet.
- The embodied flows for every run as one Parquet file (the `data-2011`
  release asset), read in the browser by HTTP range request: about 0.7 MB of
  51.5 MB on first load, about 0.33 MB per further run.
- The whole view in the query string, so every view can be shared. Links of
  the form `?scenario=&indicator=&region=` still work.

[Unreleased]: https://github.com/simonvanlierde/ramascene-explorer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/simonvanlierde/ramascene-explorer/releases/tag/v0.1.0
