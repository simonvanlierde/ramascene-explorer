# To do

## After the v0.1.0 release

- Open the published page on a real iPhone and an Android phone (the tests run
  WebKit and Chromium device emulation, not the real browsers), and share the
  link once in Slack or LinkedIn to see the preview card. On the phones, also
  try the pinch zoom, which the tests cannot.

## With the next data release

- Split the Sankey's consumption side by final-demand category (households,
  government, investment). The Parquet keeps one consumer column per country,
  so this needs a new layout (about seven times the 51.5 MB) and a fresh engine
  run; worth doing together with a newer EXIOBASE vintage.

## Performance

- 2026-10-25: profile the moving map on a quiet machine (load under 2,
  interleaved against 4e40fb1, the commit before the thinned outlines)
  before quoting numbers for them. In the same pass, try clipping the
  projection to the view while zoomed (off-screen regions still build full
  path strings) and whether that lets the `zk < 2` gate go; check whether
  the band geometry and labels, recomputed every frame while moving, and
  the one full redraw 150 ms after it stops show up as long tasks. Keep
  only what measures better.

## Decided

- 2026-10-18: the precompute keeps writing `regions.json` and `flows.json`.
  The embodied flows are checked against that per-country run, and both files
  are small; the page does not read them.
