# CeX PCI-Express Graphics Card Bargain Finder UK

A mobile-first bargain finder focused on CeX UK's PCI-Express graphics-card catalogue.

## Current scope

- CeX category **892 — PCI-Express Graphics Cards** only
- Catalogue generated automatically by GitHub Actions
- Products priced at **£50 or less**
- Search by model/name locally in the browser
- Cheapest-first, rating and A–Z sorting
- Online stock plus named CeX store availability where supplied by the search catalogue
- CeX cash and voucher trade-in values
- Direct links back to CeX product pages

## Data pipeline

CeX's older `wss2.cex.uk.webuy.io/v3/boxes` search endpoint returns HTTP 403 from GitHub-hosted runners. The current CeX web search uses an Algolia-compatible endpoint at:

`https://search.webuy.io/1/indexes/*/queries`

The scheduled fetcher first queries CeX's price-ascending index `prod_cex_uk_price_asc`, filters to category 892 and walks the cheap end of the catalogue until results are above the £50 ceiling.

If that price-sorted replica stops working, the fetcher automatically falls back to the generic `prod_cex_uk` index with an Algolia numeric filter for `sellPrice <= 50`. This avoids depending on one replica/index name.

The older metadata endpoint is still used when available to confirm the category name and overall category count, but metadata failure no longer prevents a catalogue refresh. The search feed and metadata count can differ because the live search index applies web visibility/search rules.

## Sources researched

Before settling on the current pipeline, the project was cross-checked against several independent implementations and community reports:

- `Dionakra/webuy-api` and its maintained forks document the older CeX `/v3` endpoints, category IDs and response fields.
- `rorycl/cexfind` documents real-world Cloudflare blocking when CeX searches are made from cloud-hosted infrastructure.
- Other GitHub CeX integrations capture the site's `search.webuy.io`/Algolia responses and use the `prod_cex_uk` index.
- Reddit CeX developer discussions independently identify Algolia as the current search backend and report the same 403/cloud-hosting problems with older approaches.
- CeXDB is an independent CeX catalogue/price-history service and is useful as an external sanity check, but no documented public API suitable for this project was found, so the app does not depend on it.
- Third-party hosted scrapers such as Apify exist, but adding a paid/external scraper dependency is unnecessary while CeX's own search feed remains accessible.

The project intentionally does **not** depend on public CORS proxies or an undocumented third-party private API.

## Automatic updates

`.github/workflows/update-cex-data.yml` runs hourly at minute 17 and whenever the fetch script or workflow changes. It refreshes `data/catalog.json` and commits changed data back to `main`.

The frontend is static GitHub Pages and reads the generated JSON, so normal visitors do not make CeX API calls themselves.

## Reliability

This uses endpoints consumed by CeX's own web applications, not a documented public developer API. Their schema, index names or access rules may change. The workflow deliberately fails rather than silently publishing an empty catalogue when no product rows are returned, which leaves the last good catalogue in place.

## GitHub Pages

The site is designed to run directly from the repository root on GitHub Pages using the `main` branch and `/(root)`.

## Disclaimer

Independent utility. Not affiliated with or endorsed by CeX. Prices and availability can change quickly; confirm on the official CeX website before purchasing or travelling.
