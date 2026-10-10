# Multi-retailer price source contract

This connector is implemented but **no supplier/feed is connected**. It does not magically enable scraping Walmart, Publix, ALDI, Target or independent stores. A supplier or authorized scraper must actually obtain branch-specific prices and implement this contract. Do not label scraped delivery prices as in-store checkout prices.

Configure the server-only `GROCERY_PRICE_FEED_URL` (HTTPS) and optional `GROCERY_PRICE_FEED_KEY`. On comparison, Stretch posts `{ stores, items }`: `stores` contains every grocery location returned for the selected radius with its OSM `id`, `name` and `address`; `items` contains the user's item `id`, `name`, requested `unit` and `quantity`. A bearer key is sent only to the configured endpoint. Redirects are rejected.

Return JSON using this shape (illustrative fixture, not a real price):

```json
{
  "source": "Your authorized price source",
  "currency": "USD",
  "priceType": "in_store",
  "stores": [
    {
      "id": "node/123",
      "lines": [
        {
          "itemId": "milk",
          "candidates": [
            {
              "id": "exact-product-and-package-id",
              "name": "Whole milk",
              "brand": "Example",
              "size": "1 gallon",
              "soldBy": "UNIT",
              "regularCents": 400,
              "retrievedAt": "2026-10-09T12:00:00Z",
              "retailerId": "Independent / other retailer",
              "storeLocationId": "node/123",
              "productUrl": "https://local.example/products/milk"
            }
          ]
        }
      ]
    }
  ]
}
```

Only OSM location IDs in the requested radius are accepted. Every candidate must repeat the exact `retailerId` and `storeLocationId`, and include an HTTPS product URL. A conflicting retailer or branch ID is rejected; known retailer URLs that point to a different chain are rejected. Timestamp age must be no more than 24 hours and no more than five minutes in the future. Missing lines, missing prices, stale candidates, and weighted products cannot produce a complete ranked basket. `regularCents: null` means price unknown; `soldBy` accepts `UNIT` or `WEIGHT`. Users review packages explicitly. Stock, dietary suitability, tax and fuel are not verified by this feed.

The adapter accepts at most 2,000 stores, 30 requested lines per store, 20 candidate packages per line, and a 2 MB response. Larger responses fail visibly rather than silently truncating location coverage. The connector has a 20-second timeout. Before enabling a paid supplier, set quotas with that supplier; process-local protections are not a substitute for an account-level limit.

All discovered locations appear in the price-coverage list. A returned store has `checked` status because the price source responded for it; this does not mean every item has a price or its basket is complete. Unreturned stores remain explicitly unavailable. The existing Kroger API can price up to ten items at two branches matched by coordinates, once credentials are configured; other mapped Kroger locations remain visibly unpriced.
