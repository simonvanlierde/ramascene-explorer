# Other input-output databases: licences and terms

The explorer reads EXIOBASE v3.3.sm. [Issue #89](https://github.com/simonvanlierde/ramascene-explorer/issues/89) asks about a second database, including a physical input-output table. This page lists what each candidate's licence says about publishing results, redistributing the arrays and attribution, and how its regions and sectors differ from the explorer's layout. It states the terms. It is not legal advice. Every access date is 2026-11-15. "Unconfirmed" marks a fact that no reachable primary source settled.

## Comparison

| Database | Licence | Publish derived results | Redistribute the arrays | Regions and sectors | Latest |
|---|---|---|---|---|---|
| EXIOBASE v3.3.sm (in use) | As the repo uses it today | Yes, as the explorer does | Yes, as the explorer does | 49 regions, 200 products | v3.3.sm |
| EXIOBASE v3.8.2 | CC BY-SA 4.0 | Yes, share-alike | Yes, share-alike | 49 regions, 200 products | v3.8.2 |
| EXIOBASE 3.9 and later | Customised CC BY-SA-NC derivative, material extensions CC BY-SA | Multipliers need the publisher's permission | Not without permission | 49 regions (44 countries + 5 rest-of-world) | 3.11.2, 2026 |
| BONSAI | Data CC BY 4.0, code MIT | Yes, attribution only | Yes, if the release is under that licence (unconfirmed per release) | Unconfirmed; prototype reported at about 49 regions, about 1,700 products | No dated release found |
| GLORIA | No licence text found; free for download, commercial use licensed | Unconfirmed | Unconfirmed | 164 regions, 97 or 120 sectors | v060; v061 planned late 2026 |
| FIGARO (Eurostat) | Eurostat reuse policy, no named licence | Yes, with source acknowledged | Yes, with source acknowledged (non-EU data: unconfirmed) | 49 countries + rest of world, 64 products, 64 industries | 2026 release, 2010-2024 |
| EXIOBASE hybrid v3.3.18 (physical units) | CC BY 4.0 | Yes, attribution only | Yes, attribution only | 49 regions, 200 products, 163 industries | v3.3.18 |
| FABIO (physical, food and forestry) | CC BY-NC-SA 4.0 | Non-commercial, share-alike | Non-commercial, share-alike | 192 regions, 125 commodities | v1.1, 2020 |

The EXIOBASE rows repeat the wording in the [roadmap](roadmap.md). For 3.9.6 the Zenodo record says derived results may be published under any licence with attribution, as long as they carry no coefficients or raw data points, and that building a competing multiplier database needs written permission. Read that record before relying on the shorter line above.

## BONSAI

- **Licence.** The site footer says data is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and code under MIT ([bonsai.uno](https://bonsai.uno/)). The workflow repository is MIT ([GitLab](https://gitlab.com/bonsamurais/bonsai/build/hybrid_sut)).
- **Derived results and arrays.** CC BY allows both with attribution and has no share-alike. The project's [licence policy](https://github.com/BONSAMURAIS/bonsai/wiki/Licenses) (2019, "could be changed") adds that single data points may carry stricter terms and a query takes the strictest one.
- **Unconfirmed.** Whether a full supply-use or input-output table can be downloaded, as opposed to footprints. The prototype built on EXIOBASE hybrid v3.3.17 ([conversion software](https://github.com/BONSAMURAIS/EXIOBASE-conversion-software)), which is CC BY 4.0, so inherited terms look compatible. No dated release or region and sector counts were found.

## GLORIA

- **Licence.** The IELab page says all data can be downloaded and that licences for commercial use come from [FootprintLab](https://www.footprintlab.io) ([IELab GLORIA page](https://ielab.info/labs/ielab-gloria), [resource page](https://ielab.info/resources/gloria)). No licence text or terms of use were found, so publication, redistribution and attribution terms are unconfirmed.
- **Layout.** The [technical documentation](https://ielab.info/assets/resources/Technical_Documentation_GLORIA_20210913.pdf) (September 2021) lists 164 regions, 97 sectors and years 1990-2019. The [release 059 note](https://isa.sydney.edu.au/wp-content/uploads/2024/12/MRIO_excerpt_ReleaseNote059.pdf) gives 164 regions and 120 sectors. The sector count for v060 is unconfirmed.
- **Version.** v060 is available. The IELab page says v061 is planned for late 2026 and will supersede v060. The year of v060 is unconfirmed.

## FIGARO

- **Terms.** Eurostat's [reuse policy](https://ec.europa.eu/eurostat/help/copyright-notice) allows commercial and non-commercial reuse of statistical data with the source acknowledged and no written licence. It lists non-commercial-only exceptions, among them data for countries outside the EU, EFTA and candidate countries. FIGARO includes such countries (for example China, the United States and Japan). Whether the exception reaches FIGARO is unconfirmed: the [dataset metadata](https://ec.europa.eu/eurostat/cache/metadata/en/naio_10_fcp_esms.htm) names no licence and no restriction.
- **Layout.** 49 countries plus a rest-of-world region, 64 products (CPA 2.1) and 64 industries (NACE Rev. 2). The 2026 release covers 2010-2024 and Eurostat releases each July. The [JRC page](https://joint-research-centre.ec.europa.eu/scientific-activities/trade-and-industrial-policy-analysis/input-output-accounts/figaro-tables_en) is older and lists the 2024 edition with fewer countries.
- **Attribution.** Cite the dataset by its DOI, per the reuse policy.

## Physical tables

- **EXIOBASE hybrid.** Monetary and physical flows in one system: mass, energy in TJ, services in million euro. Version 3.3.18 is [CC BY 4.0](https://zenodo.org/records/7244919) (open download, 803 MB, 163 industries by 200 products, 44 countries plus five rest-of-world regions, 2011 tables). A consequential-system variant is [CC BY-SA 4.0](https://zenodo.org/records/13449634). Both Zenodo records say a newer version exists, without naming it.
- **FABIO.** Physical supply-use and input-output tables for agriculture and forestry, 192 regions, 125 commodities, 1986-2013, [CC BY-NC-SA 4.0](https://zenodo.org/records/2577067). The non-commercial and share-alike terms are the strictest here, and it covers only one part of the economy.
- **Not found.** No other open, global, multi-regional physical table covering the whole economy turned up.

## What this means here

The browser data fixes the layout at 49 regions by 15 sections. A database with other regions (GLORIA, FIGARO, probably BONSAI) cannot appear on the map, the Strip or the Sankey without changing that layout. The EXIOBASE hybrid tables share its 49 regions and 200 products, so they are the one candidate whose shape matches. Whether the engine can read them is unchecked. The hard-coded sizes are in `openEngine` in `browser-data.js`, `FLOW_TOTALS` in `browser-engine.js`, `pipeline/precompute.py`, `pipeline/export_browser.py`, `geo/` and `src/lib/map.js`.

The project's current position is licence research only. It adds no second database and lifts none of those sizes until a database is chosen. The two routes then are a second database in custom runs without the map, or a wider layout.
