# CeX Bargain Finder UK

Search CeX UK products priced at £50 or less. Choose a department and a category, then filter by name, price or availability. Select **All categories** to search the chosen department. Results display 100 at a time with a Show more button.

## Catalogue collection

The updater discovers departments, unique product lines and categories from CeX metadata. Metadata errors or the disappearance of previously published categories stop publication for review; partial discovery never silently removes categories.

CeX's search endpoint limits a query to 1,000 results. The updater recursively splits large queries using the source's available facets. Each split is a positive filter group plus its negative complement, so multi-valued facets do not create overlapping partitions and missing attributes remain covered. Leaves are below 1,000 results and every page must match its exact count. Approximate counts, unsplittable groups, source errors or incomplete pages cause the refresh to fail without committing data. The workflow retries up to three times.

Category counts show actual saved products. `sourceReportedListings` and `sourceCountExact` retain the source's separate count/estimate. `coverage: complete` means every collected partition passed its count check, not a guarantee that CeX's index contains every product CeX sells. The feed is live and can change during a refresh.

Products and category filters share one department mapping, reconciled against product `scId`. Conflicting assignments stop publication. Empty categories retain their metadata department. No historical category count (such as 540) is assumed to be current.

## Generated data

- `data/catalog.json`: schema version 2, refresh timestamp, category hierarchy, actual counts and shard filenames.
- `data/items/*.json`: up to 500 products per content-addressed file. Categories load independently, with four concurrent downloads.
- The previous manifest's shards remain for one further refresh so already-open pages have time to finish loading.
- The client cancels superseded loads and ignores stale responses. It renders only the first 100 matches initially.

Legacy department files remain readable by the client during migration. The first successful new refresh replaces them with category shards. Failed collection does not publish partial data.

## Updates and deployment

The workflow is scheduled hourly at minute 23 UTC, supports manual runs and runs after script/workflow changes. GitHub scheduling may be delayed or skipped; this is not a guaranteed hourly service. The site displays the real data age and flags data older than two hours. It does not call stale data live.

The workflow validates collection logic, fetches and checks data, then commits only after success. GitHub Pages publishes the root of `main`. Existing push/rebase retries handle concurrent commits. No additional external scheduler or credentials are required.

## Verification

Run `node --test scripts/catalogue-core.test.mjs` and `node --check app.js`. A production refresh must complete successfully before updated catalogue coverage can be claimed.

## Sources and limitations

Metadata: `https://wss2.cex.uk.webuy.io/v3`.
Search: `https://search.webuy.io/1/indexes/*/queries`, index `prod_cex_uk_price_asc`.
These are endpoints used by CeX's web applications, not a documented public developer API. Access or schema changes can prevent a refresh. No CORS proxy or paid third-party scraper is required. Prices and stock are snapshots; confirm at CeX before purchasing or travelling.

Independent utility. Not affiliated with or endorsed by CeX.
