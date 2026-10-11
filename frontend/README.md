# Stretch

Next.js App Router + React + TypeScript + Supabase. Selected design: Draft C; original PNG logo preserved. Current scope: an Atlanta-area pilot that ranks only complete, branch-verified baskets. See [Version 1 audit and milestones](docs/mvp-audit.md) for source coverage and launch blockers.

## Run

Node 20.9+ required. Run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Open http://localhost:3000.

To run the production server locally, create the production build first:

```bash
npm ci
npm run build
npm start
```

`npm start` does not build the app automatically. It serves the existing `.next` output, so running it before `npm run build` causes Next.js to report that no production build was found. Use `npm run dev` for development.

## Supabase setup

The FastAPI bridge reads the existing `products`, `product`, and `store` tables. `product.id` joins to `products.id`, and `product.location_key` joins to `store.location_key`. Prices are converted from dollars to frontend cents; rows without a product or store mapping are skipped. Only branch locations enter the local catalog.

Apply `supabase/migrations/202610100004_modular_scraper_prices.sql` followed by `202610100005_store_location_key.sql` after the existing migrations. These bring over the price persistence schema from `price-scrape-fix`: `store.location_key` becomes the primary key, all store references use it, and existing `locationID` values remain compatibility aliases. The server saves validated package winners after searches, comparisons, and provider refreshes through the service-role-only `save_store_prices` RPC. Set `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` on the server. Online catalog keys (for example, `target:catalog:zip:30303`) stay separate from branch keys (for example, `kroger:branch:1100672`). `store_prices` exposes the saved rows joined by `location_key`.

Run the FastAPI bridge from the repository root with `uvicorn backend.main:app --reload --port 8000` after copying `backend/.env.example` to `backend/.env` and setting its Supabase credentials. Set `BACKEND_API_URL=http://localhost:8000` in the frontend `.env.local`, then restart Expo/Next.js. The comparison panel should say **Catalog connected to Supabase**. Supabase credentials belong only to the backend; never expose a service-role key to the frontend.

Without a key the app explicitly uses its built-in demo catalog. A database failure displays a warning and falls back to demo data.

The Stretch project was connected and verified on October 9, 2026: 30 products, 3 stores, 90 sample offers, and 6 substitutions. Local `.env.local` contains the backend URL and is ignored by Git; each teammate or deployment must configure its own backend environment.

## Project status

Hacklanta prototype. The root project is the Next.js web application; a separate Expo / React Native prototype remains in `mobile/`.

## Selected design

**Draft C** is the selected direction. Preserve the original PNG logo and cream, olive, beige, and warm accent colors.

[Draft C in FigJam](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)

![Draft C](draft-c-final.png)

## Run the React Native app

Install dependencies with `npm install`, then run `npm start`. Use the Expo terminal shortcuts to open the app on iOS, Android, or web.

## Planned MVP

- Grocery list with quantities and dietary preferences.
- Budget, starting area, MPG, gas price, and maximum stops.
- Whole-basket and round-trip fuel comparison.
- One-store and two-store optimization with an item checklist per stop.
- Optional budget substitutions with quantity and savings explanations.
- Supabase tables for stores, products, offers, and price timestamps.

## Data limitations

Prices and distances in this prototype are illustrative sample data, not live store prices or navigation. Fuel estimates exclude tax and travel time. Do not present incomplete baskets as complete trip estimates.

## Configuration

Prices and dietary tags are fictional sample data recorded October 9, 2026. Routes use illustrative area-based distances, not live navigation. Tax is excluded. Time assumes 25 mph plus 12 minutes per stop. Substitutions are not nutritional equivalents; confirm product labels.

Supabase serves the sample public catalog only. Named grocery lists and preferences are saved locally on the user's device; the current trip is kept in session storage. Public users have SELECT access only; INSERT, UPDATE, and DELETE are revoked and protected by RLS. IP detection sends the visitor's IP to IPwhois (and ipify if needed); Stretch does not persist the IP. IP coordinates are approximate. Shoppers can choose an area or explicitly request their browser's device location for a more precise starting point; the browser shows an accuracy radius and asks for permission. Search coordinates go to the connected location provider. Basket item names go to connected pricing providers when "Check my list" is used, and the optional feed receives basket items plus discovered store names/addresses/IDs. General search results are cached in server memory as described above.

