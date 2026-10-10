# Store scrapers and saved prices

`lib/scrapers/index.ts` is the adapter registry. A registered store library wins;
all other retailers use `defaultScraper`. The default uses the existing hosted
collector when configured, or extracts Schema.org Product/Offer JSON-LD from
verified product pages. It requires an explicit USD package price and package
size. Aggregate, ambiguous, conditional, unowned, and out-of-stock offers are
discarded. Public fetching checks robots rules, limits response size and request
volume, and honors cancellation. It cannot guarantee prices from sites that
block requests or require a store/session to display prices.

The built-in libraries are Lidl, Trader Joe’s, Fresh Market, and Kroger. Kroger
implements the optional `checkBranches` method through its Products API. Branch
matching retains its exact physical location checks and pagination/request caps.
“Lowest” means the lowest eligible price among the returned candidates, not a
guarantee that every product in the retailer's inventory was searched.

## Add a store

1. Add the verified domains to `lib/retailer-sources.ts`. Marketplace domains also
   need their store path in `instacartSlugs`. Configure discovery product paths in
   `validDiscoveredSource` if the website uses a different product URL structure.
   Add the store name to `retailerName` if map discovery doesn't recognize it.
   This is enough to use the default scraper; no custom HTML parser is required.
2. If a library or custom parser is available, implement `RetailerScraper` from
   `lib/scrapers/types.ts`, then add one entry in `lib/scrapers/index.ts`.
3. Return `ScrapeReport` for online catalogs. Use `checkBranches` and `StoreCheck`
   only for prices verified for a specific branch. Set `sourceLocationId` to the
   retailer's native branch ID when available. Retain source timestamps and URLs.

The main search and manual provider refresh save verified results using Next's
`after` lifecycle. Database writes run after the response, including a timed-out
stream, without consuming the four-second price-search window. Save failures are
reported in the server log; search results remain available.

## Supabase

Apply `supabase/migrations/202610100003_modular_scraper_prices.sql` followed by
`202610100004_store_location_key.sql` after the prior store, metadata, date, and
dietary migrations. Configure server-only
`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_URL`. No public endpoint accepts caller-supplied prices.

The existing **`store` table is the location table**. **`store.location_key` is its
primary key**, and `product.location_key` is the foreign key. The migration
backfills every numeric relationship to `store` and makes every `location_key`
column in other public tables reference that primary key. Orphans and conflicting
identities abort the migration. Existing IDs and prices are preserved.

Numeric `locationID` values remain unique compatibility aliases. New aliases
are negative database-assigned sequence values; Kroger retains its positive
native number when available. They are no longer foreign-key targets. A trigger
resolves older numeric writes to a canonical key and rejects mismatched keys and
aliases. Kroger tooling and the backend now write or join with `location_key`.

`store.location_key` combines retailer, price scope,
and source ID:

- `kroger:branch:1100672` — a native Kroger branch, including normalization of leading zeros.
- `target:branch:osm:node/123` — a physical branch identified by an OSM node.
- `trader-joes:catalog:zip:30303` — online catalog evidence for the search ZIP.

Catalog locations have no physical coordinates and are excluded from the
backend's branch offers. A catalog price is never copied into nearby branches.

Physical stores retain complete, valid explicit coordinate pairs from map or
retailer data. If either coordinate is missing or invalid, the shared
`lib/store-coordinates.mjs` resolver geocodes the full street address through the
[US Census geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html).
This applies to map discovery, Kroger branch matching, the Kroger CLI, and branch
price persistence. Census points are interpolated along address ranges, so a
Kroger response geocoded this way can also match a mapped branch by an identical
full address; the mapped coordinates then take precedence. Explicit retailer
coordinates retain the existing proximity check.

Geocoding requires a street number and city/state or ZIP, rejects ambiguous
matches and ZIP mismatches, times out after five seconds, caches successful
addresses for a day and unsuccessful lookups for five minutes, and permits at
most two concurrent requests. A physical branch whose coordinates cannot be
resolved is not saved with unlocated prices. An address fallback does not replace
a coordinate pair already saved for the branch: persistence checks the store
record before geocoding missing coordinates. Run `node scripts/geocode-stores.mjs`
from `frontend` to backfill existing physical stores that have an address but no
coordinates. It updates by `location_key`, preserves existing pairs, and reports
unresolved addresses. Online catalogs have no street address to geocode.
Primary keys, unique natural keys, immutable location identities, and an atomic
RPC prevent concurrent requests from overwriting a different store. The database
rejects an identity conflict rather than silently merging locations.

The shared persistence layer selects one lowest package price for each location,
food, and requested amount. Package size must match within the existing 2%
tolerance; unknown units, unrequested alternatives, weighted branch offers, and
observations older than 24 hours are excluded. `count` is the individual-item
count for count-based packages, otherwise one package. `unit_price` is dollars
per `unit_basis` (`each`, `oz`, or `fl oz`). A newer observation can replace an
older price, even when it rises. Older observations cannot overwrite newer ones;
at the same timestamp, the lower price wins. Unknown dietary flags remain null.

The `store_prices` view joins the location and product metadata for easy reads:

```sql
select * from public.store_prices
where location_key = 'kroger:branch:1100672'
order by category, requested_unit;
```

The app also exposes a read endpoint (`locationId` is supported as a legacy alias):

```text
GET /api/live/prices?locationKey=trader-joes%3Acatalog%3Azip%3A30303&productId=eggs
GET /api/live/prices?locationId=1100672
```

Returned prices include their source, observation time, package, and branch or
catalog scope, plus `latitude` and `longitude`. A missing row means no eligible
saved price; it is not zero.

After the first four-second comparison, the browser automatically checks slower
sources every three seconds for up to 90 seconds. Each check has the same bounded
response window. Existing hosted collection jobs are polled without restarting
them; sources missed while map discovery was still running are initialized once
they are discovered. Branch results are merged without clearing reviewed package
choices. Catalog and branch prices returned by these checks use the same Supabase
persistence and ownership validation as the initial search.

The retailer status panel includes nearby stores with no returned price and shows
pending, failed, unavailable, timed-out and no-match sources. Cancellation, a new
search, input changes and leaving the page stop automatic checks. Three consecutive
request failures also stop polling and expose a manual retry message. Unknown
prices remain excluded from comparisons and trip totals.
