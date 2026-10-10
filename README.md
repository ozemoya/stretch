# Stretch

Next.js App Router + React + TypeScript + Supabase. Selected design: Draft C; original PNG logo preserved.

## Run

Node 20.9+ required. Run `npm ci`, copy `.env.example` to `.env.local`, then `npm run dev`. Open http://localhost:3000.

## Supabase setup

Run `supabase/setup.sql` once in the project's SQL Editor against an empty project. It creates tables, read-only public policies, and 30 products / 90 sample offers. Alternatively, apply `supabase/migrations/202610090001_catalog.sql` and then `supabase/seed.sql` through your migration workflow.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then restart Next.js. The comparison panel should say **Catalog connected to Supabase**. No service-role key is needed. Credentials are ignored by Git.

Without a key the app explicitly uses its built-in demo catalog. A database failure displays a warning and falls back to demo data.

The Stretch project was connected and verified on October 9, 2026: 30 products, 3 stores, 90 sample offers, and 6 substitutions. Local `.env.local` contains the public connection settings and is ignored by Git; each teammate or deployment must configure their own environment.

## Project status

Hacklanta prototype. The app is now an Expo / React Native application. It keeps the Draft C visual language while using native layout, touch interactions, accessibility props, and a responsive tablet/web layout.

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

Supabase serves the sample public catalog only. Grocery lists and preferences remain in browser memory; checklist downloads are created locally. Public users have SELECT access only; INSERT, UPDATE, and DELETE are revoked and protected by RLS. IP detection sends the visitor's IP to IPwhois (and ipify if needed); Stretch does not persist the IP. Approximate IP coordinates or selected area coordinates go to Overpass/Google for location searches. Basket item names go to connected pricing providers when "Check my list" is used, and the optional feed receives basket items plus discovered store names/addresses/IDs. No device GPS permission is requested. General search results are cached in server memory as described above.

## Checks

`npm test`, `npm run typecheck`, `npm run build`, `npm audit`.

Tests cover optimizer calculations, quantities, missing items, dietary conflicts, and split-store savings. PGlite applies the actual SQL setup and checks anonymous/authenticated reads and denied writes; this is a local SQL verification, not a hosted Supabase test.

## Deployment

Import the repository into Vercel with its Next.js preset and configure the two environment variables. No live routing provider is required for the sample demo. Old static files are kept in `archive/`.