## Checks

`npm test`, `npm run typecheck`, `npm run build`, `npm audit`.

Tests cover optimizer calculations, quantities, missing items, dietary conflicts, and split-store savings. PGlite applies the actual SQL setup and checks anonymous/authenticated reads and denied writes; this is a local SQL verification, not a hosted Supabase test.

## Deployment

Import the repository into Vercel with its Next.js preset and configure the two public Supabase environment variables for the sample catalog. A live pilot also needs an authorized branch-price source; without one, Stretch reports unpriced stores rather than displaying demo prices as live results. See the [production readiness checklist](docs/production-readiness.md) before inviting real users. Old static files are kept in `archive/`.

[Selected Draft C](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)

### Basket price agent and IP area detection

The "Check my list" flow accepts up to 30 items and discovers every matching OSM grocery location within a selectable 1–10 mile radius, including all retailer brands and independent stores. Every returned store appears in a coverage list: price source checked, failed, or unavailable. An optional authorized multi-retailer price feed can price any mapped store; [feed contract](docs/grocery-price-feed.md). The Kroger adapter checks up to ten items at two coordinate-matched branches when its credentials are configured, fetching at most three 20-product pages per query before the request quota stops further collection. Unchecked branches and lines stay explicitly unpriced. Each package must be reviewed before a grocery subtotal is calculated. Complete branch-priced baskets receive a routed round-trip driving estimate and a food-plus-fuel ranking, using the selected gas stop when present. Unknown prices, weighted packages, failed routes and failed searches keep trips unranked; regular prices do not assume promotional eligibility. Results do not verify stock, dietary suitability, taxes or split-store optimization. **No universal grocery scraper or multi-retailer price supplier is currently connected.**

When `OPENROUTER_API_KEY` is configured, click **Ask AI for most economical route** in the Mix & Match planner. The planner queries its verified road route matrix first, then sends the candidate grocery/gas routes and user preferences to `/api/route-decision`. OpenRouter selects the lowest-cost eligible candidate between grocery stores, a gas station, or both and returns a short rationale. The server validates the response against candidate IDs, never exposes the key to the browser, and leaves the deterministic optimizer selected if OpenRouter is unavailable. Set `OPENROUTER_ROUTE_MODEL` to change the model; the default is `openai/gpt-4o-mini`.

The browser requests https://ipwho.is/ to estimate its own public-IP location. If that fails, https://api.ipify.org?format=json resolves the visitor's public IP, then `POST /api/location` resolves that exact IP through IPwhois from the server. The server never substitutes its own IP. The route rejects private/malformed IPs, uses a fixed HTTPS provider host, returns only city-level coordinates/label/optional US ZIP, and is capped at 20/minute and 100/day per process. The UI uses arbitrary detected coordinates for live store/gas discovery, preserves manual overrides, and provides a retry button. VPN/mobile-network geolocation can be inaccurate. **The fictional basket optimizer still uses the selected Atlanta demo area's illustrative routes; IP origin affects live discovery only.**
Live public price scraping is now connected for Lidl US when Lidl is found in the chosen radius. Advertised package prices, source links and retrieval times appear separately from branch-verified baskets. Other retailers show explicit scraping availability; see [public scraping coverage and limits](docs/public-scraping.md). Basket item names are sent to Lidl public searches, cached for five minutes. No credentials are needed for this scraper.

### Agent search API

`POST /api/agent/search` accepts the same basket, ZIP, origin and radius as `/api/live/compare`. It discovers mapped stores, checks public collectors and starts bounded background collection. Kroger remains on its existing independent integration.

For each requested food, connected collectors search product catalogs for Walmart, Target, Publix, ALDI, The Fresh Market, Food Lion, Sam’s Club, Sprouts, Costco, and the Albertsons family where their respective provider yields a usable retailer-specific product page. Generic Whole Foods and independent-store collection is disabled because its source did not prove retailer ownership. Known product URLs remain fallbacks; they no longer prevent a wider search. The Fresh Market also retains dated in-store observations separately from online catalog results. Every mapped grocery location remains visible, but a shop without an accessible source remains unpriced. Online advertised prices are excluded from branch-verified trip rankings until the exact location and package price are confirmed. [Ownership, status, and retry details](docs/search-agent.md).

