# Stretch production readiness

This checklist applies to a real Atlanta-area pilot. A local build and the sample Supabase catalog are not evidence of live branch-price coverage.

## Required before public launch

- [ ] Connect and test at least one authorized source that returns prices for specific nearby store branches. Record its permitted use, rate limits, credentials, and allowed retention period. Kroger credentials and an approved comparison use case, or a licensed multi-retailer feed, are possible paths; neither is currently configured here.
- [ ] Test complete and incomplete baskets at several Atlanta ZIP codes. Confirm each product's retailer ID, branch ID, package, price, source, timestamp, and URL when the source supplies one. A missing product URL must remain visibly missing; it must not be invented.
- [ ] Verify the routing service and geographic coverage under deployed traffic. Compare a few route distances with a navigation app. If routing fails, do not rank by a guessed straight-line distance.
- [ ] Connect a legitimate station-level fuel-price source if advertising station-specific gas prices. Otherwise label user-entered fuel prices as estimates and report that station prices are unavailable.
- [ ] Move search quotas, cache, rate limits, and provider job state to shared durable infrastructure before deploying multiple server instances. Set provider-level spending caps and alerts.
- [ ] Review privacy and terms with counsel or the project owner. Document browser device-location permission, outside location/search providers, local browser storage, data retention, and account or receipt handling if those features are added.
- [ ] Smoke-test the deployed food-list → results → trip-review flow on desktop and mobile, including denied location lookup, missing provider credentials, no branch prices, timeout, partial basket, stale quote, gas-price estimate, and a product source without a URL.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=high` on the release commit. Confirm server-only keys are not in the repository or browser bundle.

## Current scope

Guest lists and trip preferences are stored only on that browser. The review is a plan, not a payment checkout. A directions link covers the chosen grocery branch and gas station, but the starting point is the selected approximate area. Retailer product pages and preloaded carts are offered only when a supported source supplies the necessary URLs or variant IDs. Supabase Auth, cross-device sync, exact inventory, tax, loyalty discounts, purchase history, and universal retailer coverage are not launch claims.
