# To do

Deferred from the v0.1.0 pre-release review. Release steps themselves are in
docs/publishing.md.

## After the v0.1.0 release

- Add the Zenodo DOI badge to the README and the DOI to CITATION.cff, once
  Zenodo has minted it.
- Put the GitHub Pages URL in the README, the repo's website field and
  CITATION.cff (`url:`), and confirm range requests on Pages:
  `curl -sI -H 'Range: bytes=0-1' <pages url>/data/embodied.parquet` gives 206.
- Restrict the `github-pages` environment to deployments from main (repo
  settings).

## 0.1.x

- Page: the What if… sidebar is long at desktop width; group or collapse the
  run picker once a run is chosen.
- Page: the flat map and the globe can show a different number of bands
  (a partner inside the collar is dropped on one, not the other).
- Page: with "Its consumption", the Sankey's right column is a single node;
  consider splitting it by final-demand category.
- Code: the live panel (`?api=`) still formats with explorer.js's own units
  and wording; move it onto flows.js and drop the duplicate (needs the job
  API to test against).
- Code: map.js keeps its own copy of the 49 regions; read them from the
  Parquet footer instead.
- Code: `wording()` falls back to GHG for an unknown indicator id; derive the
  unit from `meta.indicators` instead.
- Code: the interface colours `--self` and `--acc` repeat `SELF` and `BAND`
  in flows.js; keep one source.
- Tests: a browser test for a fast run switch (A then B, A slow), phone touch
  targets of 44 px, and axe on the popovers, the globe and the Sankey tab.
- Tests: pin `fitExtent` with a hand-built selection.
- CI: keep the release asset's SHA-256 in one file used by both workflows;
  pin the exact pnpm version.
- Precompute: decide whether `--out-regions` and `--out-flows` are still
  worth writing now that the page reads only the embodied flows.
