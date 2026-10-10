# Stretch

Next.js App Router + React + TypeScript + Supabase. Selected design: Draft C; original PNG logo preserved.

## Run

Node 20.9+ required. Run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Open http://localhost:3000.

## Supabase setup

Run `supabase/setup.sql` once in the project's SQL Editor against an empty project. It creates tables, read-only public policies, and 30 products / 90 sample offers. Alternatively, apply `supabase/migrations/202610090001_catalog.sql` and then `supabase/seed.sql` through your migration workflow.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then restart Next.js. The comparison panel should say **Catalog connected to Supabase**. No service-role key is needed. Credentials are ignored by Git.

Without a key the app explicitly uses its built-in demo catalog. A database failure displays a warning and falls back to demo data.

The Stretch project was connected and verified on October 9, 2026: 30 products, 3 stores, 90 sample offers, and 6 substitutions. Local `.env.local` contains the public connection settings and is ignored by Git; each teammate or deployment must configure their own environment.

## Features

- Whole-basket optimization across one and two stores, including round-trip fuel.
- Product search, quantities, area, budget, MPG, gas price, and maximum stops.
- Optional dietary/budget substitutions with package differences, savings, and undo.
- Per-store checklists, check-off controls, and downloadable text plan.
- Missing items excluded from cheapest ranking; timestamp and stale-price labels.
- Responsive Draft C landing page and interactive planner; no account required.

## Live sources

The **Meet your neighborhood** section adds real data without relabeling the sample basket as live:

OpenStreetMap is the default map and location source. **Find gas stations** works without Google credentials: choose a 1, 2, 3, 5 or 10-mile radius and see mapped fuel stations, a radius circle and clickable markers on a Leaflet map. Store discovery also renders an OSM map. OSM supplies locations, not a live pump-price feed; those stations display “Price not supplied by OpenStreetMap.” Google prices are an optional, separate lookup inside the expandable panel. No regional average is substituted. Distances are measured from the named area's predefined center, not a device's location.

- `GET /api/live/local-fuel?area=downtown&radius=3&type=REGULAR_UNLEADED`: Google Places (New) nearby stations and reported pump prices, where supplied. Radius choices are 1, 2, 3, 5 and 10 miles around the selected Atlanta area center; grades are regular, midgrade, premium or diesel. Returns up to 20 nearest provider results, sorted by usable reported price, not every station or a guaranteed regional minimum. Missing prices remain unknown. Reports older than 48 hours, without a timestamp or in the future cannot be applied. No Google Places response is cached or persisted. Requires `GOOGLE_MAPS_API_KEY` and `GOOGLE_PLACES_ENABLED=true`, Places API (New) enabled, and billing. Requests with `fuelOptions` may incur the applicable Google SKU; configure quota and spending limits before enabling. Adapter is fixture-tested and awaiting credentials/live verification. Selecting a station price estimates fuel consumed; its gas-stop detour is not added to the sample route.
- `GET /api/live/fuel`: optional EIA weekly regional publication retained as a separate backend utility. It is not used by local gas search or substituted for missing station prices. No key needed; six-hour cache, rejects publications over 21 days old.
- `GET /api/live/places?area=downtown|midtown|decatur&radius=1..10&kind=all|grocery|fuel`: OpenStreetMap Overpass nearby locations. Default radius is five miles and kind is all. Filters center coordinates to the exact radius and requested kind before limiting to 60 nearest results. Returns map-data timestamp, map links and straight-line distances. Does not supply prices, live inventory, driving routes or complete store coverage. Results cache for an hour per area/radius/kind.
- `GET /api/live/kroger?zip=30303`: Kroger-family location discovery. `?locationId=...&term=milk` returns exact package variants, UPCs, regular and promotional prices when supplied. Missing prices stay unknown, not zero. Prices cache for five minutes; store queries for an hour. Requires `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` from a registered Kroger developer app with Products/Locations access. OAuth client credentials and access tokens stay on the server. The adapter is implemented and fixture-tested; authenticated provider requests still require credentials and live verification.
- `GET /api/live/instacart?zip=30303`: participating **retailer brands**, not store addresses or basket prices. Requires an approved `INSTACART_API_KEY`; caches for an hour. Implemented and awaiting credentials/live verification.
- `GET /api/live/status`: returns only whether credentials are configured; this is not proof that a provider connection works.

