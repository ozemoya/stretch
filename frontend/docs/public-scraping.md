# Public retailer price scraping

Check my list now runs a real server-side Lidl US public catalog scraper if a Lidl is mapped inside the selected radius. It searches up to twelve basket items, reads the rendered product tiles with Cheerio, and returns up to eight name matches per item, including package sizes, advertised USD package prices, exact source links and retrieval timestamps. Search matches require manual package and dietary review.

These are the website's default-region advertised prices. The scraper has not selected or verified your physical branch; product regional pricing can differ. Catalog results are separate from branch-verified baskets and never enter local cheapest-trip rankings. Missing matches, unreadable pages, restrictions and failures remain unknown. A successful scrape does not verify shelf stock.

The adapter checks Lidl's generic robots rules, fails closed when restrictions change, uses an identified user agent, and does not use login sessions or bypass challenges. Requests have 15-second timeouts, a 6 MB response limit, five-minute bounded caching, request coalescing, and process limits of 15 requests/minute and 150/day. Production requires shared persistent rate limits. All discovered retailer groups receive a visible status, but only Lidl has a working public scraper. ALDI's generic robots rules currently disallow crawling; Target pages tested did not expose usable prices, and Trader Joe's pages require rendering. There is no universal grocery price scraping service connected.

Run ordinary checks with `npm test`. For an explicit real-network proof in PowerShell:

```powershell
$env:STRETCH_LIVE_SMOKE = '1'
npx vitest run tests/retailer-scraper.test.ts
Remove-Item Env:STRETCH_LIVE_SMOKE
```

The optional smoke test fetches live milk and egg searches and requires priced packages for both. It prints source evidence; no credentials are required.

## Additional working source

The Fresh Market weekly features are connected. The adapter reads public page data, checks offer start/end dates, and matches applicable branches to mapped coordinates plus street number. It returns only explicit dollar-per-each or dollar-per-pound offers, preserving the rate and expiration. BOGO, percentage discounts, multibuy and starting-at offers are not converted to prices. These partial weekly offers remain separate from full basket rankings. Tested live for 2099 Peachtree Rd NW, Atlanta on October 9, 2026.

Live source checks: Sprouts' delivery shop disallows generic automated crawling; Walmart returned a bot challenge; Trader Joe's catalog endpoint returned access denied. Kroger's existing integration needs developer credentials. Instacart's public shopping-list API generates an external shopping link; it does not supply comparison prices (https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page). No missing source is treated as zero-priced.

