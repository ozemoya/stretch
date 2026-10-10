# Stretch Version 1 audit and milestones

## Current application

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase public catalog, Leaflet/OpenStreetMap map, OSRM driving route endpoint, Vitest. The `mobile/` Expo project is separate; the root app is the actively developed web app.
- **Screens:** `/` home, `/plan` list and settings, `/plan/results` branch comparison and gas map, `/plan/review` trip review and handoff. `/plan/checkout` redirects to the review page because Stretch does not process payment.
- **Data model:** Supabase currently stores public `stores`, `products`, `offers`, and `substitutions`. The 30-product seed has **sample** prices, not live shelf prices. Saved guest lists and preferences live in browser local storage; in-progress trips live in session storage. There is no account, receipt, purchase, alert, or shopping-history schema yet.
- **Sources:** OSM/Overpass discovers locations; it supplies no grocery or pump prices. An official Kroger Products/Locations adapter supports coordinate-matched branches when credentials are configured. An optional licensed branch-price feed has a strict store/product contract but no supplier connected. Lidl and other public/hosted catalog checks produce online listings only, excluded from branch basket rankings. Local fuel prices require a reported quote or a user-entered estimate. Instacart shopping-link code remains inactive without an approved key; it does not prove branch price or import an exact cart.
- **Search:** provider reports are independent; source URL/retailer ownership checks and exact branch IDs prevent cross-retailer price attribution. Missing/partial results stay visible as coverage states. The interactive search window is four seconds server-side and 4.9 seconds client-side; late providers cannot guarantee new prices in that window.
- **Pricing:** complete, branch-verified baskets alone are eligible for food-plus-fuel totals. OSRM measures driving miles via grocery, selected gas stop, and starting area. Sales tax, inventory, loyalty eligibility, and payment totals are not verified.

## Root causes and reused work

The prior wrong-retailer listings came from treating broad online catalog alternatives as if they belonged to a selected branch. Existing `lib/product-ownership.ts`, `lib/price-agent.ts`, and `lib/trip-review.ts` now keep online alternatives separate and validate retailer and branch IDs before pricing a trip. Regression tests in `tests/store-ownership-regression.test.ts`, `tests/price-agent.test.ts`, and `lib/trip-review.test.ts` cover these rules. Search cancellation and deadline handling are already implemented in the agent stream and frontend. These are reused rather than rebuilt.

## Milestones

1. **Trustworthy core — implemented, verify before release.** Keep branch prices separate from online listings; reject unknown prices and incomplete baskets; show source timestamps and coverage. Test several ZIP codes and provider failures before claiming a service area.
2. **Repeat trips — implemented for guests.** Named lists can be saved, loaded, removed, and reused; budget, MPG, gas estimate, dietary flags, and a manually selected area persist on the device. Prices are searched again each trip. Account sync and household sharing remain future work.
3. **Trip handoff — implemented with provider limits.** The review page shows the selected grocery branch, gas stop, estimate, available product links, one route link in trip order, and a printable/copyable list. A verified branch price can still be reviewed when its source provides no product URL; that missing link is explicit. A preloaded cart is offered only for a supported Shopify merchant with known variant IDs. Direct retailer links require manual cart entry. No payment is taken by Stretch.
4. **Authenticated persistence — pending.** Add optional Supabase Auth and row-level-secured tables for user lists, preferences, vehicles, and trip history. Preserve guest search and explicit account deletion. Apply migrations and test actual hosted permissions.
5. **Coverage and release readiness — blocked on external access.** Connect a licensed branch-price supplier or approved retailer credentials; verify each data license, branch identity, and the distinction between in-store and online prices. Add production-wide rate limiting/shared cache, error monitoring, mobile/keyboard checks, privacy and terms review, and a deployment smoke test.

## Release boundary

The public promise should be an **Atlanta-area pilot for supported, branch-verified prices**, with all unsupported branches clearly reported as unpriced. Do not market universal store coverage, universal live pump prices, exact inventory, guaranteed savings, or one-click cart import at every retailer. A complete real-world trip comparison cannot be demonstrated without a connected branch-price source and a reported or entered fuel price. Keep sample catalog data explicitly labeled and separate from live rankings.
