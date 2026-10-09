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

Supabase serves the sample public catalog only. Grocery lists and preferences remain in browser memory; checklist downloads are created locally. Public users have SELECT access only; INSERT, UPDATE, and DELETE are revoked and protected by RLS. Live lookups send the selected general area to Overpass/Google and entered ZIP/search terms to the chosen retailer API via the server. They do not request precise device location or send the sample basket to providers.

## Checks

`npm test`, `npm run typecheck`, `npm run build`, `npm audit`.

Tests cover optimizer calculations, quantities, missing items, dietary conflicts, and split-store savings. PGlite applies the actual SQL setup and checks anonymous/authenticated reads and denied writes; this is a local SQL verification, not a hosted Supabase test.

## Deployment

Import the repository into Vercel with its Next.js preset and configure the two environment variables. No live routing provider is required for the sample demo. Old static files are kept in `archive/`.

[Selected Draft C](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)