Catalog discovery searches for the requested size first. If collected products still lack that package, a bounded follow-up search looks for other product pages for the same food; results retain their actual sizes and exact-size matches appear first. The follow-up is attempted once per collection job to protect the provider allowance. An alternative package never silently becomes the requested quantity or a branch-verified trip price.

Optional AI discovery uses the OpenAI Responses API web-search tool to locate missing product source URLs. Configure server-only `OPENAI_API_KEY` and optionally `OPENAI_SEARCH_MODEL` (default `gpt-5.5`). With a key, the same model plans bounded product queries. Without a key, the local Ollama agent is used when available. Product matching in the fast checkout stream uses deterministic source and package checks; the optional AI review utility is not on this path. No AI price text is accepted: only cited, allowlisted product URLs are passed to the scraper. Publix and ALDI URLs must match their exact retailer path. Package, currency and source validation still applies; online catalogs cannot establish local branch prices.

Source discovery is cached locally for 24 hours. AI starts are limited to 5 per minute and 30 per day per server process. Provider jobs and caches use local disk; a production/serverless deployment needs shared durable storage and authenticated quota controls before exposing paid keys to public traffic. Configure provider account spending limits independently. The AI network call requires credentials and has not been verified with a live key.

### Combined stop map and source search

The trip flow starts with a food list on `/plan`, then opens one large map for groceries and gas stations on `/plan/results`. The shared radius and All stops / Groceries / Gas stations filters control both pins and the stop list. Pump-price reports can be checked below the map when a provider is configured. Once every selected food has a verified branch price and a gas stop is chosen, `/plan/review` shows the estimate, route directions, and supported retailer handoff. Stretch does not process payment or guarantee that an outside retailer accepts a cart import.

`BRIGHT_DATA_SERP_ZONE` enables the connected Bright Data web-search API for missing product URLs, without requiring an AI key. Only allowlisted retailer product links are accepted; search snippets never become live prices. Collection pages rejected by the provider are not used as product sources. Walmart and Target get one fallback attempt after a ZIP collector failure. Existing hosted collection jobs can finish at the provider; the user can check them again explicitly. There is no automatic polling loop. Cached product records retain their retrieval timestamp. Both search requests and maximum requested scraper records reserve from a durable local 1,000-credit monthly allowance; this is conservative relative to the verified $1.50 per 1,000 rate and the $20 user budget. Shared storage/account-level spending controls remain necessary across multiple deployed servers. No payment method or paid subscription has been activated.

Checkout search and manual price refresh have a 30-second server window and a 35-second browser deadline. Cached evidence streams immediately; AI planning, location discovery and cache reads start together. Public catalogs run independently, and six provider workers give each retailer an item before moving to the next item. Pending provider jobs are checked again during the same search without triggering a duplicate job. The final response includes the actual prices received and settles every pending status even if an adapter ignores cancellation. Missing prices remain missing; a deadline does not imply full retailer coverage. Known product URLs are reused in the fast path instead of performing a new discovery search first. Hosted scraping/search infrastructure still requires its server credentials, and online prices do not establish local branch prices.

Checkout can run a local Ollama search agent when no OpenAI key is configured. It uses the locally installed `llama3.2:3b` model, or `OLLAMA_SEARCH_MODEL` if configured, to generate bounded product search phrases from the basket. Stretch validates that each phrase still names the requested food before sending it to the website search provider. AI planning has a short deadline and runs alongside the initial comparison. AI never supplies a price: only product pages parsed by a validated collector can do that. Ollama must be running on the same host as the Next.js server; deploying to a separate host requires installing/configuring a model there. Stores without a verified price from their own source are omitted from the comparison cards; the result still reports how many nearby locations lacked a branch price.

