# CeX Bargain Finder UK

A mobile-first CeX UK stock and bargain search tool.

## Features

- Search CeX UK products
- Maximum-price filtering
- Gaming, Film & TV, Computing, Phones, Electronics and Music filters
- Online-stock-only option
- Cheapest-first, rating and A–Z sorting
- CeX cash and voucher trade-in values
- Nearby store stock lookup using browser location permission
- Direct links to CeX product pages
- Short browser-side caching to reduce repeated requests

## Data source

This project uses the internal JSON endpoints used by CeX's web applications, including `/v3/boxes` for search and `/v3/boxes/{sku}/neareststores` for nearby availability. These endpoints are not presented as a public developer API, so behaviour can change without notice.

Because GitHub Pages is static and CeX may not permit cross-origin browser requests, the app tries the CeX endpoint directly and then falls back to public CORS proxy services. For a more reliable production version, replace this with a small controlled server/Cloudflare Worker and cache responses responsibly.

## GitHub Pages

The site is designed to run directly from the repository root on GitHub Pages. In repository Settings → Pages, choose **Deploy from a branch**, select **main** and **/(root)**.

## Disclaimer

Independent utility. Not affiliated with or endorsed by CeX. Stock and prices can change quickly; confirm on the official CeX website before travelling or purchasing.
