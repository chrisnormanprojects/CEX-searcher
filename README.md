# CeX Bargain Finder UK

A mobile-first bargain finder covering CeX UK's category catalogue.

## Current scope

- Discovers the current CeX UK department, product-line and category structure from CeX metadata
- Covers all categories returned by that metadata rather than a single fixed category
- Catalogue generated automatically by GitHub Actions
- Products priced at **£50 or less**
- Search by product/model/name locally in the browser
- Department and category filters
- Cheapest-first, rating and A–Z sorting
- Online stock plus named CeX store availability where supplied by the search catalogue
- CeX cash and voucher trade-in values
- Direct links back to CeX product pages

## Data pipeline

CeX's older `wss2.cex.uk.webuy.io/v3/boxes` search endpoint returns HTTP 403 from GitHub-hosted runners. The current CeX web search uses an Algolia-compatible endpoint at:

`https://search.webuy.io/1/indexes/*/queries`

The fetcher first reads CeX's current super-category, product-line and category metadata. It then sends **batched Algolia queries** for every discovered category. Each query is filtered to products priced at £50 or less, and categories with more than one page of bargains are paginated automatically.

The primary search index is CeX's price-ascending `prod_cex_uk_price_asc` replica. If that fails, the fetcher automatically retries the catalogue with the generic `prod_cex_uk` index while keeping the same numeric price filter. Batching means hundreds of CeX categories can be refreshed with far fewer network requests than making one HTTP request per category page.

The generated `data/catalog.json` includes the current department/category hierarchy as well as the bargain products, so the static frontend can build its filters without making any CeX requests in the visitor's browser.

## Sources researched

Before settling on the current pipeline, the project was cross-checked against several independent implementations and community reports:

- `Dionakra/webuy-api` and maintained forks document the older CeX `/v3` endpoints, category IDs and response fields.
- `rorycl/cexfind` documents real-world Cloudflare blocking when CeX searches are made from cloud-hosted infrastructure.
- Other GitHub CeX integrations capture the site's `search.webuy.io`/Algolia responses and use the `prod_cex_uk` index.
- Reddit CeX developer discussions independently identify Algolia as the current search backend and report the same 403/cloud-hosting problems with older approaches.
- CeXDB is an independent CeX catalogue/price-history service and is useful as an external sanity check, but no documented public API suitable for this project was found, so the app does not depend on it.
- Third-party hosted scrapers such as Apify exist, but adding an external scraper dependency is unnecessary while CeX's own search feed remains accessible.

The project intentionally does **not** depend on public CORS proxies or an undocumented third-party private API.

## Automatic updates

`.github/workflows/update-cex-data.yml` runs hourly at minute 17 and whenever the fetch script or workflow changes. It refreshes `data/catalog.json` and commits changed data back to `main`.

The frontend is static GitHub Pages and reads the generated JSON, so normal visitors do not make CeX API calls themselves.

## Reliability

This uses endpoints consumed by CeX's own web applications, not a documented public developer API. Their schema, index names or access rules may change. The workflow fails rather than silently replacing a good catalogue with an empty one.

## GitHub Pages

The site runs directly from the repository root on GitHub Pages using the `main` branch and `/(root)`.

## Disclaimer

Independent utility. Not affiliated with or endorsed by CeX. Prices and availability can change quickly; confirm on the official CeX website before purchasing or travelling.