AI plans are cached for an hour; public catalog evidence is cached by ZIP, retailer, product name and requested package for five minutes without changing its source timestamp. Provider evidence also uses the existing disk cache, and cache reads never wait on running network jobs. AI planning gets up to five seconds inside the shared search window. Changing the basket or location cancels the old search, and late callbacks are discarded. React development effect replays correctly restart an aborted automatic search. Online catalog prices remain separate from branch-verified trip totals. The deadline still cannot guarantee a newly scraped price from every store.

After collection, the local model reviews up to 30 candidate product names and package sizes, classifies matches, alternatives, and unrelated products, and can remove unrelated results. This review never creates or changes a price; all displayed prices retain their retailer source and timestamp. The interface reports how many candidate matches the model reviewed.
Keep credentials in local environment files. Never commit Supabase secret or service-role keys.

## Kroger search and save library

Import from `@/lib/kroger` in Next.js Route Handlers, Server Actions or Server Components
using the Node.js runtime. This entry point is marked `server-only`; importing it into a
Client Component produces a Next.js build error. No additional packages are required.

```ts
import {
  findCheapestKrogerProducts,
  saveCheapestKrogerProducts,
  type KrogerSearchOptions,
} from "@/lib/kroger";

// Pass the visitor's IP-derived coordinates from the existing location flow.
const options: KrogerSearchOptions = {
  item: "eggs",
  amount: 12,
  category: "Dairy",
  origin: { latitude: 33.7486, longitude: -84.3880 },
};

// Reads saved results first, then searches missing stores. Never writes.
const preview = await findCheapestKrogerProducts(options);

// Reuses saved results and upserts newly searched winners into store/product.
// An optional logger receives the same step-by-step progress as the CLI.
const saved = await saveCheapestKrogerProducts(options, { log: console.log });
```

Both functions check Supabase before calling Kroger's products API. A saved record for
the same normalized item, store and requested amount is returned immediately for that
store when its `date` is today; it is not searched or written again. Equivalent amounts such as `1 gal` and
`128 fl oz` reuse the same ID. A different requested amount remains a separate search.
The Kroger locations API still determines the three nearest stores. Failed database
lookups stop execution before any product search. Yesterday's or older records are
searched again and upserted under the same ID. The `date` column records the price
retrieval day as `YYYY-MM-DD` in America/New_York. Freshness changes at midnight in
that time zone, rather than after 24 hours. Existing undated rows are also refreshed;
their original counts, prices and IDs remain untouched by the column migration.
Failed searches leave the previous price and date unchanged, so the next request retries.
Apply `supabase/migrations/202610100001_product_date.sql` before running this version.
Also apply `supabase/migrations/202610100002_product_dietary.sql` to add nullable
`gluten_free`, `vegan`, and `nut_free` booleans to the singular `product` table.
Historical rows stay unknown (`null`); the sample dietary tags in the plural catalog
are not evidence about a real Kroger package.

Use `glutenFree: true`, `vegan: true`, or `nutFree: true` in either library function,
or `--gluten-free`, `--vegan`, and `--nut-free` in either CLI. Combined flags require
every criterion. False/omitted flags mean no restriction, rather than requiring the
opposite diet. For example:

```sh
npm run kroger:save -- --item bread --unit oz --category Bakery --gluten-free --vegan
npm run kroger:catalog -- --only bread,pasta --gluten-free
```

Dietary words narrow the Kroger query, then explicit claims in the returned product
description are checked before price ranking. The compact API does not supply a
complete dietary/allergen record: missing claims remain `null` and are excluded when
required. Vegetarian, dairy-free, plant-based, peanut-free or tree-nut-free labels
alone do not establish the requested vegan/nut-free claim. These columns record
provider name claims, not independent ingredient or manufacturing verification.
No dietary suitability is inferred from item/category names or the lack of an allergen.
Requested dietary combinations get distinct stable IDs; normal searches retain
their existing IDs. Cached rows must satisfy all requested flags and today's date.

