# Retailer price sources and storage

Stretch keeps online catalog prices separate from prices confirmed for a physical branch. A catalog result cannot complete a branch basket or establish that a nearby store has that item in stock. The comparison flow validates source ownership before showing a product under a retailer.

The active public sources in `lib/retailer-scraper.ts` are Lidl's product tiles, Trader Joe's catalog, The Fresh Market's observed listings and weekly offers, and Publix's public weekly ad. Publix's `lib/scrapers/publix.ts` adapter reads the website-selected store number and only accepts current, unconditional package prices with one explicit size. It checks robots rules, caps requests and bytes, handles cancellation, and caches for five minutes. Its prices are catalog references, not proof of a nearby branch's shelf price. Hosted providers and Kroger's branch-specific Products API remain separate paths in the existing search orchestration.

`lib/scrapers/` also contains adapters, a registry and a conservative Schema.org Product/Offer parser from the pricing branch. These are available for future retailer migration, but the current search endpoint does **not** route all retailers through that registry. Adding a registry entry alone does not make a source live. Each new source must be connected to the search path, tested for source ownership, and labeled with its actual price scope.

The server-only persistence layer in `lib/scrapers/persistence.ts` saves a single eligible price per location and requested package. It requires a source timestamp and URL where available, rejects stale or mismatched products, and never copies catalog prices to a branch. Apply `supabase/migrations/202610100003_modular_scraper_prices.sql`, then `202610100005_store_location_key.sql`, after the earlier migrations. The `004` migration from the pricing branch was superseded by `005` and is intentionally absent. Configure `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` on the server; do not put that key in the browser.

`store.location_key` is the canonical identity, with `product.location_key` referencing it. Numeric `locationID` values remain compatibility aliases. A branch key contains the retailer and native or mapped location ID; a catalog key contains the retailer and search ZIP. The read endpoint accepts either `locationKey` or the legacy `locationId`:

```text
GET /api/live/prices?locationKey=kroger%3Abranch%3A1100672
```

The public Publix parser and adapter have fixture tests in `tests/publix.test.ts`. An optional live-network smoke test can be run with `STRETCH_PUBLIX_LIVE_SMOKE=1`; it is not part of the normal test suite and can fail when the retailer changes its site or access rules. No live price is fabricated when a source cannot be read.
