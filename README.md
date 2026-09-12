# CeX PCI-Express Graphics Card Bargain Finder UK

A mobile-first bargain finder focused on CeX UK's PCI-Express graphics-card catalogue.

## Current scope

- CeX category **892 — PCI-Express Graphics Cards** only
- Catalogue generated automatically by GitHub Actions
- Products priced at **£50 or less**
- Search by model/name locally in the browser
- Cheapest-first, rating and A–Z sorting
- Online/store availability where supplied by CeX
- CeX cash and voucher trade-in values
- Direct links back to CeX product pages

## Data pipeline

CeX's older `wss2.cex.uk.webuy.io/v3/boxes` search endpoint returns HTTP 403 from GitHub-hosted runners. The current CeX web search instead uses an Algolia-compatible endpoint at:

`https://search.webuy.io/1/indexes/*/queries`

The scheduled fetcher queries the CeX price-ascending index `prod_cex_uk_price_asc`, filters to category 892, paginates through the cheap end of the catalogue, normalises the returned records and writes `data/catalog.json`.

The metadata endpoint is still used to confirm the current CeX category name and overall category count. The search feed and metadata count can differ because the Algolia index applies web visibility/search rules.

## Automatic updates

`.github/workflows/update-cex-data.yml` runs hourly at minute 17 and whenever the fetch script or workflow changes. It refreshes `data/catalog.json` and commits changed data back to `main`.

The frontend is static GitHub Pages and reads the generated JSON, so normal visitors do not make CeX API calls themselves.

## Reliability

This uses endpoints consumed by CeX's own web applications, not a documented public developer API. Their schema, index names or access rules may change. The workflow deliberately fails rather than silently publishing an empty catalogue when no product rows are returned.

## GitHub Pages

The site is designed to run directly from the repository root on GitHub Pages using the `main` branch and `/(root)`.

## Disclaimer

Independent utility. Not affiliated with or endorsed by CeX. Prices and availability can change quickly; confirm on the official CeX website before purchasing or travelling.
