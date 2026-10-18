# To do

## After the v0.1.0 release

- Add the Zenodo DOI badge to the README and the DOI to CITATION.cff, once
  Zenodo has minted it.
- Put the GitHub Pages URL in the README, the repo's website field and
  CITATION.cff (`url:`), and confirm range requests on Pages:
  `curl -sI -H 'Range: bytes=0-1' <pages url>/data/embodied.parquet` gives 206.
- Restrict the `github-pages` environment to deployments from main (repo
  settings).
- Open the live page on a real iPhone and an Android phone (the tests run
  WebKit and Chromium device emulation, not the real browsers), and share the
  link once in Slack or LinkedIn to see the preview card.

## With the next data release

- Split the Sankey's consumption side by final-demand category (households,
  government, investment). The Parquet keeps one consumer column per country,
  so this needs a new layout (about seven times the 51.5 MB) and a fresh engine
  run; worth doing together with a newer EXIOBASE vintage.

## Decided

- 2026-10-18: the precompute keeps writing `regions.json` and `flows.json`.
  The embodied flows are checked against that per-country run, and both files
  are small; the page does not read them.