Both functions return `{ products, rows, complete, issues }`. `products` contains all
available database-shaped results in nearest-store order, with nested store metadata
and `source: "database" | "kroger"`. Use this array in application code so saved hits
appear alongside new results. `rows` contains **only newly searched** winners, including
description, package size, physical item count, comparison quantity, price in cents,
store metadata and retrieval time. Cached records do not invent provider metadata or a
fresh retrieval timestamp. `complete` is false if a store failed, no match
was found, fewer than three stores were available, or Kroger capped a search at 300 products.
`issues` explains those cases without requiring a logger. Available winners can still be
saved on partial searches. Configuration and database failures throw errors. Stores are
saved before products in separate requests; a product-save failure can leave updated store
metadata, and repeating the same search safely updates the same product IDs.

The library keeps the script's matching rules: exact category and item-name checks,
regular prices per normalized unit, an exact requested package size preferred over the
±1/3 fallback range, and separate stable IDs for each requested amount. `package_count`
(and saved `product.count`) means physical items: 12 eggs, one gallon jug, or one bean can.
`package_quantity` remains 12 each, 128 fl-oz, or 15.5 oz respectively for unit pricing.
Use `amount: "1 gal"` for whole milk, or `{ item: "black beans", unit: "oz" }` without an
amount to compare all eligible bean package sizes. `productRow` and `storeRow` map a
winner to the database row shapes; package parsers and TypeScript types are also exported.

Next.js loads `.env.local` automatically. Both functions require server-only
`KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`, plus `SUPABASE_URL` (or
`NEXT_PUBLIC_SUPABASE_URL`) for the existing-record lookup. Saving requires
`SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Search-only calls can instead
use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` with SELECT
permission on the product and store tables.
The `env`, `fetcher`, `makeClient`, `log` and `now` dependencies can be supplied for testing or
custom execution. Importing the library does not load env files, fetch, log or write.

Supply `origin` for a visitor's current location. `zip` is an alternative; with neither,
IP lookup resolves the **executing machine's** public IP, which is the hosting server in
a deployed app. The local CLI keeps that IP default and the same commands:

```sh
npm run kroger:save -- --item eggs --amount 12 --category Dairy
npm run kroger:save -- --item "whole milk" --amount "1 gal" --category Dairy
npm run kroger:save -- --item "black beans" --unit oz --category "Canned & Packaged"
```

Add `--dry-run` to search without saving. Standalone Node scripts can import the same
functions from `lib/kroger/core.mjs` and load their environment explicitly. The CLI is now
a thin argument/env/progress wrapper around that shared implementation.

Run `npm run kroger:catalog` to read every ID from the plural `products` catalog and
run the same search/save library sequentially for each product's name and package unit.
Measurable catalog units become preferred amounts. Non-measurable units such as
`1 bunch` or `1 loaf` are logged and searched without a package-size constraint.
Known catalog items use Kroger category mappings (including Dairy, Produce, Bakery,
Frozen and Canned & Packaged); remaining categories are inferred from matching products.
Chickpeas search under the equivalent name garbanzo beans, bread is compared by weight,
and the olive-oil bottle's oz shorthand is interpreted as fluid ounces. The catalog remains unchanged, and winners
are saved to the singular `product`/`store` tables with the existing stable IDs and daily
freshness rule. The runner resolves IP location once, continues after individual failures,
and checkpoints each catalog ID with its result to `reports/kroger-catalog-YYYY-MM-DD.json`.
Use `--dry-run`, `--lat N --lng N`, `--zip ZIP`, or `--report PATH` after `--` to override
execution options. Partial searches and unavailable items remain explicit in the report.
`--refresh-only cheddar` explicitly repairs that item's same-day records; other IDs
still follow normal daily reuse. The library exposes the equivalent `forceRefresh`
option for deliberate match corrections, defaulting to false.
Use `--only bread,cheddar` to retry a specific set of catalog IDs. Dual count/weight
labels (for example `14 ct / 7.41 oz`) preserve the count while using the total package
weight for unit prices; explicit `x`/`pack` multipacks still multiply package quantities.

## Mobile app

The Expo frontend is preserved in `mobile/`, with its own dependency configuration. From that directory, install dependencies and run `npm start` (or `npm run web`). The root remains the Next.js + Supabase application. OSRM driving-route work from the remote branch is included in the web app.