Add server credentials to ignored `.env.local` and restart the app. Never use `NEXT_PUBLIC_` for provider secrets. API failures show explicit errors; no grocery prices are synthesized. Real product results are separate from fictional products because brand/package identity, sold-by units, dietary labels and real driving distances must be reconciled before a live basket can be ranked safely.

Other provider calls are coalesced and cached, with conservative process-local daily/minute caps (Overpass 90/day, EIA 12/day, others 800/day; 20/minute). Google Places responses are uncached. Before multi-instance production deployment, use a shared cache where permitted and global rate limiter and a production location/routing provider; process-local quotas reset on restart. Public Overpass capacity can be limited.

There is no universal verified connection to every grocery store. Unsupported retailers need licensed feeds or a retailer agreement. Do not treat Walmart Marketplace seller APIs or Instacart shopping links as public in-store price comparison feeds. Google Places may not report prices for every station; broader licensed coverage can be evaluated through OPIS. Never invent missing station prices.

Sources: [EIA fuel publication](https://www.eia.gov/petroleum/gasdiesel/), [Kroger developer portal](https://developer.kroger.com/), [Kroger official API workspace](https://www.postman.com/kroger/the-kroger-co-s-public-workspace/documentation/qg005u4/kroger-knowledge-check-answers), [Instacart nearby retailers](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers), [OpenStreetMap Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).

## Sample data and privacy

Map display uses Leaflet 1.9.4 with public OSM raster tiles, visible contributor attribution, default browser caching/referrer behavior, no bulk downloads or tile prefetching, and accessible location links alongside markers. Set `NEXT_PUBLIC_MAP_TILE_URL` to change the tile service; ensure its required attribution is supported before using a different provider. Public tiles have no SLA; review [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) before production use. The map viewport is sent to the tile service when the map is displayed.

Local fuel setup: [Google API keys](https://developers.google.com/maps/documentation/places/web-service/get-api-key), [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search), [fuel price fields](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#FuelOptions). The Google connection needs a user-configured developer project; this repository does not create a billing account or accept provider agreements. The user must complete those steps and put the key in `.env.local`.

Prices and dietary tags are fictional sample data recorded October 9, 2026. Routes use illustrative area-based distances, not live navigation. Tax is excluded. Time assumes 25 mph plus 12 minutes per stop. Substitutions are not nutritional equivalents; confirm product labels.

Supabase serves the sample public catalog. The optional Kroger CLI saves the cheapest live item/store winners in the existing singular product table using a server key. Grocery lists and preferences remain in browser memory; checklist downloads are created locally. Public catalog users have SELECT access only; INSERT, UPDATE, and DELETE are revoked and protected by RLS. Live lookups send the selected general area to Overpass/Google and entered ZIP/search terms to the chosen retailer API via the server. They do not request precise device location or send the sample basket to providers.

## Save the cheapest Kroger item at three nearby stores

The CLI writes winners to `product` and branch names to the dedicated `store` table (both lowercase, singular). Apply `supabase/migrations/202610090002_product_store.sql` once in the Supabase SQL Editor on an existing database. This transaction validates and copies distinct store names, adds the foreign key, and removes the copied columns from `product`. Product columns are `ID` (numeric primary key), `category`, `count`, `price`, `unit_price`, and `locationID`. Then apply `supabase/migrations/202610090003_store_metadata.sql` to add optional coordinates and an address. Store columns are `locationID` (numeric primary key), `store`, `sub-location`, `latitude`, `longitude`, and `address`; `product.locationID` references `store.locationID`. The existing plural sample-catalog tables are separate.

Set `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) in ignored `.env.local`. The existing Next.js environment loader is used; no additional packages or running app server are needed.

```powershell
npm run kroger:save -- --item "whole milk"
# Preview without saving:
npm run kroger:save -- --item "whole milk" --dry-run
# Optional category and location overrides:
npm run kroger:save -- --item "whole milk" --category Dairy
npm run kroger:save -- --item "eggs" --category Dairy
# Prefer 12 eggs; if unavailable, accept 8–16:
npm run kroger:save -- --item "eggs" --amount 12 --category Dairy
npm run kroger:save -- --item "whole milk" --amount "1 gal" --category Dairy
npm run kroger:save -- --item "whole milk" --lat 33.75 --lng -84.39
npm run kroger:save -- --item "whole milk" --zip 30303
```

The default location is estimated from the public IP of the machine running the script. It tries ipapi.co and then [ipwho.is](https://ipwhois.io/documentation) on failure. The provider receives the public IP, and approximate coordinates are sent to Kroger. No browser location prompt is shown. The log identifies the source and approximate city/coordinates. VPNs, proxies, mobile networks and remote servers can affect the result. A failed lookup stops the script; no arbitrary ZIP is substituted. Explicit ZIP overrides use [Zippopotam.us](https://api.zippopotam.us/).

The terminal reports five steps: configuration, location/authentication, nearest-store discovery, paginated product searches, and saving. It searches 10, 25, 50, then 100 miles until three stores are found. Stores are filtered to the KROGER chain and sorted by straight-line distance. Fewer than three stores, missing coordinates and truncated location responses are reported.

Products must match the search words and Kroger's response `categories`. Without `--category`, the most common category among matching names at the first usable store is selected and reused at all stores. Duplicate labels do not increase the count; the merchandising label `Natural & Organic` is excluded from inference. Ambiguous category ties require `--category`; missing categories are skipped. Categories such as Dairy are broad, so name checks still reject yogurt, cheese and unrequested milk variants. Only one winning variety per item/store/requested amount is saved.

The winner has the lowest regular package price divided by normalized quantity. Plain milk searches use fluid ounces; plain eggs use count (price per egg). Egg labels with both count and total weight, such as `12 ct / 24 oz`, use the count for an `each` comparison. Other searches infer the measurement dimension, or require `--unit fl-oz`, `--unit oz`, or `--unit each` if ambiguous. Volume, weight and counts are never compared together. Gallons/pints, metric sizes, common fractions and explicit multipacks are recognized. Unknown sizes, unpriced/weighted products and reported out-of-stock packages are skipped. Promotional prices do not determine the winner. The log shows the winning product name, size, package price and unit price.

Use `--amount` to prefer a package size: exact sizes take priority, with the lowest unit price winning among them. If none are eligible at a store, packages within ±⅓ qualify (12 eggs allows 8–16), and the lowest unit price wins within that range. Packages outside the range are excluded. Numeric amounts use the item's comparison unit; include units for other items, such as `--amount "16 oz"`, or provide `--unit`. Equivalent measurements, such as one gallon and 128 fluid ounces, match. Omitting `--amount` compares all eligible sizes. Repeated runs for the same requested amount update that amount’s item/store row, including its package count; other searched amounts remain saved.

Kroger rejects product offsets above 250; with 50 products per page, a broad query can expose at most 300 results even when metadata reports more. Such runs log `SEARCH LIMITED`, save the cheapest eligible result among the returned matches, and return a partial-result status. They do not claim the lowest price across the unavailable matches. Other provider/page failures still prevent a winner being saved for the affected store.

Product columns:

- `category`: normalized generic item, such as whole milk. Kroger's category is used to validate matches, so different items within Dairy remain distinct.
- `count`: number of individual items in the package: 12 for a carton of 12 eggs, 1 for a gallon jug, 1 for a can of beans, or 6 for an explicit six-pack. Weight and volume are tracked separately during comparison and never written as the item count.
- `price`: regular package price in dollars.
- `unit_price`: dollars per US fluid ounce, ounce of weight, or each, as identified in the log. The existing table has no measurement-unit column; consumers must know the item's basis.
- `locationID`: numeric Kroger store ID; the numeric column omits leading zeros.

Store columns:

- `locationID`: primary key linked from `product.locationID`.
- `store`: brand name, `Kroger`.
- `sub-location`: branch name, such as `Ponce`, `Glenwood`, or `Edgewood`.
- `latitude` / `longitude`: Kroger location coordinates as double precision numbers, constrained to valid ranges and saved as a pair. Missing coordinates remain null.
- `address`: Kroger street address formatted as text, including optional second line, city, state, and ZIP. Missing addresses remain null.

Product identifier:

- `ID`: stable numeric identifier derived from item, store, and requested amount (including its measurement unit). Searches for 12 and 30 eggs save separate rows. Equivalent amounts such as one gallon and 128 fluid ounces share a row. A fallback package keeps the requested amount's identifier while `count` records its actual size. Repeating the same search updates only that search's winner; searches without `--amount` keep their separate overall-winner row. Existing rows are preserved. Conflicts with an unrelated existing row stop the save. The current schema has no requested-amount column; this distinction is encoded in `ID`.

Store metadata, including coordinates and street address from Kroger location results, is refreshed first in an upsert on `locationID`, followed by one product upsert on `ID`. A failed store save stops product writes. The two API requests are separate transactions; if the product save fails, store metadata may already be refreshed and a retry is safe. The foreign key prevents missing-store references and deletion of a referenced store. Partial runs save successful winners and report missing stores or limited search coverage. Exit codes: 0 = three winners from completed searches, 2 = partial/no winners or limited searches, 1 = configuration/provider/database failure. Tests cover category filtering, unit conversion, pagination, IP fallback, store migration, foreign keys, read-only public access, count-specific identifiers, and repeated writes. Live whole-milk and count-based egg queries, with three saved rows for each item in the existing product table, were verified on October 9, 2026.

Read a product with its store using Supabase `.from("product").select("*,store(store,sub-location,latitude,longitude,address)")`, or SQL:

```sql
select p.*, s.store, s."sub-location", s.latitude, s.longitude, s.address
from public.product p
join public.store s using ("locationID");
```

## Checks

`npm test`, `npm run typecheck`, `npm run build`, `npm audit`.

Tests cover optimizer calculations, quantities, missing items, dietary conflicts, and split-store savings. PGlite applies the actual SQL setup and checks anonymous/authenticated reads and denied writes; this is a local SQL verification, not a hosted Supabase test.

## Deployment

Import the repository into Vercel with its Next.js preset and configure the two environment variables. No live routing provider is required for the sample demo. Old static files are kept in `archive/`.

[Selected Draft C](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)

### Basket price agent and IP area detection

The "Check my list" flow searches up to ten basket items at up to two nearby Kroger locations, using the server-side Kroger adapter. Each package must be reviewed explicitly before a grocery subtotal is calculated; unknown prices, weighted products, and failed searches keep a basket incomplete. Regular prices are used, without assuming promotional eligibility. This is supported-provider search, not universal retailer scraping. Results do not verify stock or dietary suitability and do not yet include travel, taxes, or cross-store optimization. Kroger credentials remain required; no real price checks can run without them.

The browser requests https://ipapi.co/json/ to estimate its own public-IP location (rather than the server's location). Stretch does not persist the IP or the response. The UI selects the nearest supported Atlanta demo area only within 30 miles, labels this approximation, and preserves a manual choice if detection returns late. Outside coverage or on lookup failures, the manual selector remains available. VPN/mobile-network geolocation can be inaccurate. IP-based detection does not yet replace the three demo route origins with an arbitrary address.
