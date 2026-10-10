import { expect, it } from "vitest";
import { parseFreshMarketBranchOffers } from "../lib/fresh-market-specials";
import { compareBasket } from "../lib/compare-basket";

const live = process.env.LIVE_RETAILER_TESTS === "1" ? it : it.skip;

live("reads a current offer and image for the matched Atlanta branch", async () => {
  const response = await fetch("https://www.thefreshmarket.com/features/weekly-features", {
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.ok).toBe(true);
  const stores = parseFreshMarketBranchOffers(await response.text(), [{
    id: "osm-atlanta-fresh-market", name: "The Fresh Market", kind: "grocery",
    address: "2099 Peachtree Rd NW, Atlanta, GA", lat: 33.812159, lon: -84.391634,
    miles: 2, mapUrl: "https://www.openstreetmap.org/",
  }], [{ id: "apples", name: "Apples", unit: "1 lb", quantity: 1 }]);
  expect(stores).toHaveLength(1);
  expect(stores[0].lines[0].candidates[0]).toMatchObject({
    retailerId: "The Fresh Market", storeLocationId: "osm-atlanta-fresh-market",
    sourceStoreId: "61", priceKind: "branch_advertised", soldBy: "WEIGHT",
  });
  expect(stores[0].lines[0].candidates[0].price).toBeGreaterThan(0);
  expect(stores[0].lines[0].candidates[0].imageUrl).toMatch(/^https:\/\/thefreshmarket\.widen\.net\//);
});

live("includes the branch offer in the comparison response", async () => {
  const response = await compareBasket(new Request("http://localhost/api/live/compare", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zip: "30309", area: "midtown", radius: 2,
      origin: { lat: 33.812159, lon: -84.391634, label: "Peachtree Rd", zip: "30309" },
      items: [{ id: "apples", name: "Apples", unit: "1 lb", quantity: 1 }],
    }),
  }), undefined, undefined, { deferProvider: true, deferPublic: true, deferPlan: true });
  const body = await response.json();
  expect(response.ok, JSON.stringify(body)).toBe(true);
  const store = body.stores.find((entry: { retailerId: string }) => entry.retailerId === "The Fresh Market");
  expect(store).toBeTruthy();
  expect(store.lines[0].candidates[0]).toMatchObject({
    retailerId: "The Fresh Market", storeLocationId: store.id,
    sourceStoreId: "61", priceKind: "branch_advertised",
  });
}, 30_000);