[Selected Draft C](https://www.figma.com/board/TNSW97eqDpo50behte9Xn9/Untitled?node-id=59-39)

### Basket price agent and IP area detection

The "Check my list" flow accepts up to 30 items and discovers every matching OSM grocery location within a selectable 1–10 mile radius, including all retailer brands and independent stores. Every returned store appears in a coverage list: price source checked, failed, or unavailable. An optional authorized multi-retailer price feed can price any mapped store; [feed contract](docs/grocery-price-feed.md). The existing Kroger adapter prices up to ten items at two branches matched to map coordinates, once credentials are configured. Unchecked branches and lines stay explicitly unpriced. Each package must be reviewed before a grocery subtotal is calculated. Unknown prices, weighted packages and failed searches keep baskets incomplete; regular prices do not assume promotional eligibility. Results do not verify stock, dietary suitability, travel, taxes or cross-store optimization. **No universal grocery scraper or multi-retailer price supplier is currently connected.**

The browser requests https://ipwho.is/ to estimate its own public-IP location. If that fails, https://api.ipify.org?format=json resolves the visitor's public IP, then `POST /api/location` resolves that exact IP through IPwhois from the server. The server never substitutes its own IP. The route rejects private/malformed IPs, uses a fixed HTTPS provider host, returns only city-level coordinates/label/optional US ZIP, and is capped at 20/minute and 100/day per process. The UI uses arbitrary detected coordinates for live store/gas discovery, preserves manual overrides, and provides a retry button. VPN/mobile-network geolocation can be inaccurate. **The fictional basket optimizer still uses the selected Atlanta demo area's illustrative routes; IP origin affects live discovery only.**
Live public price scraping is now connected for Lidl US when Lidl is found in the chosen radius. Advertised package prices, source links and retrieval times appear separately from branch-verified baskets. Other retailers show explicit scraping availability; see [public scraping coverage and limits](docs/public-scraping.md). Basket item names are sent to Lidl public searches, cached for five minutes. No credentials are needed for this scraper.

### Agent search API
`POST /api/agent/search` accepts the same basket, ZIP, origin and radius as `/api/live/compare`. It discovers mapped stores, checks public collectors and starts bounded background collection. Kroger remains on its existing independent integration.

For each requested food, connected collectors search product catalogs for Walmart, Target, Publix, ALDI, The Fresh Market, Food Lion, Sam’s Club, Sprouts, Costco, the Albertsons family, and Whole Foods where their respective provider yields a usable product page. Known product URLs remain fallbacks; they no longer prevent a wider search. The Fresh Market also retains dated, branch-specific in-store observations separately from online catalog results. Every mapped grocery location remains visible, but an independent shop or chain without an accessible catalog cannot be priced automatically. Online advertised prices are excluded from branch-verified trip rankings until the exact location and package price are confirmed.

Optional AI discovery uses the OpenAI Responses API web-search tool to locate missing product source URLs. Configure server-only `OPENAI_API_KEY` and optionally `OPENAI_SEARCH_MODEL`. Without a key, existing collectors continue and the UI reports that AI discovery is not connected. No AI price text is accepted: only cited, allowlisted product URLs are passed to the scraper. Publix and ALDI URLs must match their exact retailer path. Package, currency and source validation still applies; online catalogs cannot establish local branch prices.

Source discovery is cached locally for 24 hours. AI starts are limited to 5 per minute and 30 per day per server process. Provider jobs and caches use local disk; a production/serverless deployment needs shared durable storage and authenticated quota controls before exposing paid keys to public traffic. Configure provider account spending limits independently. The AI network call requires credentials and has not been verified with a live key.

### Combined stop map and source search
Checkout opens one large map for both groceries and gas stations. The shared radius and All stops / Groceries / Gas stations filters control both pins and the stop list. Pump-price reports can be checked below the map when a provider is configured.

`BRIGHT_DATA_SERP_ZONE` enables the connected Bright Data web-search API for missing product URLs, without requiring an AI key. Only allowlisted retailer product links are accepted; search snippets never become live prices. Collection pages rejected by the provider are not used as product sources. Walmart and Target get one fallback attempt after a ZIP collector failure. Pending jobs refresh automatically every 20 seconds. Cached product records retain their retrieval timestamp. Both search requests and maximum requested scraper records reserve from a durable local 1,000-credit monthly allowance; this is conservative relative to the verified $1.50 per 1,000 rate and the $20 user budget. Shared storage/account-level spending controls remain necessary across multiple deployed servers. No payment method or paid subscription has been activated.

Checkout website search now streams newline-delimited JSON: cached observations first, then bounded parallel collector updates, followed by the complete comparison. Six item collection workers run concurrently; public catalog scraping and provider collectors run together. Existing collector jobs are reused and polled rather than repeatedly started. Retailer APIs are not required by the website collection adapters, but hosted scraping/search infrastructure still requires its server credentials. Branch, stock, and in-store equivalence remain unverified unless explicitly supplied by a branch-specific source.

Checkout can now run a local Ollama search agent before website collection. It uses the locally installed `llama3.2:3b` model, or `OLLAMA_SEARCH_MODEL` if configured, to generate bounded product search phrases from the basket. Stretch validates that each phrase still names the requested food before sending it to the website search provider. The local AI never supplies a price: only product pages parsed by a validated collector can do that. The streamed response reports when planning starts, succeeds, or is unavailable. Ollama must be running on the same host as the Next.js server; deploying to a separate host requires installing/configuring a model there. If Ollama is unavailable, the existing website search runs and the UI says AI was unavailable.

After collection, the local model reviews up to 30 candidate product names and package sizes, classifies matches, alternatives, and unrelated products, and can remove unrelated results. This review never creates or changes a price; all displayed prices retain their retailer source and timestamp. The interface reports how many candidate matches the model reviewed.
Keep credentials in local environment files. Never commit Supabase secret or service-role keys.

## Mobile app

The Expo frontend is preserved in `mobile/`, with its own dependency configuration. From that directory, install dependencies and run `npm start` (or `npm run web`). The root remains the Next.js + Supabase application. OSRM driving-route work from the remote branch is included in the web app.
