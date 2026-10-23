# To do

## After the v0.1.0 release

- Open the published page on a real iPhone and an Android phone (the tests run
  WebKit and Chromium device emulation, not the real browsers), and share the
  link once in Slack or LinkedIn to see the preview card. On the phones, also
  try the pinch zoom, which the tests cannot.

## Maintainer decisions

- 2026-10-23: name who takes over if the maintainer stops (a second person with
  write access, or how long without activity before the repository is
  archived), then update the last section of `GOVERNANCE.md`.
- 2026-10-23: decide whether code of conduct reports get their own contact,
  such as an email address. `CODE_OF_CONDUCT.md` now routes them to a private
  security advisory, and reports about the maintainer to GitHub.

## With the next data release

- Split the Sankey's consumption side by final-demand category (households,
  government, investment). The Parquet keeps one consumer column per country,
  so this needs a new layout (about seven times the 51.5 MB) and a fresh engine
  run; worth doing together with a newer EXIOBASE vintage.

## Decided

- 2026-10-18: the precompute keeps writing `regions.json` and `flows.json`.
  The embodied flows are checked against that per-country run, and both files
  are small; the page does not read them.
